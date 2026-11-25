import { useSyncExternalStore } from 'react';

let version = 0;
const listeners = new Set<() => void>();

/** Call after the history changes outside the screen that shows it (delete, undo). */
export function bumpHistoryVersion() {
  version += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Changes every time `bumpHistoryVersion` runs: put it in a screen's load deps to reload it. */
export function useHistoryVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}
