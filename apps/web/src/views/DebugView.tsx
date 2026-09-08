// apps/web/src/views/DebugView.tsx
//
// The smoke test that got the ATS integration working, kept as a page rather than
// deleted. Each button is one SDK call with nothing around it, which is what made the
// undocumented connection requirements findable in the first place — and what makes a
// regression obvious.
//
// It also owns the index: registering a security issued before this browser tracked
// them, and clearing everything so a demo can be recorded from nothing.

import { useState } from "react";
import {
  ROLES,
  getHolders,
  getSecurity,
  grantOperationalRoles,
  hashscan,
  issue,
  pause,
  transfer,
  unpause,
  redeemAtMaturity,
  type Connection,
  createReceivable,
} from "../lib/ats";
import { formatMinor, toBondParams, type Invoice } from "../lib/domain";
import { appendLog, clearLog, useLog } from "../lib/log";
import {
  addReceivable,
  clearReceivables,
  forgetReceivable,
  useReceivables,
} from "../lib/receivables";

const FUNDER_ID = "0.0.10377457";
const TEST_TERM_SECONDS = 480;

export function DebugView({ conn }: { conn: Connection | null }) {
  const receivables = useReceivables();
  const log = useLog();
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);

  /**
   * The user's explicit choice while it still exists, otherwise the first indexed
   * receivable.
   *
   * Derived rather than synchronised through an effect. Storing it would mean writing
   * state during render every time the index changed, and would leave the selection
   * pointing at a security that Forget had already removed.
   */
  const target = receivables.some((r) => r.securityId === chosen)
    ? chosen
    : (receivables[0]?.securityId ?? "");

  const say = appendLog;

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    say(`→ ${label}`);
    try {
      say(`   ${JSON.stringify(await fn())}`);
    } catch (e) {
      say(`   ERROR ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const disabled = !conn || busy || !target;

  return (
    <div className="grid">
      <section className="card">
        <h2>Indexed receivables</h2>
        <p className="hint">
          Held in this browser only. The ledger does not answer &ldquo;which
          securities did I create&rdquo;, so the app has to remember. Forgetting
          one here does not touch the contract.
        </p>

        {receivables.length === 0 ? (
          <div className="empty">Nothing indexed.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Security</th>
                <th className="right">Face value</th>
                <th className="right"></th>
              </tr>
            </thead>
            <tbody>
              {receivables.map((r) => (
                <tr key={r.securityId}>
                  <td>{r.reference}</td>
                  <td className="mono">
                    <a
                      href={hashscan.contract(r.securityId)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {r.securityId}
                    </a>
                  </td>
                  <td className="right">
                    {formatMinor(r.faceValueMinor, r.currency)}
                  </td>
                  <td className="right">
                    <button
                      className="ghost"
                      onClick={() => forgetReceivable(r.securityId)}
                    >
                      Forget
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <RegisterExisting />

        {receivables.length > 0 && (
          <button
            className="ghost"
            style={{ marginTop: 12 }}
            onClick={clearReceivables}
          >
            Clear index
          </button>
        )}
      </section>

      <section className="card">
        <h2>Direct SDK calls</h2>

        <div className="field" style={{ maxWidth: 320 }}>
          <label>Security</label>
          <select value={target} onChange={(e) => setChosen(e.target.value)}>
            {receivables.length === 0 && (
              <option value="">Nothing indexed</option>
            )}
            {receivables.map((r) => (
              <option key={r.securityId} value={r.securityId}>
                {r.reference} · {r.securityId}
              </option>
            ))}
          </select>
        </div>

        <p className="hint">
          Read after every write — a successful transaction is not the same as a
          changed state.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            className="ghost"
            disabled={disabled}
            onClick={() =>
              run("read", async () => ({
                ...(await getSecurity(target)),
                holders: await getHolders(target).catch(() => []),
              }))
            }
          >
            Read state
          </button>

          <button
            className="ghost"
            disabled={disabled}
            onClick={() =>
              run("grant roles", async () => {
                await grantOperationalRoles(
                  target,
                  conn!.accountId,
                  (label, r) =>
                    say(`   ${label} ${r.ok ? "granted" : "failed"}`),
                );
                return { roles: Object.keys(ROLES) };
              })
            }
          >
            Grant roles
          </button>

          <button
            className="ghost"
            disabled={disabled}
            onClick={() =>
              run("issue", () => issue(target, conn!.accountId, "1"))
            }
          >
            Issue
          </button>

          <button
            className="ghost"
            disabled={disabled}
            onClick={() =>
              run("transfer", () => transfer(target, FUNDER_ID, "1"))
            }
          >
            Transfer to funder
          </button>

          <button
            className="ghost"
            disabled={disabled}
            onClick={() =>
              run("redeem at maturity", async () => {
                const holders = await getHolders(target);
                if (holders.length === 0)
                  throw new Error("nothing to redeem — no holder");
                return redeemAtMaturity(target, holders[0]);
              })
            }
          >
            Redeem at maturity
          </button>

          <button
            className="ghost"
            disabled={!conn || busy}
            onClick={() =>
              run("create 8-minute bond", async () => {
                // A receivable that matures while you watch. The UI cannot express this —
                // validate() rejects a sub-day term, and should, because no real invoice has
                // one. Redemption cannot be observed without it.
                const reference = `TEST-${Date.now().toString().slice(-6)}`;

                const invoice: Invoice = {
                  reference,
                  issuerAccountId: conn!.accountId,
                  debtorName: "Test debtor",
                  debtorCountry: "SG",
                  faceValueMinor: 200_000,
                  currency: "USD",
                  issuedAt: new Date(),
                  // A day out purely to satisfy validate(); the real maturity is set below.
                  dueAt: new Date(Date.now() + 86_400_000),
                  // A well-formed hash of nothing. Acceptable here precisely because this is
                  // not a real receivable — never on the issuance path.
                  documentHash: "sha256:" + "0".repeat(64),
                  status: "SUBMITTED",
                };

                const params = toBondParams(invoice, conn!.accountId) as Record<
                  string,
                  unknown
                >;
                const now = Math.floor(Date.now() / 1000);
                params.startingDate = String(now + 60);
                params.maturityDate = String(now + TEST_TERM_SECONDS);

                const securityId = await createReceivable(
                  params,
                  conn!.accountId,
                  say,
                );

                addReceivable({
                  securityId,
                  reference,
                  faceValueMinor: 200_000,
                  currency: "USD",
                  termDays: 1,
                  annualRate: 0.12,
                  createdAt: new Date().toISOString(),
                });

                return {
                  securityId,
                  // Read back from what was sent, not recomputed. Two numbers that should agree
                  // will eventually disagree.
                  maturesAt: new Date(
                    Number(params.maturityDate) * 1000,
                  ).toLocaleTimeString(),
                  maturityEpoch: params.maturityDate,
                };
              })
            }
          >
            Create {TEST_TERM_SECONDS / 60}-minute bond
          </button>

          <button
            className="ghost"
            disabled={disabled}
            onClick={() => run("pause", () => pause(target))}
          >
            Pause
          </button>

          <button
            className="ghost"
            disabled={disabled}
            onClick={() => run("unpause", () => unpause(target))}
          >
            Unpause
          </button>

          <button className="ghost" disabled={busy} onClick={clearLog}>
            Clear log
          </button>
        </div>

        {!conn && (
          <p className="hint" style={{ marginTop: 12 }}>
            Connect a wallet first.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Log</h2>
        <p className="hint">
          Kept for the whole session — switching tabs no longer discards it.
          Cleared on reload, and never written to storage: these lines carry
          account ids and raw SDK payloads.
        </p>
        {log.length === 0 ? (
          <div className="empty">Nothing yet.</div>
        ) : (
          <pre className="log">{log.join("\n")}</pre>
        )}
      </section>
    </div>
  );
}

/**
 * Registers a security that exists on the ledger but not in this browser's index —
 * anything issued before the index existed, or issued from another machine.
 *
 * The terms are asked for rather than guessed. Face value and rate are not readable
 * from the contract in a form this app trusts yet, and inventing them would put a
 * number on screen that nothing backs.
 */
function RegisterExisting() {
  const [securityId, setSecurityId] = useState("");
  const [reference, setReference] = useState("");
  const [faceValue, setFaceValue] = useState("");
  const [currency, setCurrency] = useState<Invoice["currency"]>("USD");
  const [termDays, setTermDays] = useState("60");
  const [error, setError] = useState("");

  function submit() {
    setError("");
    if (!/^\d+\.\d+\.\d+$/.test(securityId.trim())) {
      setError("Security id must look like 0.0.10404061");
      return;
    }
    const face = Math.round(Number(faceValue) * 100);
    if (!Number.isFinite(face) || face <= 0) {
      setError("Face value must be a positive amount");
      return;
    }
    const days = Number(termDays);
    if (!Number.isInteger(days) || days < 1 || days > 60) {
      setError("Term must be between 1 and 60 days");
      return;
    }

    addReceivable({
      securityId: securityId.trim(),
      reference: reference.trim() || securityId.trim(),
      faceValueMinor: face,
      currency,
      termDays: days,
      annualRate: 0.12,
      createdAt: new Date().toISOString(),
    });

    setSecurityId("");
    setReference("");
    setFaceValue("");
  }

  return (
    <div style={{ marginTop: 16 }}>
      <h3>Register an existing security</h3>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "flex-end",
        }}
      >
        <div className="field" style={{ maxWidth: 180 }}>
          <label>Security id</label>
          <input
            value={securityId}
            onChange={(e) => setSecurityId(e.target.value)}
            placeholder="0.0.10404061"
          />
        </div>
        <div className="field" style={{ maxWidth: 180 }}>
          <label>Reference</label>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="INV-2026-0045"
          />
        </div>
        <div className="field" style={{ maxWidth: 140 }}>
          <label>Face value</label>
          <input
            className="num"
            inputMode="decimal"
            value={faceValue}
            onChange={(e) => setFaceValue(e.target.value)}
            placeholder="2000.00"
          />
        </div>
        <div className="field" style={{ maxWidth: 100 }}>
          <label>Currency</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Invoice["currency"])}
          >
            <option>USD</option>
            <option>SGD</option>
            <option>EUR</option>
          </select>
        </div>
        <div className="field" style={{ maxWidth: 100 }}>
          <label>Term (days)</label>
          <input
            value={termDays}
            onChange={(e) => setTermDays(e.target.value)}
          />
        </div>
        <button className="ghost" onClick={submit}>
          Register
        </button>
      </div>
      {error && (
        <div className="verdict bad" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}
