/**
 * What a patch is allowed to carry, which is the merge rule.
 *
 * **An entry's content is written whole; everything else is written per field.**
 * The last edit wins the entity, so the version everybody ends up looking at is
 * one a person actually saw on a screen. Per-field merging bought concurrency
 * nobody was using and cost the one thing no rule can repair: an amount from one
 * phone sitting beside a split from another that does not sum to it, an entry
 * dropped out of balances behind a warning with no way to recover what either
 * person meant. See ADR-0002 and docs/invariants.md.
 *
 * Two fields stay out of the whole, and the reasons are different:
 *
 * - **`deletedAt` merges per field.** A whole write carries whatever the editing
 *   device believed, so a rename saved offline would re-tombstone a member a
 *   healer had just put back. Lifecycle is decided by delete ops and repairs,
 *   never by a content save.
 * - **`createdAt` is write-once**, enforced in the fold (`WRITE_ONCE_FIELDS`),
 *   because every whole write now carries one.
 *
 * The rule lives here, once, because it was written out twice before: the
 * expense editor and the transfer editor each rolled their own copy, and the
 * copies drifted. One guarded the derived base amount; the other wrote it on
 * every edit, so correcting a rate to one that rounds to the same figure
 * clobbered a peer's offline change to it.
 */

/**
 * Fields a content save never carries, whatever the form holds. `id`/`groupId`
 * the fold refuses anyway; these two it would take.
 */
const NOT_CONTENT = new Set(["id", "groupId", "createdAt", "deletedAt"]);

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

/**
 * The whole of an entry's content, as an `update` patch.
 *
 * Every content field the entity has, whether or not this save moved it —
 * that is what "the last edit wins the entity" means. An absent field is
 * written as an explicit `null`: in an update, leaving it off means "leave it
 * alone", which is exactly the per-field merge this replaces, so a save that
 * clears the category has to say so.
 */
export function wholeEntity(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (NOT_CONTENT.has(key)) continue;
    out[key] = value === undefined ? null : value;
  }
  return out;
}

/**
 * Did this save move anything at all?
 *
 * A whole-entity patch names every field, so it cannot answer this itself — and
 * an op that changes nothing is a row in the history saying nothing happened.
 * Compared against the stored entity by the same rule the diff used to use.
 */
export function movesAnything(existing: object, whole: Record<string, unknown>): boolean {
  const held = existing as Record<string, unknown>;
  return Object.entries(whole).some(([key, value]) => !sameValue(value, held[key]));
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
