"use client";

import { useSyncExternalStore } from "react";
import { memberIdFor, newGroupSecret, receiptExtras, type SharedSplit } from "@bida/core";
import { copy } from "./copy";
import { receiptBill, type EntryDraft } from "./draft";
import { bare } from "./format";
import { billLabels, receiptTotalMinor, type MemberLine } from "./scan/items";
import { signal } from "./signal";

/**
 * A quick split: a bill divided among people who are not a group
 * ([ADR-0035](../../../docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md)).
 *
 * No op, so no actor, no identity and nothing to sync. The bill is an ordinary
 * `EntryDraft`, so the scan and the who-had-what grid are reused unchanged.
 * What lives here is what a draft has no room for: who is splitting, and the
 * secret its link is made of. What this phone scans with is
 * `lib/scan/credential.ts`.
 */

/** Somebody at the table. Keyed like a member, by their name (ADR-0034). */
export interface QuickPerson {
  id: string;
  name: string;
}

// ------------------------------------------------------------- who is here

const EMPTY: readonly QuickPerson[] = Object.freeze([]);
const { emit, subscribe } = signal();
let people: readonly QuickPerson[] = EMPTY;

/**
 * Who is splitting, live. Outside React and Dexie like the draft it travels
 * with: three screens share it, and leaving throws it away (ADR-0035).
 */
export function useQuickPeople(): readonly QuickPerson[] {
  return useSyncExternalStore(
    subscribe,
    () => people,
    () => EMPTY,
  );
}

/** File a name. Ids are `memberIdFor`, so one name is one person here too. */
export function addQuickPerson(credId: string, name: string): void {
  const person = { id: memberIdFor(credId, name), name };
  if (people.some((p) => p.id === person.id)) return;
  people = [...people, person];
  emit();
}

export function removeQuickPerson(id: string): void {
  people = people.filter((p) => p.id !== id);
  emit();
}

export function clearQuickPeople(): void {
  people = EMPTY;
  link = undefined;
  emit();
}

// ------------------------------------------------------------- the answer

/** One person's share of the bill, and the lines it is made of. */
interface QuickShare {
  name: string;
  minor: number;
  lines: MemberLine[];
}

/**
 * What the grid comes to: one figure per person at the table, and the bill's
 * total. `receiptBill`'s weights read as money — a group converts through a
 * rate first, a quick split doesn't — and they add to the total by
 * construction (`quick.test.ts`). Somebody who ordered nothing stays at zero.
 */
export function quickShares(
  draft: EntryDraft,
  who: readonly QuickPerson[],
): { totalMinor: number; shares: QuickShare[] } {
  // The grid's translate toggle, left on the draft. Only the labels move: the
  // arithmetic below reads amounts, and the text this ends on is the same bill
  // in whichever language it is being read.
  const english = draft.receiptEnglish === true;
  const items = billLabels(draft.receiptItems ?? [], english);
  const assignments = (draft.receiptAssignments ?? []).map((row) => new Set(row));
  const involved = new Set(draft.receiptInvolved ?? []);
  const { weights, lines } = receiptBill(
    { ...draft, receiptDiscounts: [...billLabels(draft.receiptDiscounts ?? [], english)] },
    items, assignments, involved,
  );
  return {
    totalMinor: receiptTotalMinor(items, receiptExtras(draft), draft.currency) ?? 0,
    shares: who.filter((p) => involved.has(p.id)).map((p) => ({
      name: p.name,
      minor: weights[p.id] ?? 0,
      lines: lines[p.id] ?? [],
    })),
  };
}

/**
 * The answer as a link carries it (`lib/split-link.ts`): the figures on this
 * screen, frozen, and nothing they were worked out from.
 */
export function quickSharedSplit(
  title: string,
  totalMinor: number,
  shares: readonly QuickShare[],
  currency: string,
): SharedSplit {
  return { title: title.trim(), currency, totalMinor, people: shares.map((s) => ({ ...s })) };
}

/**
 * What the button copies: the bill and its total, what each person owes, and
 * the link to the lines behind it. Plain lines, no columns — chat apps aren't
 * monospaced. Bare figures: a currency read off a photo is worse than none
 * (ADR-0035).
 */
export function quickMessage(split: SharedSplit, link: string): string {
  const words = copy.quick.message;
  const figure = (minor: number) => bare(minor, split.currency);
  return [
    words.line(split.title || words.untitled, figure(split.totalMinor)),
    ...split.people.map((p) => words.line(p.name, figure(p.minor))),
    "",
    words.link(link),
  ].join("\n");
}

// ------------------------------------------------------------- the link

let link: {
  figures: string;
  secret: string;
  /** On its way or landed; dropped on a failure, so the next ask tries again. */
  upload?: Promise<boolean>;
  sent: boolean;
  /** Copied by somebody, not merely uploaded: what Done asks about. */
  handed: boolean;
} | undefined;

/**
 * The secret this split's link is made of. **One per set of figures**: a
 * second press sends the same link, so its upload is a no-op, and a grid
 * changed since mints a new one, since the old link already says what it
 * said. Held with the people, and forgotten with them.
 */
export function quickLinkSecret(split: SharedSplit): string {
  const figures = JSON.stringify(split);
  if (link?.figures !== figures) {
    link = { figures, secret: newGroupSecret(), sent: false, handed: false };
  }
  return link.secret;
}

/**
 * Put this link's split on the server, once. Kept with the secret rather than
 * on the screen, so a trip back to the grid and forward again, with nothing
 * changed, doesn't send it twice; asked again while on its way, it is the same
 * wait. `send` is `shareSplit`, passed in so this stays testable offline.
 */
export function sendQuickLink(secret: string, send: () => Promise<boolean>): Promise<boolean> {
  const held = link?.secret === secret ? link : undefined;
  if (!held) return send();
  if (held.upload) return held.upload;
  const upload: Promise<boolean> = send().catch(() => false).then((ok) => {
    if (ok) held.sent = true;
    else if (held.upload === upload) held.upload = undefined;
    return ok;
  });
  held.upload = upload;
  return upload;
}

/** Whether the server already holds this link's split. */
export function quickLinkSent(secret: string): boolean {
  return link?.secret === secret && link.sent;
}

export function quickLinkHanded(secret: string): boolean {
  return link?.secret === secret && link.handed;
}

export function markQuickLinkHanded(secret: string): void {
  if (link?.secret === secret) link.handed = true;
}
