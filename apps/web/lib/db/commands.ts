import {
  convertMinor,
  createHlcState,
  isValidRate,
  rateFor,
  hlcSend,
  newColorSeed,
  newGroupSecret,
  newId,
  primaryPayer,
  type CurrencyCode,
  type EntityKind,
  type ExpenseKind,
  type Id,
  type ExchangeRate,
  type Op,
  type OpKind,
  type Rate,
  type RateSource,
  type ReceiptItem,
  type SplitSpec,
  type SplitTab,
} from "@hajsik/core";
import { db, type StoredOp } from "./dexie";
import { getDevice, hideGroup, setMe, unhideGroup } from "./device";
import { materialise } from "./fold";
import { requestPersistence } from "../persist";
import { scheduleSync } from "./sync";

/**
 * Every write in the app goes through this file, and every function here
 * appends ops rather than editing rows. Components never touch Dexie directly.
 *
 * If you find yourself wanting to `db().expenses.put(...)` somewhere in a
 * component, what you actually want is a new function in here.
 */

export interface OpDraft {
  entity: EntityKind;
  entityId: Id;
  kind: OpKind;
  patch: Record<string, unknown>;
  note?: string | null;
}

/**
 * Append ops and materialise what they touched, atomically.
 *
 * The device's HLC is advanced inside the same transaction as the write, so a
 * tab that dies mid-command can't leave the clock ahead of the log.
 */
export async function appendOps(
  groupId: Id,
  actor: Id,
  drafts: readonly OpDraft[],
  now = Date.now(),
): Promise<Op[]> {
  const d = db();
  return d.transaction(
    "rw",
    [d.ops, d.device, d.groups, d.members, d.expenses, d.settlements, d.attachments, d.identities,
      d.rates],
    async () => {
      const device = await getDevice();
      let clock = createHlcState(device.nodeId, device.hlcPhysical, device.hlcCounter);

      const written: StoredOp[] = [];
      for (const draft of drafts) {
        const sent = hlcSend(clock, now);
        clock = sent.state;
        written.push({
          id: newId(),
          groupId,
          entity: draft.entity,
          entityId: draft.entityId,
          kind: draft.kind,
          patch: draft.patch,
          hlc: sent.hlc,
          actor,
          note: draft.note ?? null,
          createdAt: now,
          seq: null,
          pending: 1,
        });
      }

      await d.ops.bulkPut(written);
      await d.device.put({
        ...device,
        hlcPhysical: clock.physical,
        hlcCounter: clock.counter,
      });

      // Dedupe: two ops in one command often touch the same entity.
      const touched = new Map<Id, EntityKind>();
      for (const op of written) touched.set(op.entityId, op.entity);
      for (const [entityId, kind] of touched) await materialise(groupId, kind, entityId);

      return written;
    },
  ).then((written) => {
    scheduleSync();
    return written;
  });
}

/**
 * Publish claims this device made before identity was on the log.
 *
 * A device that claimed a member under ADR-0003 has a `meByGroup` entry and no
 * op to show for it: its edits are attributed to somebody with nothing in the
 * log to explain why, and /g/history has nothing to show for a phone that has
 * been in the group for weeks. One `create` op per such group, once — later runs see it
 * and do nothing.
 *
 * `claimedAt` is when the claim was published, not when it was made. The
 * earlier date only ever existed in a device-local table that ADR-0003 drops,
 * and inventing a timestamp for the shared log would be worse than a late one.
 */
export async function publishExistingClaims(now = Date.now()): Promise<void> {
  const device = await getDevice();
  const mine = await db().ops.where("entityId").equals(device.nodeId).toArray();
  const claimed = new Set(
    mine.filter((op) => op.entity === "identity").map((op) => op.groupId),
  );

  for (const [groupId, memberId] of Object.entries(device.meByGroup)) {
    if (claimed.has(groupId)) continue;
    // A group whose ops haven't been pulled yet isn't ours to write to.
    if (!(await db().groups.get(groupId))) continue;
    await appendOps(
      groupId,
      memberId,
      [{
        entity: "identity",
        entityId: device.nodeId,
        kind: "create",
        patch: { memberId, claimedAt: now },
      }],
      now,
    );
  }
}

