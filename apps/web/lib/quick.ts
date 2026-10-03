"use client";

import { useSyncExternalStore } from "react";
import { memberIdFor, receiptExtras } from "@bida/core";
import { copy } from "./copy";
import { receiptBill, type EntryDraft } from "./draft";
import { bare, countText } from "./format";
import { billLabels, receiptTotalMinor, type MemberLine } from "./scan/items";
import { signal } from "./signal";

/**
 * A quick split: a bill divided among people who are not a group
 * ([ADR-0035](../../../docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md)).
 *
 * No op, so no actor, no identity and nothing to sync. The bill is an ordinary
 * `EntryDraft`, so the scan and the who-had-what grid are reused unchanged.
 * What lives here is what a draft has no room for: who is splitting. What this
 * phone scans with is `lib/scan/credential.ts`.
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
 * The whole answer as text, for the clipboard. Plain lines, no columns — chat
 * apps aren't monospaced. Bare figures: a currency read off a photo is worse
 * than none (ADR-0035).
 */
export function quickSummaryText(
  title: string,
  totalMinor: number,
  shares: readonly QuickShare[],
  currency: string,
): string {
  const words = copy.quick.summary;
  const head = words.line(title.trim() || words.total, bare(totalMinor, currency));
  const body = shares.map((share) => [
    words.line(share.name, bare(share.minor, currency)),
    ...share.lines.map((line) => {
      const count = line.extra ? null : countText(line.count);
      const label = line.extra ? line.label || copy.items.extra[line.extra] : line.label;
      return words.item(count ? words.count(label, count) : label, bare(line.minor, currency));
    }),
  ].join("\n"));
  return [head, "", ...body].join("\n");
}
