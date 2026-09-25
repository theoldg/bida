/**
 * WebCrypto off `globalThis`, or a refusal saying what would otherwise go weak
 * or in the clear. Each caller types it as the slice it uses, so core stays
 * free of DOM lib types. Internal: not exported from the package.
 */
export function webCrypto<C>(refusal: string, { subtle = true } = {}): C {
  const c = (globalThis as { crypto?: { subtle?: unknown; getRandomValues?: unknown } }).crypto;
  if (!c || typeof c.getRandomValues !== "function" || (subtle && !c.subtle)) {
    throw new Error(`WebCrypto is unavailable; ${refusal}`);
  }
  return c as C;
}
