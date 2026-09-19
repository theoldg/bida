/**
 * A member's name *is* their identity: every screen shows a bare name and no
 * id, so a second "Ana" is two people nobody can tell apart, one quietly
 * holding half the bill.
 *
 * `nameTaken` is the courtesy refusal at the field, and like every refusal it
 * reads one replica. What holds the invariant is `memberIdFor`: two phones
 * adding "Ana" offline write the *same* entity, so the creates merge
 * ([docs/invariants.md](../../../docs/invariants.md)).
 *
 * That works only while the key is immutable — a natural key over a mutable
 * name would free a name whose id is still occupied, and the next person to
 * type it would inherit the balance. Forbidding rename is what pays for this.
 */

/**
 * Same-name is judged by what a person reads, not by bytes: spaces around it,
 * a double space inside it and capitals are all the same name to everyone
 * looking at the list. NFC first, so a typed "é" matches a composed one.
 */
export function nameKey(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/** Is this name already one of `taken`? Blank is nobody, so it is never taken. */
export function nameTaken(name: string, taken: readonly string[]): boolean {
  const key = nameKey(name);
  return key.length > 0 && taken.some((other) => nameKey(other) === key);
}

/**
 * FNV-1a over UTF-8, four times with different offset bases: 128 bits of id.
 * Hand-rolled because a hash library is a forever dependency
 * ([CLAUDE.md](../../../CLAUDE.md)) and `crypto.subtle` is async while every
 * caller here is pure and synchronous.
 *
 * Not cryptographic and not required to be — nothing is authenticated by it,
 * and it only has to avoid colliding across one group's handful of names.
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
 * The member id for a name in a group. Deterministic, so the same name typed
 * on two phones is one member — and scoped to the group, so "Ana" in one trip
 * is nobody's business in another.
 *
 * Shaped like `newId()`'s UUID so ids stay one kind of thing everywhere, but
 * it is not one: nothing may depend on the version bits. **Members carrying a
 * random `newId()` cannot be re-keyed** — every entry references them and ops
 * are never rewritten — so some groups knowingly keep the gap.
 */
export function memberIdFor(groupId: string, name: string): string {
  const hex = hash128(`member\n${groupId}\n${nameKey(name)}`);
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20),
  ].join("-");
}

/**
 * The avatar hue for that member, from the same key. Derived rather than
 * random so two phones adding "Ana" at once write a byte-identical create —
 * whichever one the merge keeps, nothing about her changes.
 */
export function colorSeedFor(groupId: string, name: string): number {
  return parseInt(hash128(`color\n${groupId}\n${nameKey(name)}`).slice(0, 8), 16) % 360;
}
