/**
 * A group IS its link: holding it is the whole of authorisation (ADR-0004),
 * so the secret rides in the URL *fragment*, which browsers never send — it
 * can't leak into an access log, a Referer or an analytics row.
 *
 *   https://bida.app/join#<groupId>.<secret>
 *
 * The app's own routes carry only the group id, which confers nothing alone.
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
 * are URL-safe and cannot appear in any part (`[A-Za-z0-9_-]`).
 *
 * Only `/install` reads this. **A `/join` link stays one group and never a
 * member** — it is what people send each other, and `parseJoinLink` refuses a
 * third part.
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
 * A fragment naming a group with no password: `#<groupId>`, or with a dangling
 * dot. Told apart from a malformed link because its fix differs — the invite
 * link from the app, not the address bar (`components/keyless-link.tsx`).
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
 * Stricter than `parseJoinLink`: the clipboard is not a link someone chose to
 * open, so only a whole `/join` URL counts. Another origin's link is reported
 * rather than refused — the group lives on the deployment that made it, and
 * the host is what the person needs to hear. A link with no password is
 * `keyless` whichever server it names.
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
 * Where an entry was opened from, when that wasn't the ledger: the history
 * feed, the two "can't remove this yet" dialogs, the balances screen. Back
 * unwinds to that screen (`entryParent`, ADR-0007).
 *
 * **In the URL, never in memory**: a reload or a killed app must not change
 * where back goes. `via`, not `from` — `/g/entry/edit` spends `from` on a
 * member id.
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
   * Deleting a group from the server for everybody, on the strength of its
   * invite link (app/delete-my-data/page.tsx). **Linked from nowhere**: `/about`
   * prints the address to type, which is part of that screen's friction.
   */
  deleteMyData: () => "/delete-my-data",
  /**
   * Settings nobody gets by default: a Gemini key of your own. In the groups
   * list's kebab, not hidden like `/diag`.
   */
  advanced: () => "/advanced",
  /**
   * Why and how to put bida on an iOS home screen (docs/ios.md). The invites
   * this phone holds ride in the fragment, because the share sheet is opened
   * from here and iOS writes the bookmark from this URL.
   */
  install: (links: readonly CarriedGroup[] = []) =>
    `/install${links.length ? `#${formatInvites(links)}` : ""}`,
  /**
   * A Splitwise (or bida) CSV as a new group (app/import/page.tsx). Never into
   * an existing group: the file has no ids to match rows to entries.
   */
  import: () => "/import",
  /**
   * The demo group: real ops, never synced (app/demo/page.tsx). Creates or
   * reopens it, then redirects into its ledger. **Linked from nowhere on
   * purpose** — the URL is the whole door.
   */
  demo: () => "/demo",
  /** Bare, it is the "Bad link" screen; a real one is `formatJoinLink`. */
  join: () => "/join",
  /** The ledger: where a group opens, and the only screen that leaves it. */
  group: (groupId: string) => `/g?id=${encodeURIComponent(groupId)}`,
  /** Who is up, who is down, and settling. Pressed into from the ledger's balance card. */
  balances: (groupId: string) => `/g/balances?id=${encodeURIComponent(groupId)}`,
  /**
   * The one form. `kind` picks which of the three an entry starts as
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
   * Scan first, decide after: the scan buttons alone, handing the filled draft
   * to the form. Beside the ledger's "+".
   */
  scan: (groupId: string) => `/g/scan?id=${encodeURIComponent(groupId)}`,
  /**
   * Who-had-what. `via` is the form's own, held for the trip back — a detour
   * through here must not decide where saving lands.
   */
  items: (groupId: string, via?: EntrySource) =>
    `/g/entry/items?id=${encodeURIComponent(groupId)}` + (via ? `&via=${via}` : ""),
  /** `via` rides along on an entry's own history, so the chain back is exact. */
  history: (groupId: string, entryId?: string, via?: EntrySource) =>
    `/g/history?id=${encodeURIComponent(groupId)}${entryId ? `&e=${encodeURIComponent(entryId)}` : ""}`
    + (via ? `&via=${via}` : ""),
  /**
   * What a scan costs, where to chip in, and the offer to split what you gave.
   * Off the foot of the balances screen, not a FAB.
   */
  tip: (groupId: string) => `/g/tip?id=${encodeURIComponent(groupId)}`,
  /**
   * The tip jar with no group behind it, for `/about`: no per-member split and
   * no "add as an expense" (app/tip/page.tsx).
   */
  support: () => "/tip",
  /**
   * The donation as an expense, named and otherwise blank — only the giver knows
   * the amount. `via` "balances" so saving lands back on the tip screen's parent.
   */
  tipEntry: (groupId: string, title: string) =>
    `${route.addEntry(groupId, "expense", "balances")}&title=${encodeURIComponent(title)}`,
  members: (groupId: string) => `/g/members?id=${encodeURIComponent(groupId)}`,
  /**
   * The export as text, when neither share sheet nor download is available
   * (`lib/export.ts`). A screen that rebuilds the CSV itself: a route can't
   * carry a file, and a readout that empties on reload is what ADR-0007 removed.
   */
  exportCsv: (groupId: string) => `/g/export?id=${encodeURIComponent(groupId)}`,
  /** The group's exchange-rate registry: one rate per currency it spends in. */
  rates: (groupId: string) => `/g/rates?id=${encodeURIComponent(groupId)}`,
  /** The last step of joining: pick which member you are, then go in. */
  claim: (groupId: string) => `/g/claim?id=${encodeURIComponent(groupId)}`,
  /**
   * A bill split with people who are not a group
   * ([ADR-0035](../../../docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md)).
   * No id in the query: the split lives in memory for as long as it lasts.
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
        : via === "balances" ? route.balances(groupId)
          : route.group(groupId);
}

/**
 * Where saving on the entry form lands: the screen the form was opened from,
 * never just the ledger (ADR-0007). Editing returns to that entry, carrying
 * its `via` so its back arrow still climbs to whoever linked in.
 */
export function formParent(
  groupId: string, entryId: string | undefined, via: EntrySource | undefined,
): string {
  return entryId ? route.entry(groupId, entryId, via) : entryParent(groupId, via);
}

/**
 * Where an entry's own history goes back to: the entry, unless it has been
 * deleted — then the entry's own parent, since the entry screen would only say
 * it is gone.
 */
export function historyParent(
  groupId: string, entryId: string, via: EntrySource | undefined, deleted: boolean,
): string {
  return deleted ? entryParent(groupId, via) : route.entry(groupId, entryId, via);
}