// ---------------------------------------------------------------- groups

export interface NewGroupInput {
  name: string;
  baseCurrency: CurrencyCode;
  /** The person holding this device. Becomes the first member and the actor. */
  myName: string;
  /** Everyone else, in the order they were typed. Optional — they can be added later. */
  otherNames?: readonly string[];
}

export async function createGroup(
  input: NewGroupInput,
  now = Date.now(),
): Promise<{ groupId: Id; memberId: Id; secret: string }> {
  const groupId = newId();
  const memberId = newId();
  const secret = newGroupSecret();

  await db().groupKeys.put({ groupId, secret, lastSeq: 0 });

  const device = await getDevice();

  await appendOps(
    groupId,
    memberId,
    [
      {
        entity: "group",
        entityId: groupId,
        kind: "create",
        patch: {
          name: input.name,
          baseCurrency: input.baseCurrency,
          createdAt: now,
          archivedAt: null,
        },
      },
      {
        entity: "member",
        entityId: memberId,
        kind: "create",
        patch: { name: input.myName, colorSeed: newColorSeed(), deletedAt: null },
      },
      {
        entity: "identity",
        entityId: device.nodeId,
        kind: "create",
        patch: { memberId, claimedAt: now },
      },
      // The rest of the group, in the same batch: one HLC run, so the log reads
      // as the group being created with these people in it rather than as five
      // separate arrivals a millisecond apart.
      ...(input.otherNames ?? []).map((name) => ({
        entity: "member" as const,
        entityId: newId(),
        kind: "create" as const,
        patch: { name, colorSeed: newColorSeed(), deletedAt: null },
      })),
    ],
    now,
  );

  await setMe(groupId, memberId);
  return { groupId, memberId, secret };
}

/**
 * Say who is holding this phone in a group — the first claim, or a switch.
 *
 * This writes an op, unlike everything else about "you": every other op
 * carries an `actor`, and an actor is only readable if the group can see when
 * a device changed which member it speaks for. The claim is keyed by the
 * device's HLC node id, which is already the suffix of every op that device
 * ever stamped, so it publishes nothing the log did not already carry — it
 * just makes it legible. ADR-0003.
 *
 * Re-claiming the member you already are is a no-op and writes nothing.
 */
export async function claimIdentity(
  groupId: Id,
  memberId: Id,
  now = Date.now(),
): Promise<void> {
  const device = await getDevice();
  const previous = device.meByGroup[groupId];
  if (previous === memberId) return;

  await setMe(groupId, memberId);
  await appendOps(
    groupId,
    // The member who was here a moment ago is who made this change. On a
    // first claim there is nobody else it could be.
    previous ?? memberId,
    [{
      entity: "identity",
      entityId: device.nodeId,
      kind: previous === undefined ? "create" : "update",
      patch: { memberId, claimedAt: now },
    }],
    now,
  );
}

/**
 * Store the secret from an invite link. Called on the creating device (from
 * `createGroup`) and on a device that just opened a `/join` link — the secret
 * never travels through an op, only through the link fragment. ADR-0003.
 */
export async function saveGroupKey(groupId: Id, secret: string): Promise<void> {
  const existing = await db().groupKeys.get(groupId);
  // A fresh link is the only cure for a 403, so opening one clears the failure
  // rather than leaving the old warning up over a key that now works.
  await db().groupKeys.put({
    ...existing, groupId, secret, lastSeq: existing?.lastSeq ?? 0, failure: undefined,
  });
  // Opening the link is what "rejoining" means here — surface the group
  // again if this device had previously left it.
  await unhideGroup(groupId);
  // This phone now holds something that exists nowhere else until it syncs.
  // Not awaited: whether the browser agrees to keep it doesn't gate the join.
  void requestPersistence();
}

export async function getGroupSecret(groupId: Id): Promise<string | undefined> {
  return (await db().groupKeys.get(groupId))?.secret;
}

