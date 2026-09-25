/**
 * The change signal behind a module-level store, for `useSyncExternalStore`.
 * `subscribe` is one function for the store's life: a fresh one per render
 * makes React unsubscribe and resubscribe on every render.
 */
export function signal(): {
  emit: () => void;
  subscribe: (listener: () => void) => () => void;
  /** Drop every listener. Test seams only. */
  clear: () => void;
} {
  const listeners = new Set<() => void>();
  return {
    emit: () => { for (const listener of listeners) listener(); },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    clear: () => listeners.clear(),
  };
}
