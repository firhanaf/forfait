// apps/web/src/views/FundView.tsx
//
// The funder's side. Every number that can change is read from the network — the
// receivable's state from the ATS contract, the audit trail from the Hedera mirror node.
// The commercial terms come from the local index, because they were entered at issuance
// and the contract does not give all of them back.
//
// A funder should be able to verify this asset without trusting this page, so every row
// links to HashScan and the trail links to the topic.

import { useEffect, useState } from 'react';
import {
  getHolders,
  getSecurity,
  hashscan,
  transfer,
  type Connection,
  type SecurityInfo,
} from '../lib/ats';
import { discount, formatMinor } from '../lib/domain';
import { useReceivables, type Receivable } from '../lib/receivables';

/** The demo funder. A real deployment reads this from the connected wallet. */
const FUNDER_ID = '0.0.10377457';
const TOPIC_ID = '0.0.10388075'; // ← HCS_TOPIC_ID from the root .env
const MIRROR = 'https://testnet.mirrornode.hedera.com/api/v1';

interface AuditEvent {
  invoice: string;
  status: string;
  docHash: string;
  at: string;
  seq: number;
}

// ─────────────────────────────────────────────────────────────

function ReceivableRow({
  receivable,
  conn,
  onFunded,
}: {
  receivable: Receivable;
  conn: Connection | null;
  onFunded: (r: Receivable, txId: string) => void;
}) {
  const [info, setInfo] = useState<SecurityInfo | null>(null);
  const [holders, setHolders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Bumped after a write to force a re-read. A resolved transaction is not a changed
  // state, so nothing here is believed until it has been read back.
  const [reads, setReads] = useState(0);

  /**
   * Reads the receivable's live state.
   *
   * Guarded on a connection because the ATS SDK has no network configured until a
   * wallet pairs; calling it earlier fails with an ethers error about an unsupported
   * operation, naming nothing about wallets.
   *
   * The cancellation flag matters: two rows resolving out of order, or a row unmounting
   * mid-flight, would otherwise write a stale answer over a fresh one.
   */
  useEffect(() => {
    if (!conn) return;
    let cancelled = false;

    (async () => {
      try {
        const [i, h] = await Promise.all([
          getSecurity(receivable.securityId),
          getHolders(receivable.securityId).catch(() => [] as string[]),
        ]);
        if (cancelled) return;
        setInfo(i);
        setHolders(h);
        setError('');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [receivable.securityId, conn, reads]);

  const priced = discount(
    receivable.faceValueMinor,
    receivable.termDays,
    receivable.annualRate,
  );

  const funded = holders.includes(FUNDER_ID);
  const heldByConnected = !!conn && holders.includes(conn.accountId);

  async function fund() {
    setBusy(true);
    setError('');
    try {
      const res = await transfer(receivable.securityId, FUNDER_ID, '1');
      if (!res.ok) throw new Error('the transfer was not accepted');

      // Read back before claiming anything changed. A resolved promise only means
      // the transaction was accepted, which is not the same as a moved holding.
      setReads((n) => n + 1);
      onFunded(receivable, res.transactionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr>
        <td>
          <div>{info?.name ?? receivable.reference}</div>
          <a
            className="mono"
            href={hashscan.contract(receivable.securityId)}
            target="_blank"
            rel="noreferrer"
          >
            {receivable.securityId}
          </a>
        </td>
        <td className="mono">{info?.isin ?? '—'}</td>
        <td className="right">
          {formatMinor(receivable.faceValueMinor, receivable.currency)}
        </td>
        <td className="right">
          {formatMinor(priced.proceedsMinor, receivable.currency)}
        </td>
        <td className="right">{(priced.effectiveAnnualReturn * 100).toFixed(2)}%</td>
        <td className="right">{receivable.termDays}d</td>
        <td className="right">
          {!conn ? (
            <span className="badge">Off-chain</span>
          ) : !info ? (
            <span className="badge">{error ? 'Unavailable' : 'Loading'}</span>
          ) : info.paused ? (
            <span className="badge alert">Paused</span>
          ) : funded ? (
            <span className="badge done">Funded</span>
          ) : (
            <span className="badge live">Open</span>
          )}
        </td>
        <td className="right">
          <button
            className="primary"
            disabled={!conn || !info || info.paused || funded || busy || !heldByConnected}
            onClick={fund}
            title={
              !heldByConnected && conn && info && !funded
                ? 'Only the current holder can release this receivable'
                : undefined
            }
          >
            {busy ? 'Releasing…' : funded ? 'Funded' : 'Release'}
          </button>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={8}>
            <div className="verdict bad">{error}</div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────

export function FundView({ conn }: { conn: Connection | null }) {
  const receivables = useReceivables();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [invoiceFilter, setInvoiceFilter] = useState('');
  const [justFunded, setJustFunded] = useState<{ r: Receivable; txId: string } | null>(
    null,
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${MIRROR}/topics/${TOPIC_ID}/messages?order=asc&limit=100`);
        if (!res.ok) return;
        const data = await res.json();
        setEvents(
          (data.messages ?? []).map((m: { message: string; sequence_number: number }) => ({
            ...JSON.parse(atob(m.message)),
            seq: m.sequence_number,
          })),
        );
      } catch {
        /* topic not configured yet */
      }
    })();
  }, []);

  const shown = invoiceFilter ? events.filter((e) => e.invoice === invoiceFilter) : events;
  const hashes = new Set(shown.map((e) => e.docHash));
  const invoices = [...new Set(events.map((e) => e.invoice))];

  return (
    <div className="grid">
      <section className="card">
        <h2>Available receivables</h2>
        <p className="hint">
          Terms are from issuance; supply, holder and paused state are read live from each
          ATS contract on Hedera testnet.
          {!conn && ' Connect a wallet to read the on-chain state.'}
        </p>

        {receivables.length === 0 ? (
          <div className="empty">
            Nothing issued yet. Raise a receivable, or register an existing security id
            under Diagnostics.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Receivable</th>
                <th>ISIN</th>
                <th className="right">Face value</th>
                <th className="right">Pay today</th>
                <th className="right">Return</th>
                <th className="right">Term</th>
                <th className="right">Status</th>
                <th className="right"></th>
              </tr>
            </thead>
            <tbody>
              {receivables.map((r) => (
                <ReceivableRow
                  key={r.securityId}
                  receivable={r}
                  conn={conn}
                  onFunded={(rec, txId) => setJustFunded({ r: rec, txId })}
                />
              ))}
            </tbody>
          </table>
        )}

        <p className="hint" style={{ marginTop: 14 }}>
          <strong>Release, not settlement.</strong> This moves the receivable to the funder
          in one direction; it does not take the funder's cash in the same transaction. True
          delivery-versus-payment uses an ATS hold with the platform as notary, so neither
          leg can complete alone. That is designed, not built — see{' '}
          <span className="mono">docs/actors.md</span>.
        </p>
      </section>

      {justFunded && (
        <section className="card">
          <h2>Released</h2>
          <p className="hint">
            {justFunded.r.reference} now sits with {FUNDER_ID}. Record it on the audit
            trail — the topic&apos;s submit key belongs to the platform, so this runs from
            the server, not the browser:
          </p>
          <pre className="log">
            {`npx tsx scripts/audit-trail.ts emit ${justFunded.r.reference} FUNDED <path-to-pdf>`}
          </pre>
          <p className="hint">
            Transaction <span className="mono">{justFunded.txId}</span>
          </p>
        </section>
      )}

      <section className="card">
        <h2>Audit trail</h2>
        <p className="hint">
          Every state change is written to a Hedera Consensus Service topic with the
          document hash. If the document changes after a funder has seen it, the trail
          shows it.
        </p>

        {invoices.length > 1 && (
          <div className="field" style={{ maxWidth: 260 }}>
            <label>Receivable</label>
            <select value={invoiceFilter} onChange={(e) => setInvoiceFilter(e.target.value)}>
              <option value="">All</option>
              {invoices.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          </div>
        )}

        {shown.length === 0 ? (
          <div className="empty">
            No events. Set <span className="mono">TOPIC_ID</span> to the topic created by{' '}
            <span className="mono">scripts/audit-trail.ts</span>.
          </div>
        ) : (
          <>
            <ol className="trail">
              {shown.map((e) => (
                <li key={e.seq}>
                  <div>
                    <span className="badge">{e.status}</span>
                  </div>
                  <div>
                    <div className="when">
                      {e.invoice} · {new Date(e.at).toLocaleString()}
                    </div>
                    <div className="hash">{e.docHash}</div>
                  </div>
                </li>
              ))}
            </ol>

            {invoiceFilter && (
              <div className={`verdict ${hashes.size === 1 ? 'ok' : 'bad'}`}>
                {hashes.size === 1
                  ? 'Document hash is consistent across the trail.'
                  : `${hashes.size} different document hashes — the document changed after it was shown.`}
              </div>
            )}
          </>
        )}

        <p className="hint" style={{ marginTop: 14 }}>
          <a href={hashscan.topic(TOPIC_ID)} target="_blank" rel="noreferrer">
            View topic on HashScan
          </a>
        </p>
      </section>
    </div>
  );
}