export async function renameGroup(groupId: Id, actor: Id, name: string): Promise<void> {
  await appendOps(groupId, actor, [
    { entity: "group", entityId: groupId, kind: "update", patch: { name } },
  ]);
}

export async function archiveGroup(groupId: Id, actor: Id, now = Date.now()): Promise<void> {
  await appendOps(groupId, actor, [
    { entity: "group", entityId: groupId, kind: "update", patch: { archivedAt: now } },
  ]);
}

// --------------------------------------------------------------- members

/**
 * `actor` is optional because of the one case where there isn't one yet: a
 * phone joining a group adds the person holding it before it has claimed
 * anybody, and "someone added Theo" is a worse account of that than the
 * person arriving under their own name.
 */
export async function addMember(groupId: Id, actor: Id | undefined, name: string): Promise<Id> {
  const memberId = newId();
  await appendOps(groupId, actor ?? memberId, [
    {
      entity: "member",
      entityId: memberId,
      kind: "create",
      patch: { name, colorSeed: newColorSeed(), deletedAt: null },
    },
  ]);
  return memberId;
}

export async function renameMember(
  groupId: Id,
  actor: Id,
  memberId: Id,
  name: string,
): Promise<void> {
  await appendOps(groupId, actor, [
    { entity: "member", entityId: memberId, kind: "update", patch: { name } },
  ]);
}

/**
 * Tombstone a member. Their past expenses stay exactly as they were — removing
 * someone must never silently redistribute money they already owed.
 */
export async function removeMember(groupId: Id, actor: Id, memberId: Id): Promise<void> {
  await appendOps(groupId, actor, [
    { entity: "member", entityId: memberId, kind: "delete", patch: {} },
  ]);
}

/**
 * Forget a group on this phone: hides it from this device's list. Purely
 * local — nothing is appended to the op log, so it's invisible to everyone
 * else in the group and there's nothing for history to show. Membership and
 * this device's claimed identity are untouched, so opening the invite link
 * again (`saveGroupKey`) un-forgets it with no fuss. Groups are never
 * deleted, whether forgotten by everyone or not.
 */
export async function forgetGroup(groupId: Id): Promise<void> {
  await hideGroup(groupId);
}

// ----------------------------------------------------------------- rates

/**
 * Set what the group says a currency is worth. One row per currency, keyed by
 * the code, so this is a create the first time and an update after — and two
 * phones correcting the same rate merge by HLC like any other entity.
 *
 * A rate the app fetched is only ever written from here, which is to say only
 * when somebody pressed Save on it. Nothing in the app writes a rate on its
 * own: a number that moves every balance in the group is a change with an
 * actor and a line in the history, not a background task. ADR-0005.
 */
export async function setRate(
  groupId: Id,
  actor: Id,
  currency: CurrencyCode,
  rate: Rate,
  source: RateSource,
  asOf: number,
): Promise<void> {
  if (!isValidRate(rate)) throw new RangeError(`setRate: ${JSON.stringify(rate)} is not a rate`);
  const { base } = await valuationOf(groupId);
  if (currency === base) {
    throw new RangeError(`setRate: ${currency} is the group's own currency`);
  }
  const existing = await db().rates.get([groupId, currency]);
  const patch = { rate: rate.trim(), source, asOf };
  if (existing && !existing.deletedAt) {
    if (existing.rate === patch.rate && existing.source === source) return;
    await appendOps(groupId, actor, [
      { entity: "rate", entityId: currency, kind: "update", patch },
    ]);
    return;
  }
  // The one create that does write `deletedAt: null` rather than leaving it
  // absent (see `only`): a rate's id is its currency code, so setting one the
  // group had cleared lands on the existing tombstoned row and has to lift the
  // tombstone. Every other entity gets a fresh id and can never be reviving.
  await appendOps(groupId, actor, [
    { entity: "rate", entityId: currency, kind: "create", patch: { ...patch, deletedAt: null } },
  ]);
}

/**
 * Drop a currency from the registry. Entries written in it fall back to the
 * rate each was saved with, which is what a group that never had a registry
 * has always done — so this is "stop having an opinion", not "lose the money".
 */
