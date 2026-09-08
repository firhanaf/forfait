// apps/web/src/views/IssueView.tsx
//
// The freelancer's side: describe an unpaid invoice, see what a funder would pay for it
// today, and tokenise it. The pricing panel updates as they type — the whole product is
// the gap between the face value and what they can have now, so it should never be hidden
// behind a button.
//
// Nothing turns red until someone has actually tried something. An empty document field
// on a form you have only just opened is a starting state, not a mistake, and a form that
// greets you in red teaches you to ignore red.

import { useMemo, useRef, useState } from "react";
import { createReceivable, hashscan, type Connection } from "../lib/ats";
import {
  MAX_TERM_DAYS,
  discount,
  formatMinor,
  syntheticIsin,
  termDays,
  toBondParams,
  validate,
  type Invoice,
} from "../lib/domain";
import { formatBytes, sha256OfInvoice } from "../lib/hash";
import { addReceivable } from "../lib/receivables";

/** What a funder charges. Fixed here; a real deployment would price per debtor. */
const ANNUAL_RATE = 0.12;

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export function IssueView({
  conn,
  onIssued,
}: {
  conn: Connection | null;
  /** Switches to the funding market. Called on request, not automatically. */
  onIssued?: () => void;
}) {
  const [reference, setReference] = useState("INV-2026-0046");
  const [debtorName, setDebtorName] = useState("Acme Pte Ltd");
  const [debtorCountry, setDebtorCountry] = useState("SG");
  const [amount, setAmount] = useState("2000.00");
  const [currency, setCurrency] = useState<Invoice["currency"]>("USD");
  const [issuedAt] = useState(today());
  const [dueAt, setDueAt] = useState(inDays(60));

  const [documentHash, setDocumentHash] = useState("");
  const [docName, setDocName] = useState("");
  const [docSize, setDocSize] = useState(0);
  const [hashing, setHashing] = useState(false);
  const [hashError, setHashError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [steps, setSteps] = useState<string[]>([]);
  const [securityId, setSecurityId] = useState("");
  const [busy, setBusy] = useState(false);

  /** True once the user has asked for something. Until then, no red. */
  const [attempted, setAttempted] = useState(false);

  async function takeFile(file: File | undefined) {
    if (!file) return;
    setHashing(true);
    setHashError("");
    try {
      const digest = await sha256OfInvoice(file);
      setDocumentHash(digest);
      setDocName(file.name);
      setDocSize(file.size);
    } catch (e) {
      // Leave any previously accepted document in place. Dropping the wrong file by
      // mistake should not also discard the right one.
      setHashError(e instanceof Error ? e.message : String(e));
    } finally {
      setHashing(false);
    }
  }

  function clearFile() {
    setDocumentHash("");
    setDocName("");
    setDocSize(0);
    setHashError("");
    if (fileInput.current) fileInput.current.value = "";
  }

  const invoice = useMemo<Invoice>(
    () => ({
      reference,
      issuerAccountId: conn?.accountId ?? "",
      debtorName,
      debtorCountry,
      faceValueMinor: Math.round(Number(amount || 0) * 100),
      currency,
      issuedAt: new Date(issuedAt),
      dueAt: new Date(dueAt),
      documentHash,
      status: "SUBMITTED",
    }),
    [
      reference,
      conn,
      debtorName,
      debtorCountry,
      amount,
      currency,
      issuedAt,
      dueAt,
      documentHash,
    ],
  );

  const errors = validate(invoice);
  const days = termDays(invoice);
  const priced = days > 0 ? discount(invoice.faceValueMinor, days, ANNUAL_RATE) : null;

  /**
   * Disabled only when the action genuinely cannot run. An incomplete form leaves the
   * button live: clicking it is how someone asks what is missing, and the answer comes
   * back in the panel rather than in a tooltip — tooltips are unreachable on a touch
   * screen and to anyone navigating by keyboard.
   */
  const blocked = !conn || busy || hashing;

  const why = !conn
    ? "Connect a wallet to issue"
    : hashing
      ? "Hashing the document…"
      : undefined;

  function preview() {
    setAttempted(true);
    if (!conn || errors.length > 0) return;
    setSecurityId("");
    setSteps([JSON.stringify(toBondParams(invoice, conn.accountId), null, 2)]);
  }

  async function tokenise() {
    setAttempted(true);
    if (!conn || errors.length > 0) return;

    setBusy(true);
    setSteps([]);
    setSecurityId("");
    try {
      const id = await createReceivable(
        toBondParams(invoice, conn.accountId),
        conn.accountId,
        (s) => setSteps((prev) => [...prev, s]),
      );
      setSecurityId(id);

      // Record it before anything else can fail. The ledger cannot be asked which
      // securities this account created, so a security that is issued but never
      // indexed is invisible to the rest of the app — recoverable only by reading
      // the id out of this log and registering it by hand under Diagnostics.
      addReceivable({
        securityId: id,
        reference,
        faceValueMinor: invoice.faceValueMinor,
        currency,
        termDays: days,
        annualRate: ANNUAL_RATE,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      setSteps((prev) => [
        ...prev,
        `ERROR ${e instanceof Error ? e.message : String(e)}`,
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid two">
      <section className="card">
        <h2>Invoice</h2>
        <p className="hint">
          The document stays with you. Only its hash is published, so a funder can verify
          what they were shown without the commercial terms becoming public.
        </p>

        <div className="row">
          <div className="field">
            <label>Reference</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="field">
            <label>ISIN</label>
            <input className="mono" value={syntheticIsin(reference)} readOnly />
            <div className="note">
              Generated. Testnet identifiers are not NNA-allocated.
            </div>
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>Debtor</label>
            <input value={debtorName} onChange={(e) => setDebtorName(e.target.value)} />
          </div>
          <div className="field">
            <label>Country</label>
            <input
              value={debtorCountry}
              maxLength={2}
              onChange={(e) => setDebtorCountry(e.target.value.toUpperCase())}
            />
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>Face value</label>
            <input
              className="num"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="field">
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
        </div>

        <div className="row">
          <div className="field">
            <label>Issued</label>
            <input type="date" value={issuedAt} readOnly />
          </div>
          <div className="field">
            <label>Due</label>
            <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            <div className="note">
              {days > 0 ? `${days} days` : "—"} · maximum {MAX_TERM_DAYS}
            </div>
          </div>
        </div>

        <div className="field">
          <label>
            Invoice document
            {!documentHash && <span className="req">required</span>}
          </label>

          <div
            className={`drop${dragging ? " over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void takeFile(e.dataTransfer.files[0]);
            }}
            onClick={() => fileInput.current?.click()}
          >
            {hashing ? (
              <span>Hashing…</span>
            ) : docName ? (
              <>
                <strong>{docName}</strong>
                <span className="note">{formatBytes(docSize)} · hashed locally</span>
              </>
            ) : (
              <>
                <strong>Drop the invoice PDF here</strong>
                <span className="note">or click to choose a file</span>
              </>
            )}
          </div>

          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => void takeFile(e.target.files?.[0])}
          />

          {documentHash ? (
            <>
              <input
                className="mono"
                value={documentHash}
                readOnly
                style={{ marginTop: 8 }}
              />
              <div className="note">
                Computed in this browser — the file is never uploaded. The platform
                republishes this same hash to the audit trail via{" "}
                <span className="mono">scripts/audit-trail.ts</span>.{" "}
                <button
                  className="linklike"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearFile();
                  }}
                >
                  Choose a different file
                </button>
              </div>
            </>
          ) : (
            <div className="note">
              The hash is what a funder checks the document against. Nothing can be
              tokenised without one.
            </div>
          )}

          {hashError && (
            <div className="verdict bad" style={{ marginTop: 8 }}>
              {hashError}
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <h2>What you would receive</h2>
        <p className="hint">
          Discounted on an actual/360 basis at {(ANNUAL_RATE * 100).toFixed(0)}% — the
          convention a forfaiter quotes.
        </p>

        {priced ? (
          <>
            <dl className="summary">
              <dt>Face value</dt>
              <dd>{formatMinor(invoice.faceValueMinor, currency)}</dd>

              <dt>Term</dt>
              <dd>{days} days</dd>

              <dt>Discount</dt>
              <dd>− {formatMinor(priced.discountMinor, currency)}</dd>

              <div className="rule" />

              <dt>Paid to you today</dt>
              <dd className="emphasis">{formatMinor(priced.proceedsMinor, currency)}</dd>

              <dt>Funder&rsquo;s annualised return</dt>
              <dd>{(priced.effectiveAnnualReturn * 100).toFixed(2)}%</dd>
            </dl>

            <p className="hint" style={{ marginTop: 16 }}>
              The funder&rsquo;s return exceeds the quoted rate because the discount is
              earned on the smaller sum they actually advance.
            </p>
          </>
        ) : (
          <div className="empty">Enter a due date to see pricing.</div>
        )}

        {/* Red is reserved for something that went wrong. Until someone has asked for
            an action, an incomplete form is simply incomplete. */}
        {attempted && errors.length > 0 && (
          <div className="verdict bad" style={{ marginTop: 8 }}>
            {errors.join(" · ")}
          </div>
        )}

        <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
          <button className="primary" disabled={blocked} onClick={tokenise} title={why}>
            {busy ? "Working…" : "Tokenise receivable"}
          </button>
          <button className="ghost" disabled={blocked} onClick={preview} title={why}>
            Preview bond parameters
          </button>
        </div>

        {busy && (
          <p className="hint" style={{ marginTop: 10 }}>
            Six wallet prompts: deploy, four role grants, then the mint. Approve each one.
          </p>
        )}

        {!conn && (
          <p className="hint" style={{ marginTop: 10 }}>
            Connect a wallet to issue.
          </p>
        )}

        {securityId && (
          <div className="verdict ok" style={{ marginTop: 14 }}>
            <div>
              Issued as{" "}
              <a href={hashscan.contract(securityId)} target="_blank" rel="noreferrer">
                {securityId}
              </a>
            </div>
            <div style={{ marginTop: 10 }}>
              <button className="ghost" onClick={() => onIssued?.()}>
                View in funding market →
              </button>
            </div>
          </div>
        )}

        {steps.length > 0 && (
          <pre className="log" style={{ marginTop: 14 }}>
            {steps.join("\n")}
          </pre>
        )}
      </section>
    </div>
  );
}
