import type { EntryKind } from "./entry-kind";

/**
 * A group IS its link: holding it is the whole of authorisation (ADR-0004), so
 * the secret rides in the URL *fragment*, which browsers never send — it can't
 * leak into an access log or a Referer.
 *
 *   https://bida.app/join#<groupId>.<secret>
 *
 * The app's own routes carry only the group id, which confers nothing alone.
 */

export interface JoinLink {
  groupId: string;
  secret: string;
}

const isToken = (x: string | undefined): x is string => !!x && /^[A-Za-z0-9_-]+$/.test(x);

const fragmentOf = (input: string) => (input.includes("#") ? input.slice(input.indexOf("#") + 1) : input);

export function formatJoinLink(link: JoinLink, origin?: string): string {
  const base = origin ?? (typeof window === "undefined" ? "" : window.location.origin);
  return `${base}/join#${link.groupId}.${link.secret}`;
}

/** A whole URL or just the fragment; null on anything unexpected. */
export function parseJoinLink(input: string): JoinLink | null {
  const [groupId, secret, ...rest] = fragmentOf(input).split(".");
  return rest.length === 0 && isToken(groupId) && isToken(secret) ? { groupId, secret } : null;
}

/**
 * A group riding onto an iOS home screen, with which member this phone is, so
 * the installed app doesn't ask "who are you?" again (docs/ios.md).
 */
export interface CarriedGroup extends JoinLink {
  me?: string;
}

/**
 * Several groups in one fragment, `<id>.<secret>[.<member>]~…`, read only by
 * `/install`. A `/join` link stays one group and never names a member: it is
 * what people send each other.
 */
export function formatInvites(links: readonly CarriedGroup[]): string {
  return links.map((link) => `${link.groupId}.${link.secret}${link.me ? `.${link.me}` : ""}`).join("~");
}

/** Malformed groups drop out. */
export function parseInvites(input: string): CarriedGroup[] {
  return fragmentOf(input).split("~").flatMap((part): CarriedGroup[] => {
    const [groupId, secret, me, ...rest] = part.split(".");
    if (rest.length || !isToken(groupId) || !isToken(secret) || (me !== undefined && !isToken(me))) return [];
    return [{ groupId, secret, ...(me ? { me } : {}) }];
  });
}

/**
 * `#<groupId>` with no secret. Told apart from a malformed link because the fix
 * differs: copy the invite from the app, not the address bar.
 */
export function isKeylessFragment(hash: string): boolean {
  return /^#?[A-Za-z0-9_-]+\.?$/.test(hash);
}

type PastedLink =
  | { kind: "join"; link: JoinLink }
  | { kind: "elsewhere"; host: string }
  | { kind: "keyless"; groupId: string }
  | { kind: "none" }
  | { kind: "empty" };

/**
 * The clipboard as a join link. Stricter than `parseJoinLink`: nobody chose to
 * open the clipboard, so only a whole `/join` URL counts. Another deployment's
 * link is reported by host, since that is where the group lives.
 */
export function readPastedLink(text: string, origin: string): PastedLink {
  // iOS reads a clipboard holding a picture as "".
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
    return groupId && isToken(groupId) ? { kind: "keyless", groupId } : { kind: "none" };
  }
  return url.origin === origin ? { kind: "join", link } : { kind: "elsewhere", host: url.host };
}

/**
 * The screen an entry was opened from, so back and save return there
 * (ADR-0007). In the URL rather than memory, so a reload can't change it.
 * `ledger` marks the form opened straight off a ledger row's long press.
 */
const ENTRY_SOURCES = ["history", "members", "balances", "ledger"] as const;
export type EntrySource = typeof ENTRY_SOURCES[number];

const withGroup = (path: string, groupId: string) => `${path}?id=${encodeURIComponent(groupId)}`;
const viaParam = (via?: EntrySource) => (via ? `&via=${via}` : "");
const entryParam = (entryId?: string) => (entryId ? `&e=${encodeURIComponent(entryId)}` : "");

