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
  addEntry: (groupId: string, kind?: EntryKind) =>
    `/g/entry/edit?id=${encodeURIComponent(groupId)}${kind && kind !== "expense" ? `&kind=${kind}` : ""}`,
  editEntry: (groupId: string, entryId: string) =>
    `/g/entry/edit?id=${encodeURIComponent(groupId)}&e=${encodeURIComponent(entryId)}`,
  /** One detail screen for all three: the id is looked up in both tables. */
  entry: (groupId: string, entryId: string) =>
    `/g/entry?id=${encodeURIComponent(groupId)}&e=${encodeURIComponent(entryId)}`,
  payers: (groupId: string) => `/g/payers?id=${encodeURIComponent(groupId)}`,
  /** Who-had-what: right after a scan finds line items, or "Edit who-had-what" later. */
  items: (groupId: string) => `/g/entry/items?id=${encodeURIComponent(groupId)}`,
  history: (groupId: string, entryId?: string) =>
    `/g/history?id=${encodeURIComponent(groupId)}${entryId ? `&e=${encodeURIComponent(entryId)}` : ""}`,
  /** Settle up: a transfer, pre-filled with who owes whom and how much. */
  transferBetween: (groupId: string, from: string, to: string, amount: number) =>
    `${route.addEntry(groupId, "transfer")}&from=${encodeURIComponent(from)}`
    + `&to=${encodeURIComponent(to)}&amount=${amount}`,
  members: (groupId: string) => `/g/members?id=${encodeURIComponent(groupId)}`,
  /** The group's exchange-rate registry: one rate per currency it spends in. */
  rates: (groupId: string) => `/g/rates?id=${encodeURIComponent(groupId)}`,
  /** The last step of joining: pick which member you are, then go in. */
  claim: (groupId: string) => `/g/claim?id=${encodeURIComponent(groupId)}`,
};