export async function clearRate(groupId: Id, actor: Id, currency: CurrencyCode): Promise<void> {
  await appendOps(groupId, actor, [
    { entity: "rate", entityId: currency, kind: "delete", patch: {} },
  ]);
}

// -------------------------------------------------------------- expenses

export interface ExpenseInput {
  /** Which way the entry runs. Omitted or "expense" for the ordinary case. */
  kind?: ExpenseKind | null;
  description: string;
  occurredAt: number;
  /** In `currency`, minor units. */
  amountMinor: number;
  currency: CurrencyCode;
  /** Frozen at entry. "1" when the expense is already in the base currency. */
  rateToBase: Rate;
  paidBy: Id;
  /** Co-sponsors, in `currency` minor units. Omit or null for a single payer. */
  payers?: Record<Id, number> | null;
  split: SplitSpec;
  categoryId?: string | null;
  attachmentIds?: Id[];
  /** The parsed bill behind `split`, kept so the who-had-what grid can reopen. */
  receiptItems?: ReceiptItem[] | null;
  receiptTip?: string | null;
  receiptInvolved?: Id[] | null;
  receiptAssignments?: Id[][] | null;
  /** Which split tab was showing when this expense was saved. */
  splitTab?: SplitTab | null;
}

/**
 * Normalise the payer side before it is written.
 *
 * A `payers` map with one contributor is just a single payer and is stored as
 * null, so the common case never carries a redundant field. With two or more,
 * `paidBy` is rewritten as the largest contributor so a list row, an avatar and
 * an older client all still have one sensible answer. ADR-0010.
 */
function normalisePayers(input: ExpenseInput): { paidBy: Id; payers: Record<Id, number> | null } {
  const spec = input.payers;
  if (!spec) return { paidBy: input.paidBy, payers: null };
  const live = Object.fromEntries(
    Object.entries(spec).filter(([, amount]) => amount > 0),
  );
  const ids = Object.keys(live);
  if (ids.length === 0) return { paidBy: input.paidBy, payers: null };
  if (ids.length === 1) return { paidBy: ids[0]!, payers: null };
  return { paidBy: primaryPayer(live, input.paidBy), payers: live };
}

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
function only(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/** Key order is not meaningful in a payer map, so compare it out. */
function samePayers(a: Record<Id, number> | null, b: Record<Id, number> | null): boolean {
  if (a === null || b === null) return a === b;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

/**
 * The base amount written onto the entry. Takes the three fields rather than
 * an `ExpenseInput`, because a settlement converts by exactly the same rule
 * and must not drift from it.
 *
 * This figure is no longer what the entry is *worth* — the registry answers
 * that, on read (`atCurrentRates`). It is written so the row is complete and
 * self-consistent the moment it lands, and so a currency the registry later
 * has nothing to say about still has a number behind it. ADR-0005.
 */
function toBase(
  input: { amountMinor: number; currency: CurrencyCode; rateToBase: Rate },
  base: CurrencyCode,
): number {
  return input.currency === base
    ? input.amountMinor
    : convertMinor(input.amountMinor, input.currency, base, input.rateToBase);
}

/** The group's base currency and its registry, which every entry write needs. */
async function valuationOf(
  groupId: Id,
): Promise<{ base: CurrencyCode; rates: Record<CurrencyCode, ExchangeRate> }> {
  const d = db();
  const [group, rows] = await Promise.all([
    d.groups.get(groupId),
    d.rates.where("groupId").equals(groupId).toArray(),
  ]);
  if (!group) throw new Error(`unknown group: ${groupId}`);
  return {
    base: group.baseCurrency,
    rates: Object.fromEntries(rows.map((r) => [r.id, r])),
  };
}

/**
 * The rate to write onto an entry: the group's, whenever the group has one.
 *
 * The form can only offer the registry's number, so this agrees with it in
 * every ordinary case. It matters for the ones that aren't: a scan that set a
 * currency, a draft that was open while somebody else corrected the rate. What
 * gets written is then the same number the entry will be read at rather than a
 * stale one that only shows up in the history.
 */
function rateToWrite(
  currency: CurrencyCode,
  asked: Rate,
  base: CurrencyCode,
  rates: Record<CurrencyCode, ExchangeRate>,
): Rate {
  return rateFor(rates, base, currency) ?? asked;
}

export async function addExpense(
  groupId: Id,
  actor: Id,
  input: ExpenseInput,
  now = Date.now(),
): Promise<Id> {
  const { base, rates } = await valuationOf(groupId);
  const seed = { ...input, rateToBase: rateToWrite(input.currency, input.rateToBase, base, rates) };
  const payer = normalisePayers(input);
  const expenseId = newId();
  await appendOps(
    groupId,
    actor,
    [
      {
        entity: "expense",
        entityId: expenseId,
        kind: "create",
        patch: {
          // Written only for an income: an ordinary expense is the absence of
          // this field, on every op ever appended, and stays that way.
          ...(input.kind === "income" ? { kind: "income" } : {}),
          description: input.description,
          occurredAt: input.occurredAt,
          createdAt: now,
          amountMinor: input.amountMinor,
          currency: input.currency,
          rateToBase: seed.rateToBase,
          baseAmountMinor: toBase(seed, base),
          paidBy: payer.paidBy,
          split: input.split,
          // Absent on an ordinary expense — see `only`. No `deletedAt` either:
          // the id is fresh, so a create is never a tombstone.
          ...only({
            categoryId: input.categoryId,
            payers: payer.payers,
            attachmentIds: input.attachmentIds,
            receiptItems: input.receiptItems,
            receiptTip: input.receiptTip,
            receiptInvolved: input.receiptInvolved,
            receiptAssignments: input.receiptAssignments,
            splitTab: input.splitTab,
          }),
        },
      },
    ],
    now,
  );
  return expenseId;
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
 * Is this the value the entity already holds? A patch may only carry what
 * actually changed: a field written back unchanged wins its slot at fold time
 * and silently undoes whatever another device did to it offline.
 *
 * `null` and absent are the same value — not set. `only()` leaves an unset
 * field off the create op entirely while the form always sends an explicit
 * `null` for it, and reading those as different wrote a phantom revision on
 * every first edit.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a ?? null) === null || (b ?? null) === null) return (a ?? null) === (b ?? null);
  if (typeof a !== "object" || typeof b !== "object") return false;
  return stableJson(a) === stableJson(b);
}

