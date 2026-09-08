// apps/web/src/App.tsx
import { useEffect, useRef, useState } from "react";
import "./styles.css";
import { connectWallet, hashscan, type Connection } from "./lib/ats";
import { IssueView } from "./views/IssueView";
import { FundView } from "./views/FundView";
import { DebugView } from "./views/DebugView";

type Tab = "issue" | "fund" | "debug";

/**
 * Set when the user disconnects on purpose.
 *
 * Disconnecting in a dapp cannot revoke anything: MetaMask still lists the site under
 * Connected sites, and `eth_accounts` still returns the account. Without this flag the
 * silent re-pair below would undo the click on the next reload, and the button would
 * look broken. So the intent is remembered here instead.
 */
const DISCONNECTED_KEY = "forfait.wallet.disconnected";

const wasDisconnected = (): boolean => {
  try {
    return localStorage.getItem(DISCONNECTED_KEY) === "1";
  } catch {
    return false;
  }
};

const rememberDisconnected = (v: boolean): void => {
  try {
    if (v) localStorage.setItem(DISCONNECTED_KEY, "1");
    else localStorage.removeItem(DISCONNECTED_KEY);
  } catch {
    /* storage disabled — the choice just will not survive a reload */
  }
};

export default function App() {
  const [conn, setConn] = useState<Connection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("issue");

  async function connect() {
    setConnecting(true);
    setError("");
    rememberDisconnected(false);
    try {
      setConn(await connectWallet());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }

  /**
   * Forgets the wallet in this app only.
   *
   * The SDK stays initialised in memory, which is harmless — every read is guarded on
   * a live connection, so nothing can reach the ledger while this is null.
   */
  function disconnect() {
    setConn(null);
    setError("");
    rememberDisconnected(true);
  }

  /**
   * Re-pairs after a page reload without prompting.
   *
   * The SDK's network configuration lives in memory, so a refresh leaves the whole app
   * unable to read the ledger until a wallet pairs again. `eth_accounts` — unlike
   * `eth_requestAccounts` — never opens MetaMask: a non-empty result means this origin
   * is already authorised, and pairing again is silent.
   *
   * Failures here are deliberately quiet. The user did not ask for this, so the worst
   * case should be the Connect button they would have seen anyway, not an error.
   */
  useEffect(() => {
    (async () => {
      if (wasDisconnected()) return;

      const eth = window.ethereum;
      if (!eth) return;
      try {
        const accounts = (await eth.request({
          method: "eth_accounts",
        })) as string[];
        if (accounts.length === 0) return;
        setConnecting(true);
        setConn(await connectWallet());
      } catch {
        /* leave the Connect button showing */
      } finally {
        setConnecting(false);
      }
    })();
  }, []);

  return (
    <div className="app">
      <header className="top">
        <div
          className="brand"
          style={{ display: "flex", alignItems: "center", gap: 10 }}
        >
          <img src="/logo-mark.svg" alt="" width={28} height={28} />
          <div>
            <h1>Forfait</h1>
            <span className="tag">Non-recourse receivables financing</span>
          </div>
        </div>

        {conn ? (
          <WalletChip conn={conn} onDisconnect={disconnect} />
        ) : (
          <button className="primary" onClick={connect} disabled={connecting}>
            {connecting ? "Reconnecting…" : "Connect wallet"}
          </button>
        )}
      </header>

      {error && (
        <div className="verdict bad" style={{ marginBottom: 20 }}>
          {error}
        </div>
      )}

      <nav className="tabs">
        <button aria-selected={tab === "issue"} onClick={() => setTab("issue")}>
          Raise a receivable
        </button>
        <button aria-selected={tab === "fund"} onClick={() => setTab("fund")}>
          Fund a receivable
        </button>
        <button aria-selected={tab === "debug"} onClick={() => setTab("debug")}>
          Diagnostics
        </button>
      </nav>

      {/*
        The receivable index is not passed down. Views subscribe to it directly through
        useReceivables(), so issuing on one tab updates the other without App knowing
        either of them exists. The only thing App still owns is which tab is showing —
        and issuing jumps to the funding market, because that is the next thing anyone
        who just tokenised an invoice wants to see.
      */}
      {tab === "issue" && (
        <IssueView conn={conn} onIssued={() => setTab("fund")} />
      )}
      {tab === "fund" && <FundView conn={conn} />}
      {tab === "debug" && <DebugView conn={conn} />}
    </div>
  );
}

/**
 * The paired account, with the SDK's network configuration a click away.
 *
 * One thing deliberately does not hide behind that click. If the configuration fails to
 * apply, `factoryId` and `resolverId` come back empty and nothing complains: reads keep
 * working, the app looks healthy, and every write then fails with an error naming
 * something unrelated. That cost two days once — FRICTION.md #1 — so the badge itself
 * turns into a warning. The detail is on demand; the alarm is not.
 */
function WalletChip({
  conn,
  onDisconnect,
}: {
  conn: Connection;
  onDisconnect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const misconfigured = !conn.factoryId || !conn.resolverId;

  useEffect(() => {
    if (!open) return;

    const onClick = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="wallet" ref={box}>
      <button
        className="wallet-chip"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Connection details"
      >
        <span className="mono">{conn.accountId}</span>
        <span className={`badge ${misconfigured ? "alert" : "live"}`}>
          {misconfigured ? "Config error" : "Hedera testnet"}
        </span>
      </button>

      {open && (
        <div className="popover">
          <dl className="summary">
            <dt>Hedera account</dt>
            <dd className="mono">
              <a
                href={hashscan.account(conn.accountId)}
                target="_blank"
                rel="noreferrer"
              >
                {conn.accountId}
              </a>
            </dd>

            <dt>EVM address</dt>
            <dd className="mono small">{conn.evmAddress}</dd>

            <dt>Factory</dt>
            <dd className="mono">{conn.factoryId || "— empty —"}</dd>

            <dt>Resolver</dt>
            <dd className="mono">{conn.resolverId || "— empty —"}</dd>
          </dl>

          {misconfigured ? (
            <div className="verdict bad" style={{ marginTop: 10 }}>
              The SDK configuration did not apply. Reads will keep working and
              every write will fail with an unrelated error. Reconnect; if it
              persists, check the plural config arrays in{" "}
              <span className="mono">ats.ts</span>.
            </div>
          ) : (
            <div className="verdict ok" style={{ marginTop: 10 }}>
              Configuration applied. Writes should reach the ledger.
            </div>
          )}

          <div className="popover-foot">
            <button
              className="ghost"
              onClick={() => {
                setOpen(false);
                onDisconnect();
              }}
            >
              Disconnect
            </button>
            <p className="note">
              Forgets the wallet here only. MetaMask still lists this site under
              Connected sites — revoke it there to withdraw access.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
