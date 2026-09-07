// apps/web/src/lib/receivables.ts
//
// A client-side index of the receivables this browser has issued.
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

import { useSyncExternalStore } from 'react';
import type { Invoice } from './domain';

export interface Receivable {
  /** Hedera contract id of the ATS diamond, e.g. 0.0.10404061 */
  securityId: string;
  /** Invoice reference as the freelancer typed it, e.g. INV-2026-0045 */
  reference: string;
  /** Face value in minor units. 100_000 is $1,000.00 */
  faceValueMinor: number;
  /**
   * Carried because the contract stores currency as a hex-encoded ISO 4217 code
   * ("0x555344") that this app does not decode yet, and rendering an SGD invoice
   * with a dollar sign is the kind of error nobody catches in a demo.
   */
  currency: Invoice['currency'];
  termDays: number;
  annualRate: number;
  createdAt: string;
}

const KEY = 'forfait.receivables.v1';

// Replaced wholesale on every write, never mutated in place. useSyncExternalStore
// compares snapshots by reference, so mutating this would render nothing.
let cache: Receivable[] = load();

const listeners = new Set<() => void>();

function load(): Receivable[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as Receivable[]) : [];
  } catch {
    return [];
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
