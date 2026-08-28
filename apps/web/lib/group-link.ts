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

/**
 * Internal routes. The app is a static export, so every screen is a real page
 * with the group id in the query string — no dynamic route segments to
 * pre-render, and a link that survives a refresh.
 */
export const route = {
  groups: () => "/",
  newGroup: () => "/new",
  group: (groupId: string, tab?: "expenses" | "balances") =>
    `/g?id=${encodeURIComponent(groupId)}${tab && tab !== "expenses" ? `&tab=${tab}` : ""}`,
  addExpense: (groupId: string) => `/g/expense/edit?id=${encodeURIComponent(groupId)}`,
  editExpense: (groupId: string, expenseId: string) =>
    `/g/expense/edit?id=${encodeURIComponent(groupId)}&e=${encodeURIComponent(expenseId)}`,
  expense: (groupId: string, expenseId: string) =>
    `/g/expense?id=${encodeURIComponent(groupId)}&e=${encodeURIComponent(expenseId)}`,
  payers: (groupId: string) => `/g/payers?id=${encodeURIComponent(groupId)}`,
  /** Who-had-what: right after a scan finds line items, or "Edit who-had-what" later. */
  items: (groupId: string) => `/g/expense/items?id=${encodeURIComponent(groupId)}`,
  /** The confirmation screen for putting an entity back to how it looked. */
  restore: (groupId: string, entity: string, entityId: string, atHlc: string) =>
    `/g/restore?id=${encodeURIComponent(groupId)}&kind=${encodeURIComponent(entity)}`
    + `&e=${encodeURIComponent(entityId)}&at=${encodeURIComponent(atHlc)}`,
  history: (groupId: string, expenseId?: string) =>
    `/g/history?id=${encodeURIComponent(groupId)}${expenseId ? `&e=${encodeURIComponent(expenseId)}` : ""}`,
  settleWith: (groupId: string, from: string, to: string, amount: number) =>
    `/g/settle?id=${encodeURIComponent(groupId)}&from=${from}&to=${to}&amount=${amount}`,
  members: (groupId: string) => `/g/members?id=${encodeURIComponent(groupId)}`,
  /** The last step of joining: pick which member you are, then go in. */
  claim: (groupId: string) => `/g/claim?id=${encodeURIComponent(groupId)}`,
  settings: () => "/settings",
};
