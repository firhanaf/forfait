// apps/web/src/views/FunderWallet.tsx
//
// The money leg.
//
// The receivable moves through MetaMask and ATS. The cash does not: a funder signs in
// with an email address, gets a wallet without ever seeing a seed phrase, and pays the
// freelancer from it. That is the whole argument for Privy here — the person financing a
// $2,000 invoice should not have to become a wallet user first.
//
// Identity lives in useFunder(), not here, because the same account has to receive the
// receivable. Two sources of truth for who the funder is would let the security and the
// cash end up with different people.

import { useState } from "react";
import {
  useCreateWallet,
  useLoginWithEmail,
  usePrivy,
  useSendTransaction,
} from "@privy-io/react-auth";
import { hashscan } from "../lib/ats";
import { formatMinor } from "../lib/domain";
import type { Funder } from "../lib/funder";

/**
 * What the funder actually sends on testnet.
 *
 * The real leg is the discounted proceeds. At testnet prices that runs to tens of
 * thousands of HBAR, which no testnet account holds, so the transfer is symbolic and
 * says so on screen. On mainnet this leg would be a stablecoin and the amount would be
 * the real one; nothing else about the flow changes.
 */
const DEMO_HBAR = "100";

/** 1 HBAR in weibars. The relay presents HBAR with eighteen decimals. */
const WEIBARS_PER_HBAR = 10n ** 18n;

/**
 * Used only to explain the gap between what testnet can carry and what the leg is
 * actually worth. Read off HashScan on 8 September; it will drift, which is why the
 * sentence it feeds says "roughly".
 */
const HBAR_USD = 0.0824;

export function FunderWallet({
  funder,
  freelancerEvmAddress,
  proceedsMinor,
  currency,
  onPaid,
}: {
  funder: Funder;
  freelancerEvmAddress: string;
  proceedsMinor: number;
  currency: "USD" | "SGD" | "EUR";
  onPaid?: (txHash: string) => void;
}) {
  const { ready, authenticated, user, logout } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { sendTransaction } = useSendTransaction();
  const { createWallet } = useCreateWallet();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");

  const { evmAddress, accountId, balance } = funder;

  /**
   * Unknown balance must not block the button. Only a balance that has actually been
   * read and found short should — a mirror-node hiccup is not a reason to refuse.
   */
  const insufficient = balance !== null && Number(balance) < Number(DEMO_HBAR);

  /** What the leg would really be worth, derived rather than written down once. */
  const realHbar = Math.round(proceedsMinor / 100 / HBAR_USD);

  function resetLogin() {
    setCodeSent(false);
    setCode("");
    setError("");
  }

  async function send() {
    setBusy(true);
    setError("");
    try {
      const receipt = await sendTransaction({
        to: freelancerEvmAddress,
        value: (BigInt(DEMO_HBAR) * WEIBARS_PER_HBAR).toString(),
      });

      // The returned shape is not pinned by the SDK's types; both keys appear in the
      // wild, so read either rather than assuming one.
      const hash =
        (receipt as { hash?: string; transactionHash?: string })?.hash ??
        (receipt as { transactionHash?: string })?.transactionHash ??
        "";

      setTxHash(hash);
      funder.refresh();
      onPaid?.(hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <section className="card">
        <h2>Pay the freelancer</h2>
        <div className="empty">Loading…</div>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Pay the freelancer</h2>
      <p className="hint">
        The receivable moves through MetaMask. The money does not — a funder signs in
        with an email address and pays from a wallet they never had to create. The same
        account receives the receivable, so both legs land on one identity.
      </p>

      {!authenticated ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "flex-end",
          }}
        >
          <div className="field" style={{ maxWidth: 260 }}>
            <label>Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="funder@example.com"
              disabled={codeSent}
            />
          </div>

          {!codeSent ? (
            <button
              className="primary"
              disabled={!email || busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await sendCode({ email });
                  setCodeSent(true);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Sending…" : "Send code"}
            </button>
          ) : (
            <>
              <div className="field" style={{ maxWidth: 140 }}>
                <label>Code</label>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoFocus
                />
              </div>

              <button
                className="primary"
                disabled={!code || busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await loginWithCode({ code });
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Signing in…" : "Sign in"}
              </button>

              {/* Without this, a mistyped address is a dead end: the code never
                  arrives and there is no way back to the email field. */}
              <button
                className="linklike"
                style={{ marginBottom: 10 }}
                onClick={resetLogin}
              >
                Use a different email
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          {!evmAddress && (
            <div className="verdict bad" style={{ marginBottom: 12 }}>
              No Privy wallet on this account yet.{" "}
              <button
                className="linklike"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await createWallet();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Create one
              </button>
            </div>
          )}

          <dl className="summary">
            <dt>Signed in as</dt>
            <dd>{user?.email?.address ?? "—"}</dd>

            <dt>Wallet</dt>
            <dd className="mono small">
              {evmAddress ? (
                <a href={hashscan.account(evmAddress)} target="_blank" rel="noreferrer">
                  {evmAddress}
                </a>
              ) : (
                "none yet"
              )}
            </dd>

            <dt>Hedera account</dt>
            <dd className="mono">
              {accountId ? (
                <a href={hashscan.account(accountId)} target="_blank" rel="noreferrer">
                  {accountId}
                </a>
              ) : (
                "created on first transfer"
              )}
            </dd>

            <dt>Balance</dt>
            <dd>
              {balance === null ? "—" : `${balance} ℏ`}{" "}
              <button
                className="linklike"
                style={{ marginLeft: 8 }}
                onClick={funder.refresh}
              >
                refresh
              </button>
            </dd>

            <dt>Owed to the freelancer</dt>
            <dd className="emphasis">{formatMinor(proceedsMinor, currency)}</dd>
          </dl>

          <p className="hint" style={{ marginTop: 12 }}>
            This sends <strong>{DEMO_HBAR} ℏ</strong> on testnet, not{" "}
            {formatMinor(proceedsMinor, currency)} — roughly{" "}
            {realHbar.toLocaleString()} ℏ at current prices, which no testnet account
            holds. On mainnet this leg is a stablecoin transfer of the actual proceeds;
            the flow is the same, the number is not.
          </p>

          <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
            <button
              className="primary"
              disabled={busy || !evmAddress || !freelancerEvmAddress || insufficient}
              onClick={send}
              title={
                insufficient ? "Not enough HBAR — fund this wallet first" : undefined
              }
            >
              {busy ? "Sending…" : `Pay ${DEMO_HBAR} ℏ`}
            </button>

            <button
              className="ghost"
              disabled={busy}
              onClick={async () => {
                await logout();
                // Privy clears its own session; this component's login state is
                // separate and would otherwise strand the next sign-in on a code
                // input with no code.
                resetLogin();
                setEmail("");
                setTxHash("");
              }}
            >
              Sign out
            </button>
          </div>

          {insufficient && (
            <p className="hint" style={{ marginTop: 10 }}>
              This wallet holds {balance} ℏ. Send it testnet HBAR first — on Hedera the
              account is created by the first transfer it receives, and the sender pays
              for that, so the first top-up costs about 0.6 ℏ more than later ones.
            </p>
          )}
        </>
      )}

      {error && (
        <div className="verdict bad" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      {txHash && (
        <div className="verdict ok" style={{ marginTop: 12 }}>
          Paid.{" "}
          <a href={hashscan.transaction(txHash)} target="_blank" rel="noreferrer">
            {txHash.slice(0, 18)}…
          </a>
        </div>
      )}
    </section>
  );
}