/**
 * Every screen is a static page with the group id in the query string: no
 * dynamic segments to pre-render, and a link that survives a refresh.
 */
export const route = {
  groups: () => "/",
  newGroup: () => "/new",
  /** Linked from nowhere: long-press the wordmark. */
  diag: () => "/diag",
  diagCrop: () => "/diag/crop",
  about: () => "/about",
  /** Linked from nowhere: `/about` prints the address, as deliberate friction. */
  deleteMyData: () => "/delete-my-data",
  advanced: () => "/advanced",
  /** The phone's invites ride in the fragment: iOS writes the home-screen bookmark from this URL. */
  install: (links: readonly CarriedGroup[] = []) =>
    `/install${links.length ? `#${formatInvites(links)}` : ""}`,
  import: () => "/import",
  importPlan: () => "/import/plan",
  /** Linked from nowhere on purpose: the URL is the whole door. */
  demo: () => "/demo",
  /** Bare, it is the "Bad link" screen; a real one is `formatJoinLink`. */
  join: () => "/join",
  group: (groupId: string) => withGroup("/g", groupId),
  balances: (groupId: string) => withGroup("/g/balances", groupId),
  addEntry: (groupId: string, kind?: EntryKind, via?: EntrySource) =>
    withGroup("/g/entry/edit", groupId) + (kind && kind !== "expense" ? `&kind=${kind}` : "") + viaParam(via),
  editEntry: (groupId: string, entryId: string, via?: EntrySource) =>
    withGroup("/g/entry/edit", groupId) + entryParam(entryId) + viaParam(via),
  entry: (groupId: string, entryId: string, via?: EntrySource) =>
    withGroup("/g/entry", groupId) + entryParam(entryId) + viaParam(via),
  payers: (groupId: string) => withGroup("/g/payers", groupId),
  scan: (groupId: string) => withGroup("/g/scan", groupId),
  /** Carries the form's own `via`, so a detour here doesn't change where saving lands. */
  items: (groupId: string, via?: EntrySource) => withGroup("/g/entry/items", groupId) + viaParam(via),
  history: (groupId: string, entryId?: string, via?: EntrySource) =>
    withGroup("/g/history", groupId) + entryParam(entryId) + viaParam(via),
  tip: (groupId: string) => withGroup("/g/tip", groupId),
  /** The tip jar with no group behind it. */
  support: () => "/tip",
  /** Named and otherwise blank: only the giver knows the amount. */
  tipEntry: (groupId: string, title: string) =>
    `${route.addEntry(groupId, "expense", "balances")}&title=${encodeURIComponent(title)}`,
  members: (groupId: string) => withGroup("/g/members", groupId),
  /** The export as text, when neither share sheet nor download works (`lib/export.ts`). */
  exportCsv: (groupId: string) => withGroup("/g/export", groupId),
  claim: (groupId: string) => withGroup("/g/claim", groupId),
  /** No id: a quick split lives in memory (ADR-0035). */
  quick: () => "/quick",
  quickItems: () => "/quick/items",
  quickResult: () => "/quick/result",
};

export function parseEntrySource(value: string | null | undefined): EntrySource | undefined {
  return ENTRY_SOURCES.find((s) => s === value);
}

/** Whoever linked to the entry, or the ledger. */
export function entryParent(groupId: string, via: EntrySource | undefined): string {
  return via === "history" ? route.history(groupId)
    : via === "members" ? route.members(groupId)
      : via === "balances" ? route.balances(groupId)
        : route.group(groupId);
}

/** Saving an edit returns to that entry, keeping its `via` so its back arrow still climbs. */
export function formParent(
  groupId: string, entryId: string | undefined, via: EntrySource | undefined,
): string {
  return entryId && via !== "ledger" ? route.entry(groupId, entryId, via) : entryParent(groupId, via);
}
