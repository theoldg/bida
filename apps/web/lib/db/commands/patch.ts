/**
 * What a patch is allowed to carry, which is the merge rule.
 *
 * An op names the fields that changed and no others. That is the whole of
 * ADR-0002: two people editing different fields of the same entry offline both
 * survive, because neither op mentions the other's field. A field written back
 * unchanged still wins its slot at fold time, and silently undoes whatever the
 * other device did to it — so "only what changed" is not tidiness, it is what
 * makes the log mergeable.
 *
 * The rule lives here, once, because it was written out twice before: the
 * expense editor and the transfer editor each rolled their own copy, and the
 * copies drifted. One guarded the derived base amount; the other wrote it on
 * every edit, so correcting a rate to one that rounds to the same figure
 * clobbered a peer's offline change to it.
 */

/**
 * The entries that actually carry something.
 *
 * A `create` writes no field it would only be defaulting. The fold treats
 * absent as the default already, so `receiptItems: null` on an expense nobody
 * scanned is bytes in the log, a row in its own history saying nothing changed,
 * and no other effect — and eight such fields ride on every ordinary expense,
 * a quarter of the op (ADR-0002).
 *
 * **Only a create may do this.** In an `update` an absent field means "leave it
 * alone", so clearing one there still has to write the null.
 */
export function only(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/** JSON with object keys in a fixed order, so `{a,b}` and `{b,a}` compare equal. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v as Record<string, unknown>).sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v);
}

/**
 * Is this the value the entity already holds?
 *
 * `null` and absent are the same value — not set. `only()` leaves an unset
 * field off the create op entirely while the form always sends an explicit
 * `null` for it, and reading those as different wrote a phantom revision on
 * every first edit.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a ?? null) === null || (b ?? null) === null) return (a ?? null) === (b ?? null);
  if (typeof a !== "object" || typeof b !== "object") return false;
  return stableJson(a) === stableJson(b);
}

/**
 * The fields of `changes` that differ from what the entity already holds —
 * an `update` op's patch. A form sends its whole self back on every save, so
 * without this every edit would carry every field.
 */
export function changedFields(existing: object, changes: object): Record<string, unknown> {
  // `object`, not `Record<string, unknown>`: an entity is an interface without
  // an index signature, so the stricter type would refuse every caller.
  const held = existing as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes as Record<string, unknown>)) {
    if (value === undefined) continue;
    if (sameValue(value, held[key])) continue;
    patch[key] = value;
  }
  return patch;
}

/**
 * The same rule for a field nobody typed. A derived field — a base amount, a
 * normalised payer map — is recomputed from what did change, so it has to be
 * re-tested against the stored value rather than written because its inputs
 * were touched: recomputing is not moving.
 */
export function setDerived(
  patch: Record<string, unknown>,
  key: string,
  value: unknown,
  existing: unknown,
): void {
  if (sameValue(value, existing)) delete patch[key];
  else patch[key] = value;
}
