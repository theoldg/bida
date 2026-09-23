import {
  wantsNotice,
  type DevicePush, type GroupState, type Id, type Identity, type Notice, type NoticeEntry,
} from "@bida/core";
import { copy } from "./copy";
import { graphemes, money, plural } from "./format";

/**
 * What another phone shows for a round's notices (docs/notifications.md#what-is-said):
 * core decided who hears what, this turns it into words — one notification
 * per listening device, however many entries the round carried.
 *
 * Pure: `syncGroup` encrypts and sends what comes out.
 */

/** What `sw.js` reads out of a push. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  /** The group id, so a group's latest replaces its last. */
  tag: string;
}

export interface PushMessage {
  identity: Identity;
  push: DevicePush;
  payload: PushPayload;
}

/** Long enough for any real description; a lock screen shows less anyway. */
const DESCRIPTION_MAX = 60;

type Names = (id: Id) => string;

/** How an entry is named in a sentence, from where `reader` stands. */
function label(entry: NoticeEntry, name: Names, reader: Id): string {
  if (entry.kind === "transfer") {
    const side = (id: Id) => (id === reader ? copy.notify.you : name(id));
    return copy.notify.quoted(copy.notify.transfer(side(entry.fromMember), side(entry.toMember)));
  }
  const text = graphemes(entry.description.trim());
  if (text.length === 0) return copy.notify.untitled;
  return copy.notify.quoted(
    text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX - 1).join("")}…` : text.join(""),
  );
}

const amountOf = (e: NoticeEntry) => money(e.amountMinor, e.currency);

/** A new transfer says who paid whom, since "added" says nothing about money moving. */
function transferAdded(n: Notice, t: Extract<NoticeEntry, { kind: "transfer" }>, name: Names): string {
  const who = name(n.by);
  const amount = amountOf(t);
  if (t.toMember === n.to) {
    return t.fromMember === n.by
      ? copy.notify.paidYou(who, amount)
      : copy.notify.recordedPaidYou(who, name(t.fromMember), amount);
  }
  if (t.fromMember === n.to) {
    return copy.notify.recordedYouPaid(who, t.toMember === n.by ? copy.notify.them : name(t.toMember), amount);
  }
  return copy.notify.recordedPaid(who, name(t.fromMember), name(t.toMember), amount);
}

/** The first line: who did what to which entry. */
function headline(n: Notice, name: Names): string {
  const who = name(n.by);
  const { before, after } = n;
  if (n.change === "added" && after) {
    return after.kind === "transfer"
      ? transferAdded(n, after, name)
      : copy.notify.added(who, label(after, name, n.to), amountOf(after));
  }
  if (n.change === "deleted" && before) {
    return copy.notify.deleted(who, label(before, name, n.to), amountOf(before));
  }
  if (!before || !after) return copy.notify.edited(who, copy.notify.untitled);
  const was = label(before, name, n.to);
  if (n.change === "converted" || n.moved.includes("kind")) {
    return after.kind === "transfer" ? copy.notify.toTransfer(who, was)
      : after.kind === "income" ? copy.notify.toIncome(who, was)
      : copy.notify.toExpense(who, was);
  }
  const now = label(after, name, n.to);
  const moved = new Set(n.moved);
  if ([...moved].every((f) => f === "amount" || f === "currency")) {
    return copy.notify.changedAmount(who, now, amountOf(before), amountOf(after));
  }
  if (moved.size === 1 && moved.has("split")) return copy.notify.changedSplit(who, now);
  if (moved.size === 1 && moved.has("payers")) return copy.notify.changedPayers(who, now);
  return copy.notify.edited(who, now);
}

type Spent = Extract<NoticeEntry, { kind: "expense" | "income" }>;
const spent = (e: NoticeEntry | undefined): Spent | undefined =>
  e && e.kind !== "transfer" ? e : undefined;

/** "You paid €200.00 · your share €19.00", or whichever half applies. */
function sideOf(e: Spent, base: string): string | undefined {
  const income = e.kind === "income";
  const share = e.share === null ? undefined : money(e.share, base);
  const paid = e.paid === null ? undefined : money(e.paid, base);
  if (paid && share) return (income ? copy.notify.receivedAndShare : copy.notify.paidAndShare)(paid, share);
  if (paid) return (income ? copy.notify.received : copy.notify.paid)(paid);
  return share ? copy.notify.share(share) : undefined;
}

/** The second line: the reader's side. None when they aren't in it — a phone set to everything. */
function sideLine(n: Notice): string | undefined {
  if (!n.involved) return undefined;
  const base = n.baseCurrency;
  const before = spent(n.before);
  const after = spent(n.after);
  if (n.change === "deleted") {
    return before && before.share !== null ? copy.notify.shareWas(money(before.share, base)) : undefined;
  }
  if (!after) return undefined;
  if (n.change === "edited" && before) {
    const shareOf = (e: Spent) => (e.share === null ? copy.notify.none : money(e.share, base));
    if (before.share !== after.share) return copy.notify.shareMoved(shareOf(before), shareOf(after));
    if (before.paid === after.paid) return undefined;
  }
  return sideOf(after, base);
}

const entryId = (n: Notice) => (n.after ?? n.before)!.id;

/** One device's notification for everything this round told its member. */
export function pushPayload(groupId: Id, groupName: string, told: readonly Notice[], name: Names): PushPayload {
  const group = `/g?id=${encodeURIComponent(groupId)}`;
  const entries = new Set(told.map(entryId));
  const tag = groupId;
  if (entries.size === 1) {
    // One entry, however many commands: its latest word stands.
    const n = told[told.length - 1]!;
    const lines = [headline(n, name), sideLine(n)].filter((l): l is string => !!l);
    const url = n.after ? `/g/entry?id=${encodeURIComponent(groupId)}&e=${encodeURIComponent(n.after.id)}` : group;
    return { title: groupName, body: lines.join("\n"), url, tag };
  }
  const who = name(told[0]!.by);
  const count = plural(entries.size, copy.noun.entry);
  if (told.every((n) => n.change === "added")) {
    const shares = told.map((n) => (n.involved ? spent(n.after)?.share ?? 0 : 0));
    const sum = shares.reduce((a, b) => a + b, 0);
    const lines = [copy.notify.addedMany(who, count)];
    if (sum > 0) lines.push(copy.notify.share(money(sum, told[0]!.baseCurrency)));
    return { title: groupName, body: lines.join("\n"), url: group, tag };
  }
  return { title: groupName, body: copy.notify.changedMany(who, count), url: group, tag };
}

/**
 * Who gets a push, and what: every device in the group that has a
 * subscription and wants at least one of `told` — never this phone itself.
 */
export function pushMessages(
  state: GroupState, told: readonly Notice[], groupId: Id, myNodeId: string,
): PushMessage[] {
  const name: Names = (id) => state.members[id]?.name ?? copy.someone;
  const groupName = state.group?.name ?? copy.app.name;
  const out: PushMessage[] = [];
  for (const identity of Object.values(state.identities)) {
    const push = identity.push;
    if (!push || identity.id === myNodeId) continue;
    const theirs = told.filter((n) => n.to === identity.memberId && wantsNotice(push, n));
    if (theirs.length === 0) continue;
    out.push({ identity, push, payload: pushPayload(groupId, groupName, theirs, name) });
  }
  return out;
}
