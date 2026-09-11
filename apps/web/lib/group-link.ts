/**
 * A group IS its link. There are no accounts: holding the link is the whole of
 * authorisation, which is why the secret rides in the URL *fragment* — browsers
 * never send a fragment to a server, so it cannot leak into an access log,
 * a Referer header, or a Cloudflare analytics row. See ADR-0004.
 *
 *   https://hajsik.app/join#<groupId>.<secret>
 *
 * The path part of the app's own routes carries only the group id, which is a
 * random opaque string on its own and confers nothing without the secret.
 */

export interface JoinLink {
  groupId: string;
  secret: string;
}

export function formatJoinLink(link: JoinLink, origin?: string): string {
  const base = origin ?? (typeof window === "undefined" ? "" : window.location.origin);
  return `${base}/join#${link.groupId}.${link.secret}`;
}

/** Parse a whole URL, or just the fragment. Returns null on anything unexpected. */
export function parseJoinLink(input: string): JoinLink | null {
  const hash = input.includes("#") ? input.slice(input.indexOf("#") + 1) : input;
  const dot = hash.indexOf(".");
  if (dot <= 0 || dot === hash.length - 1) return null;
  const groupId = hash.slice(0, dot);
  const secret = hash.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(groupId) || !/^[A-Za-z0-9_-]+$/.test(secret)) return null;
  return { groupId, secret };
}

import type { EntryKind } from "./entry-kind";

/**
 * Where an entry was opened from, when that wasn't the ledger.
 *
 * Four screens link *sideways* into an entry rather than down into it: the
 * history feed, the two "can't remove this yet" dialogs, which list what is
 * still naming a person or a currency, and the balances tab, whose settle-up
 * rows open a pre-filled transfer. Going up to the group from there threw away
 * the list you were working through, so the link says which screen it was on
 * and the entry unwinds to that instead (`entryParent`, ADR-0007).
 *
 * It rides in the URL rather than in memory because a screen is a route: a
 * reload, or the app being killed in the background, must not change where back
 * goes. `via` and not `from` — `/g/entry/edit` already spends `from` on a
 * member id.
 */
export type EntrySource = "history" | "members" | "rates" | "balances";

/**
 * Internal routes. The app is a static export, so every screen is a real page
 * with the group id in the query string — no dynamic route segments to
 * pre-render, and a link that survives a refresh.
 */
export const route = {
  groups: () => "/",
  newGroup: () => "/new",
  group: (groupId: string, tab?: "ledger" | "balances") =>
    `/g?id=${encodeURIComponent(groupId)}${tab && tab !== "ledger" ? `&tab=${tab}` : ""}`,
  /**
   * The one form. `kind` picks which of the three an entry starts as, and a
   * transfer can arrive with its two sides and its amount already filled —
   * that is what "settle up" now links to, rather than a screen of its own
   * ([ADR-0010](../../../docs/decisions/0010-what-an-entry-is.md)).
   */
  addEntry: (groupId: string, kind?: EntryKind, via?: EntrySource) =>
    `/g/entry/edit?id=${encodeURIComponent(groupId)}${kind && kind !== "expense" ? `&kind=${kind}` : ""}`
    + (via ? `&via=${via}` : ""),
  editEntry: (groupId: string, entryId: string, via?: EntrySource) =>
    `/g/entry/edit?id=${encodeURIComponent(groupId)}&e=${encodeURIComponent(entryId)}`
    + (via ? `&via=${via}` : ""),
  /**
   * One detail screen for all three: the id is looked up in both tables.
   * `via` is where the link was on — see `EntrySource`.
   */
  entry: (groupId: string, entryId: string, via?: EntrySource) =>
    `/g/entry?id=${encodeURIComponent(groupId)}&e=${encodeURIComponent(entryId)}`
    + (via ? `&via=${via}` : ""),
  payers: (groupId: string) => `/g/payers?id=${encodeURIComponent(groupId)}`,
  /**
   * Who-had-what: right after a scan finds line items, or "Edit who-had-what"
   * later. `via` is the form's own, held for the trip back — a detour through
   * this screen must not be what decides where saving lands.
   */
  items: (groupId: string, via?: EntrySource) =>
    `/g/entry/items?id=${encodeURIComponent(groupId)}` + (via ? `&via=${via}` : ""),
  /** `via` rides along on an entry's own history, so the chain back is exact. */
  history: (groupId: string, entryId?: string, via?: EntrySource) =>
    `/g/history?id=${encodeURIComponent(groupId)}${entryId ? `&e=${encodeURIComponent(entryId)}` : ""}`
    + (via ? `&via=${via}` : ""),
  /**
   * Settle up: a transfer, pre-filled with who owes whom, how much, and —
   * since the caller knows this is a reimbursement and a blank "+" doesn't —
   * what to call it.
   */
  transferBetween: (groupId: string, from: string, to: string, amount: number, title: string) =>
    `${route.addEntry(groupId, "transfer", "balances")}&from=${encodeURIComponent(from)}`
    + `&to=${encodeURIComponent(to)}&amount=${amount}&title=${encodeURIComponent(title)}`,
  members: (groupId: string) => `/g/members?id=${encodeURIComponent(groupId)}`,
  /** The group's exchange-rate registry: one rate per currency it spends in. */
  rates: (groupId: string) => `/g/rates?id=${encodeURIComponent(groupId)}`,
  /** The last step of joining: pick which member you are, then go in. */
  claim: (groupId: string) => `/g/claim?id=${encodeURIComponent(groupId)}`,
};

/** The `via=` of a URL, or `undefined` for anything the app didn't write. */
export function parseEntrySource(value: string | null | undefined): EntrySource | undefined {
  return value === "history" || value === "members" || value === "rates" || value === "balances"
    ? value : undefined;
}

/** The screen an entry's back arrow names: whoever linked to it, or the group. */
export function entryParent(groupId: string, via: EntrySource | undefined): string {
  return via === "history" ? route.history(groupId)
    : via === "members" ? route.members(groupId)
      : via === "rates" ? route.rates(groupId)
        : via === "balances" ? route.group(groupId, "balances")
          : route.group(groupId);
}

/**
 * Where saving on the entry form lands: the screen the form was opened from.
 *
 * A save used to drop you on the ledger whatever you had been doing — settling
 * up sent you to the ledger rather than back to the balances you were
 * clearing, and correcting an entry you had reached from the history feed or a
 * "can't remove this yet" list lost that list, which is the very thing `via`
 * exists to keep (ADR-0007). Editing an existing entry returns to that entry,
 * carrying its own `via` so its back arrow still climbs to whoever linked in;
 * a new one returns to the screen that asked for it.
 */
export function formParent(
  groupId: string, entryId: string | undefined, via: EntrySource | undefined,
): string {
  return entryId ? route.entry(groupId, entryId, via) : entryParent(groupId, via);
}
