// apps/web/src/lib/funder.ts
//
// Who the funder is.
//
// One answer for the whole app. The receivable is released to this account and the
// payment comes from it, so the two legs cannot drift onto different identities — which
// is exactly what happened when the transfer target was a constant and the payer was
// whoever had signed in.
//
// The Hedera account id is resolved rather than configured. A Privy wallet is an EVM
// address first; the account behind it does not exist until something sends it HBAR,
// and on Hedera that first transfer is what creates it.

import { useCallback, useEffect, useState } from "react";
import { useWallets } from "@privy-io/react-auth";

const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";

export interface Funder {
  /** Privy embedded wallet address, or "" when nobody is signed in. */
  evmAddress: string;
  /** Hedera account id behind that address, or "" until a transfer has created it. */
  accountId: string;
  /** HBAR to four decimals, or null while unknown. */
  balance: string | null;
  /** True once the address has been looked up, whatever the answer was. */
  resolved: boolean;
  refresh: () => void;
}

interface Lookup {
  address: string;
  accountId: string;
  balance: string | null;
}

export function useFunder(): Funder {
  const { wallets } = useWallets();
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [reads, setReads] = useState(0);

  /**
   * Strictly the embedded wallet. Falling back to whatever else is connected would
   * quietly make MetaMask the funder — and MetaMask is already the freelancer.
   */
  const wallet = wallets.find((w) => w.walletClientType === "privy");
  const evmAddress = wallet?.address ?? "";

  const refresh = useCallback(() => setReads((n) => n + 1), []);

  /**
   * The balance changes from outside this app — the funder tops the wallet up
   * elsewhere and nothing here would know. Coming back to the tab is the signal.
   */
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  useEffect(() => {
    if (!evmAddress) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${MIRROR}/accounts/${evmAddress}`);

        // 404 is the ordinary state of a wallet nobody has paid yet, not a failure.
        if (!res.ok) {
          if (!cancelled) {
            setLookup({ address: evmAddress, accountId: "", balance: "0" });
          }
          return;
        }

        const data = await res.json();
        if (cancelled) return;

        setLookup({
          address: evmAddress,
          accountId: data?.account ?? "",
          balance: ((data?.balance?.balance ?? 0) / 1e8).toFixed(4),
        });
      } catch {
        if (!cancelled) {
          setLookup({ address: evmAddress, accountId: "", balance: null });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [evmAddress, reads]);

  // Derived rather than cleared. A lookup for a previous address is simply not shown,
  // which avoids writing state on sign-out just to blank it.
  const current = lookup?.address === evmAddress ? lookup : null;

  return {
    evmAddress,
    accountId: current?.accountId ?? "",
    balance: current?.balance ?? null,
    resolved: !!current,
    refresh,
  };
}