/**
 * Edit an expense. The patch carries only the fields that actually changed —
 * that is what lets two people edit different fields of the same expense
 * offline and have both survive.
 */
export async function editExpense(
  groupId: Id,
  actor: Id,
  expenseId: Id,
  changes: Partial<ExpenseInput>,
  note?: string,
): Promise<void> {
  const existing = await db().expenses.get(expenseId);
  if (!existing) throw new Error(`unknown expense: ${expenseId}`);

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (sameValue(value, existing[key as keyof typeof existing])) continue;
    patch[key] = value;
  }

  // An expense is the *absence* of `kind` (see `addExpense`), but the form
  // always sends one — so without this every first edit of an expense wrote a
  // kind change against nothing, and the history read "turned this back into
  // an expense" over an edit that only moved the amount.
  if ("kind" in patch && (patch["kind"] ?? "expense") === (existing.kind ?? "expense")) {
    delete patch["kind"];
  }

  // The two payer fields move together — writing one without the other could
  // leave `paidBy` naming somebody who isn't in `payers` at all — but only the
  // ones that actually changed are written, or every payer edit would carry a
  // redundant `payers: null` into the log.
  if (patch["paidBy"] !== undefined || patch["payers"] !== undefined) {
    const merged = { ...existing, ...changes } as ExpenseInput;
    const payer = normalisePayers(merged);
    if (payer.paidBy === existing.paidBy) delete patch["paidBy"];
    else patch["paidBy"] = payer.paidBy;
    if (samePayers(payer.payers, existing.payers ?? null)) delete patch["payers"];
    else patch["payers"] = payer.payers;
  }

  // The amount, its currency or its rate changing all move the base figure.
  if (
    patch["amountMinor"] !== undefined ||
    patch["currency"] !== undefined ||
    patch["rateToBase"] !== undefined
  ) {
    const { base, rates } = await valuationOf(groupId);
    const merged: ExpenseInput = { ...existing, ...changes } as ExpenseInput;
    merged.rateToBase = rateToWrite(merged.currency, merged.rateToBase, base, rates);
    if (merged.rateToBase !== existing.rateToBase) patch["rateToBase"] = merged.rateToBase;
    else delete patch["rateToBase"];
    const wasBase = toBase(merged, base);
    // A currency swapped at a rate that lands on the same figure moves nothing.
    if (wasBase !== existing.baseAmountMinor) patch["baseAmountMinor"] = wasBase;
  }

  if (Object.keys(patch).length === 0) return;
  await appendOps(groupId, actor, [
    { entity: "expense", entityId: expenseId, kind: "update", patch, note: note ?? null },
  ]);
}

