// apps/web/src/lib/receivables.ts
//
// A client-side index of the receivables this browser knows about.
//
// The chain stays the source of truth for anything that can change — supply, holder,
// paused. This file only answers a question the chain cannot: *which* securities exist.
// ATS has no "list every security created by this account" query, and the commercial
// terms entered at issuance (face value, term, rate) are not all recoverable from the
// contract afterwards.
//
// A production deployment would index this server-side from mirror-node contract events.
// localStorage is the honest hackathon-scale substitute, and it buys one thing component
// state does not: a refresh in the middle of a demo does not erase the work.
//
// Storage is treated as unreliable throughout. Private-mode browsers throw on access
// rather than returning null, and quota can be exhausted. Every path degrades to an
// in-memory session rather than crashing the page.

import { useSyncExternalStore } from "react";
import type { Invoice } from "./domain";

export interface Receivable {
  /** Hedera contract id of the ATS diamond, e.g. 0.0.10404061 */
  securityId: string;
  /** Invoice reference as the freelancer typed it, e.g. INV-2026-0045 */
  reference: string;
  /**
   * Who issued it.
   *
   * Needed to say whether a receivable has been sold without asking who is looking.
   * "Funded" used to mean "held by the funder currently signed in", which made a sold
   * receivable read as available to everyone else — including every judge who opens the
   * deployed link. Whether the issuer still holds it is a fact about the receivable.
   */
  issuerAccountId: string;
  /** Face value in minor units. 100_000 is $1,000.00 */
  faceValueMinor: number;
  /**
   * Carried because the contract stores currency as a hex-encoded ISO 4217 code
   * ("0x555344") that this app does not decode yet, and rendering an SGD invoice
   * with a dollar sign is the kind of error nobody catches in a demo.
   */
  currency: Invoice["currency"];
  termDays: number;
  annualRate: number;
  createdAt: string;
}

const KEY = "forfait.receivables.v1";

/**
 * What a first-time visitor sees.
 *
 * These are real securities on Hedera testnet, issued by this project and verifiable on
 * HashScan — not fixtures. Without them the deployed app greets anyone who opens the link
 * with "Nothing issued yet", which is a worse first impression than not deploying at all.
 *
 * Seeded only when the key has never been written. Clearing the index from Diagnostics
 * writes an empty array, and that stays empty — otherwise "Clear index" would appear
 * broken, which is its own kind of bug.
 *
 * Anything issued before the timestamp fix belongs nowhere near this list: those bonds
 * carry millisecond maturities and can never be redeemed. See FRICTION.md #4.
 */
const SEED: Receivable[] = [
  // Open — nobody has funded it. The one a visitor can imagine buying.
  {
    securityId: "0.0.10431279",
    reference: "INV-2026-0048",
    issuerAccountId: "0.0.10085748",
    faceValueMinor: 200000,
    currency: "USD",
    termDays: 60,
    annualRate: 0.12,
    createdAt: "2026-09-09T03:19:37.230Z",
  },
  // Funded — held by 0.0.10418332, the account behind an emailed-in Privy wallet.
  {
    securityId: "0.0.10431227",
    reference: "INV-2026-0049",
    issuerAccountId: "0.0.10085748",
    faceValueMinor: 350000,
    currency: "USD",
    termDays: 45,
    annualRate: 0.12,
    createdAt: "2026-09-09T03:14:30.941Z",
  },
  // Settled — redeemed at maturity by schedule 0.0.10416050, eighteen milliseconds
  // after expiry, with nobody signing anything. Kept under its test name because that
  // is what it was: no real invoice matures in eight minutes.
  {
    securityId: "0.0.10416012",
    reference: "TEST-736288",
    issuerAccountId: "0.0.10085748",
    faceValueMinor: 200000,
    currency: "USD",
    termDays: 1,
    annualRate: 0.12,
    createdAt: "2026-09-09T02:58:59.847Z",
  },
];

// Replaced wholesale on every write, never mutated in place. useSyncExternalStore
// compares snapshots by reference, so mutating this would render nothing.
let cache: Receivable[] = load();

const listeners = new Set<() => void>();

function load(): Receivable[] {
  try {
    const raw = localStorage.getItem(KEY);

    // Never visited — not the same as deliberately emptied.
    if (raw === null) return [...SEED];

    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Receivable[]) : [...SEED];
  } catch {
    return [...SEED];
  }
}

function commit(next: Receivable[]): void {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Storage disabled or full. The session keeps working; it just will not
    // survive a refresh.
  }
  for (const listener of listeners) listener();
}

/** Records a newly issued receivable. Ignores a security id already present. */
export function addReceivable(r: Receivable): void {
  if (cache.some((x) => x.securityId === r.securityId)) return;
  commit([r, ...cache]);
}

/** Removes it from the index only. The security itself stays on the ledger. */
export function forgetReceivable(securityId: string): void {
  commit(cache.filter((x) => x.securityId !== securityId));
}

/** Empties the index so a demo can be recorded from a clean state. */
export function clearReceivables(): void {
  commit([]);
}

/** Restores the seeded receivables, for a demo that has been cleared once too often. */
export function restoreSeed(): void {
  commit([...SEED]);
}

export function getReceivables(): Receivable[] {
  return cache;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Subscribes a component to the index. Any view can call this — there is no provider
 * and nothing is passed through props, so the issue and funding tabs stay in step
 * without App.tsx knowing either of them exists.
 */
export function useReceivables(): Receivable[] {
  return useSyncExternalStore(
    subscribe,
    () => cache,
    () => cache,
  );
}

// ─────────────────────────────────────────────────────────────
//
// Changing SEED
//
// Do not type the values by hand — the index in your browser already holds the exact
// entries, and retyping them is how a face value ends up disagreeing with the one the
// contract was issued with.
//
// With the app open, in the browser console:
//
//   copy(localStorage.getItem('forfait.receivables.v1'))
//
// Curate rather than dump. Three receivables in different states tell the whole
// lifecycle at a glance; eight test bonds tell a different story. The order above is
// the display order, and it runs Open → Funded → Settled deliberately.
//
// Never seed anything issued before the timestamp fix. Those bonds carry millisecond
// maturities, can never be redeemed, and would sit in the showcase advertising
// themselves as available.
