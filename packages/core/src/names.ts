/**
 * A member's name *is* their identity: screens show bare names, so a second
 * "Ana" is two people nobody can tell apart. `nameTaken` is a courtesy
 * refusal; what holds the invariant is `memberIdFor` — two phones adding "Ana"
 * offline write the same entity ([docs/invariants.md](../../../docs/invariants.md)).
 * That needs an immutable key, so names can't be renamed: a freed name would
 * inherit its old id's balance.
 */

/** Same name as a person reads it: trimmed, inner spaces collapsed, case-folded, NFC. */
export function nameKey(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/** Is this name already one of `taken`? Blank is nobody, so it is never taken. */
export function nameTaken(name: string, taken: readonly string[]): boolean {
  const key = nameKey(name);
  return key.length > 0 && taken.some((other) => nameKey(other) === key);
}

/**
 * FNV-1a over UTF-8 four times with different offsets: 128 bits. Hand-rolled
 * (no dependency; `crypto.subtle` is async). Not cryptographic — it only has
 * to avoid collisions within one group's names.
 */
const FNV_PRIME = 0x01000193;
const BASES = [0x811c9dc5, 0x9dc5811c, 0xc5811c9d, 0x1c9dc581];

function fnv1a(bytes: Uint8Array, base: number): number {
  let h = base;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

function hash128(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return BASES.map((base) => fnv1a(bytes, base).toString(16).padStart(8, "0")).join("");
}

/**
 * The member id for a name in a group: same name on two phones, one member;
 * scoped per group. UUID-shaped but not one — don't rely on version bits.
 * Older members with a random `newId()` can't be re-keyed, since ops are never
 * rewritten.
 */
export function memberIdFor(groupId: string, name: string): string {
  const hex = hash128(`member\n${groupId}\n${nameKey(name)}`);
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20),
  ].join("-");
}

/** The avatar hue, derived so two phones adding "Ana" write byte-identical creates. */
export function colorSeedFor(groupId: string, name: string): number {
  return parseInt(hash128(`color\n${groupId}\n${nameKey(name)}`).slice(0, 8), 16) % 360;
}