export async function deleteExpense(
  groupId: Id,
  actor: Id,
  expenseId: Id,
  note?: string,
): Promise<void> {
  await appendOps(groupId, actor, [
    { entity: "expense", entityId: expenseId, kind: "delete", patch: {}, note: note ?? null },
  ]);
}

// ----------------------------------------------------------- settlements

export interface SettlementInput {
  fromMember: Id;
  toMember: Id;
  amountMinor: number;
  currency: CurrencyCode;
  rateToBase: Rate;
  occurredAt: number;
  note?: string | null;
}

export async function recordSettlement(
  groupId: Id,
  actor: Id,
  input: SettlementInput,
  now = Date.now(),
): Promise<Id> {
  const { base, rates } = await valuationOf(groupId);
  const settlementId = newId();
  const seed = { ...input, rateToBase: rateToWrite(input.currency, input.rateToBase, base, rates) };
  const baseAmountMinor = toBase(seed, base);

  await appendOps(
    groupId,
    actor,
    [
      {
        entity: "settlement",
        entityId: settlementId,
        kind: "create",
        patch: {
          fromMember: input.fromMember,
          toMember: input.toMember,
          amountMinor: input.amountMinor,
          currency: input.currency,
          rateToBase: seed.rateToBase,
          baseAmountMinor,
          occurredAt: input.occurredAt,
          createdAt: now,
          ...only({ note: input.note }),
        },
      },
    ],
    now,
  );
  return settlementId;
}

/**
 * Edit a transfer. Same rule as `editExpense`: only the fields that actually
 * changed reach the log, and the base figure is re-derived whenever the amount,
 * the currency or the rate moves.
 */
export async function editSettlement(
  groupId: Id,
  actor: Id,
  settlementId: Id,
  changes: Partial<SettlementInput>,
  note?: string,
): Promise<void> {
  const existing = await db().settlements.get(settlementId);
  if (!existing) throw new Error(`unknown settlement: ${settlementId}`);

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value !== undefined && !sameValue(value, existing[key as keyof typeof existing])) {
      patch[key] = value;
    }
  }

  if (
    patch["amountMinor"] !== undefined ||
    patch["currency"] !== undefined ||
    patch["rateToBase"] !== undefined
  ) {
    const { base, rates } = await valuationOf(groupId);
    const merged = { ...existing, ...changes };
    merged.rateToBase = rateToWrite(merged.currency, merged.rateToBase, base, rates);
    if (merged.rateToBase !== existing.rateToBase) patch["rateToBase"] = merged.rateToBase;
    else delete patch["rateToBase"];
    patch["baseAmountMinor"] = toBase(merged, base);
  }

  if (Object.keys(patch).length === 0) return;
  await appendOps(groupId, actor, [
    { entity: "settlement", entityId: settlementId, kind: "update", patch, note: note ?? null },
  ]);
}

export async function deleteSettlement(
  groupId: Id,
  actor: Id,
  settlementId: Id,
): Promise<void> {
  await appendOps(groupId, actor, [
    { entity: "settlement", entityId: settlementId, kind: "delete", patch: {} },
  ]);
}
