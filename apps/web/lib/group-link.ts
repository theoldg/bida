/**
 * A group IS its link. There are no accounts: holding the link is the whole of
 * authorisation, which is why the secret rides in the URL *fragment* — browsers
 * never send a fragment to a server, so it cannot leak into an access log,
 * a Referer header, or a Cloudflare analytics row. See ADR-0004.
 *
 *   https://bida.app/join#<groupId>.<secret>
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
 * A group as it rides onto an iOS home screen: its invite, and which member
 * this phone is in it, so the app launched from the icon doesn't ask "who are
 * you?" of someone the tab already knows (docs/ios.md).
 */
export interface CarriedGroup extends JoinLink {
  me?: string;
}

/**
 * Several groups in one fragment: `<id>.<secret>[.<member>]~…`. `~` and `.`
 * are URL-safe and cannot appear in any part, which is `[A-Za-z0-9_-]`.
 *
 * Only `/install` reads this, so a phone holding four groups brings four onto
 * the home screen. **A `/join` link stays one group and never a member** — it
 * is the thing people send each other, and `parseJoinLink` refuses a third
 * part.
 */
export function formatInvites(links: readonly CarriedGroup[]): string {
  return links.map((link) => `${link.groupId}.${link.secret}${link.me ? `.${link.me}` : ""}`).join("~");
}

/** The groups in a fragment, in the order they were written. Bad ones drop out. */
export function parseInvites(input: string): CarriedGroup[] {
  const hash = input.includes("#") ? input.slice(input.indexOf("#") + 1) : input;
  return hash.split("~").flatMap((part): CarriedGroup[] => {
    const [groupId, secret, me, ...rest] = part.split(".");
    const ok = (x: string | undefined) => !!x && /^[A-Za-z0-9_-]+$/.test(x);
    if (rest.length || !ok(groupId) || !ok(secret) || (me !== undefined && !ok(me))) return [];
    return [{ groupId: groupId!, secret: secret!, ...(me ? { me } : {}) }];
  });
}

/**
 * A fragment that names a group and carries no password: `#<groupId>`, or the
 * same with its dot left dangling. That is a link cut short, and it is told
 * apart from a malformed one because it has its own fix — the invite link
 * from the app, not the address bar (`components/keyless-link.tsx`).
 */
export function isKeylessFragment(hash: string): boolean {
  return /^#?[A-Za-z0-9_-]+\.?$/.test(hash);
}

/**
 * What pasting found: a link to join, one for another server, one that names a
 * group but carries no password, something that is no link, or nothing at all.
 */
type PastedLink =
  | { kind: "join"; link: JoinLink }
  | { kind: "elsewhere"; host: string }
  | { kind: "keyless"; groupId: string }
  | { kind: "none" }
  | { kind: "empty" };

/**
 * Read the clipboard's text as a join link.
 *
 * Stricter than `parseJoinLink`, which also takes a bare fragment: what is on
 * the clipboard is not a link someone chose to open, so only a whole `/join`
 * URL counts. One from another origin is told apart rather than refused — a
 * group lives in the database of the deployment that made it, so a link from
 * the dev server or a self-hosted copy is a good link this server has never
 * heard of, and its host is what the person needs to hear.
 *
 * A link with no password is `keyless` whichever server it names: it opens
 * nothing anywhere, so the server is not the news.
 */
export function readPastedLink(text: string, origin: string): PastedLink {
  // An empty clipboard, or one holding a picture: iOS reads that as "".
  if (!text.trim()) return { kind: "empty" };
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return { kind: "none" };
  }
  const link = url.pathname === "/join" ? parseJoinLink(url.hash) : null;
  if (!link) {
    const groupId = url.pathname === "/join" && isKeylessFragment(url.hash)
      ? url.hash.replace(/^#|\.$/g, "")
      : /^\/g(\/|$)/.test(url.pathname) ? url.searchParams.get("id") : null;
    return groupId && /^[A-Za-z0-9_-]+$/.test(groupId) ? { kind: "keyless", groupId } : { kind: "none" };
  }
  return url.origin === origin ? { kind: "join", link } : { kind: "elsewhere", host: url.host };
}

import type { EntryKind } from "./entry-kind";

/**
 * Where an entry was opened from, when that wasn't the ledger.
 *
 * Four screens link *sideways* into an entry rather than down into it: the
 * history feed, the two "can't remove this yet" dialogs, and the balances tab,
 * whose settle-up rows open a pre-filled transfer. The link says which screen
 * it was on, so the entry unwinds to that rather than throwing away the list
 * you were working through (`entryParent`, ADR-0007).
 *
 * **In the URL, never in memory**: a reload, or the app being killed in the
 * background, must not change where back goes. `via` and not `from` —
 * `/g/entry/edit` already spends `from` on a member id.
 */
type EntrySource = "history" | "members" | "rates" | "balances";

/**
 * Internal routes. The app is a static export, so every screen is a real page
 * with the group id in the query string — no dynamic route segments to
 * pre-render, and a link that survives a refresh.
 */
