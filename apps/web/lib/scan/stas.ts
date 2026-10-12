// Doc: docs/scan-worker.md#staś-mode
/**
 * Staś mode's flag, in `localStorage` like the theme: `/diag`, which sets it,
 * must never wait on Dexie, and a scan reads it mid-resize.
 */
const KEY = "bida.stas";

export function stasMode(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setStasMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch { /* private mode: the toggle is this session's, and that is all */ }
}
