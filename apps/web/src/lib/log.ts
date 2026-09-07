// apps/web/src/lib/log.ts
//
// The diagnostics log, kept outside React.
//
// Switching tabs unmounts the view that renders it, which would take a `useState` log
// with it — and the log is often the only record of what a failed write actually said.
// Losing it on the way to check the funding tab is exactly when it is needed most.
//
// Deliberately in memory only. This is a working record for one sitting, not history:
// it holds account ids and raw SDK payloads, which do not belong in storage that
// outlives the session.

import { useSyncExternalStore } from 'react';

/** Beyond this the oldest lines are dropped. Long enough for a full test pass. */
const LIMIT = 500;

let entries: string[] = [];
const listeners = new Set<() => void>();

function commit(next: string[]): void {
  entries = next;
  for (const listener of listeners) listener();
}

export function appendLog(line: string): void {
  const stamped = `${new Date().toLocaleTimeString()}  ${line}`;
  const next = [...entries, stamped];
  commit(next.length > LIMIT ? next.slice(-LIMIT) : next);
}

export function clearLog(): void {
  commit([]);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLog(): string[] {
  return useSyncExternalStore(
    subscribe,
    () => entries,
    () => entries,
  );
}