export const route = {
  groups: () => "/",
  newGroup: () => "/new",
  /** Not linked from anywhere: long-press the wordmark. See app/diag/page.tsx. */
  diag: () => "/diag",
  /** What this is, who can read it, and where to complain. Off the groups list. */
  about: () => "/about",
  /**
   * Deleting a group from the server for everybody in it, on the strength of
   * its invite link (app/delete-my-data/page.tsx). **Linked from nowhere**:
   * `/about` prints the address for somebody to type, which is the first of
   * the frictions that screen is made of. Named for the sentence somebody
   * types into an address bar when they want their data off a service.
   */
  deleteMyData: () => "/delete-my-data",
  /**
   * Settings that are nobody's default: a Gemini key of your own, and nothing
   * else yet. Listed in the groups list's kebab rather than hidden like
   * `/diag` — it is a screen a person may go looking for, not a readout.
   */
  advanced: () => "/advanced",
  /**
   * Why and how to put bida on an iOS home screen (docs/ios.md). The invites
   * this phone holds ride in the fragment, because this is the page the share
   * sheet is opened *from* — whatever iOS writes into the bookmark, it writes
   * from here. The fragment never reaches the server, and the phone reading it
   * already holds every secret in it.
   */
  install: (links: readonly CarriedGroup[] = []) =>
    `/install${links.length ? `#${formatInvites(links)}` : ""}`,
  /**
   * A Splitwise (or bida) CSV as a new group (app/import/page.tsx). Off the
   * groups list and not a group's own menu: what it makes *is* a group, and
   * merging into one that already has entries would mean deciding which row is
   * which entry, which the file carries no ids to decide.
   */
  import: () => "/import",
  /**
   * The demo group: a real group, made of real ops, that never syncs
   * (app/demo/page.tsx). Creates it or reopens the one already here, then
   * redirects into its ledger.
   *
   * **Linked from nowhere in the app on purpose** — not the empty groups list,
   * not `/about`, not the README. The URL is the whole door: you get there
   * because somebody sent you there.
   */
  demo: () => "/demo",
  /** Bare, it is the "Bad link" screen; a real one is `formatJoinLink`. */
  join: () => "/join",
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
   * Scan first, decide after: a screen holding nothing but the two scan
   * buttons, which hands the filled draft to the form. Reached from the
   * ledger, beside the "+" — photographing a bill is how an expense most
   * often starts.
   */
  scan: (groupId: string) => `/g/scan?id=${encodeURIComponent(groupId)}`,
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
  /**
   * What a scan costs, where to chip in, and the offer to split what you gave
   * with the group. Off the foot of the balances tab — not a FAB: the balances
   * tab is a reading, and the app's two floating buttons are the ledger's.
   */
  tip: (groupId: string) => `/g/tip?id=${encodeURIComponent(groupId)}`,
  /**
   * The donation as an ordinary expense, named and otherwise blank — the
   * amount is whatever was actually given, which only the giver knows. `via`
   * is "balances" so saving lands back where the tip screen was reached from.
   */
  tipEntry: (groupId: string, title: string) =>
    `${route.addEntry(groupId, "expense", "balances")}&title=${encodeURIComponent(title)}`,
  members: (groupId: string) => `/g/members?id=${encodeURIComponent(groupId)}`,
  /**
   * The export as text, reached only when neither the share sheet nor a
   * download is available (`lib/export.ts`). A screen and not a dialog: it
   * holds a whole ledger. It rebuilds the CSV itself, because a route cannot
   * carry a file and a readout that empties on reload is the drawer state
   * ADR-0007 got rid of.
   */
  exportCsv: (groupId: string) => `/g/export?id=${encodeURIComponent(groupId)}`,
  /** The group's exchange-rate registry: one rate per currency it spends in. */
  rates: (groupId: string) => `/g/rates?id=${encodeURIComponent(groupId)}`,
  /** The last step of joining: pick which member you are, then go in. */
  claim: (groupId: string) => `/g/claim?id=${encodeURIComponent(groupId)}`,
  /**
   * A bill split with people who are not a group
   * ([ADR-0035](../../../docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md)).
   * No id in the query string: there is no group to name, and the one thing
   * these three screens share lives in memory for as long as the split does.
   */
  quick: () => "/quick",
  quickItems: () => "/quick/items",
  quickResult: () => "/quick/result",
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
 * Where saving on the entry form lands: the screen the form was opened from,
 * never just the ledger — settling up belongs back on the balances you were
 * clearing, and an entry reached from a list belongs back in that list
 * (ADR-0007). Editing an existing entry returns to that entry, carrying its
 * own `via` so its back arrow still climbs to whoever linked in; a new one
 * returns to the screen that asked for it.
 */
export function formParent(
  groupId: string, entryId: string | undefined, via: EntrySource | undefined,
): string {
  return entryId ? route.entry(groupId, entryId, via) : entryParent(groupId, via);
}
