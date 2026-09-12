"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { memberIdFor, newGroupSecret, newId, receiptExtras } from "@bida/core";
import { copy } from "./copy";
import { groupToken } from "./seal";
import { getDevice, updateDevice } from "./db/device";
import { receiptBill, type EntryDraft } from "./draft";
import { bare, countText } from "./format";
import { receiptTotalMinor, type MemberLine } from "./scan/items";

/**
 * A quick split: a bill divided among people who are not a group
 * ([ADR-0035](../../../docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md)).
 *
 * It appends no op, so there is no actor, no identity to claim and nothing to
 * sync. The bill itself is an ordinary `EntryDraft` — the same one the scan
 * fills for a group, and the same one the who-had-what grid edits — which is
 * what lets the whole flow reuse those two without either of them learning a
 * second mode. What lives here is the part a draft has no room for: who is
 * splitting, and what this phone scans with.
 */

/** Somebody at the table. Keyed like a member, by their name (ADR-0034). */
export interface QuickPerson {
  id: string;
  name: string;
}

/**
 * What this phone scans with when it is not in a group.
 *
 * `/api/groups/:id/scan` authenticates a bearer token against a row in D1 and
 * refuses an id it has never seen, because the alternative is an open proxy
 * to our Gemini key. So a quick split brings a credential shaped exactly like
 * a group's. It is one per *phone* rather than one per split — a stable
 * caller is the unit anything we ever throttle would want to count, and the
 * alternative writes a fresh row for every bill anybody photographs.
 */
export interface ScanCredential {
  id: string;
  secret: string;
}

/** Read this phone's scan credential, minting one the first time. */
export async function scanCredential(): Promise<ScanCredential> {
  const device = await getDevice();
  if (device.scan) return device.scan;
  const scan = { id: newId(), secret: newGroupSecret() };
  await updateDevice({ scan });
  return scan;
}

/** The credential, once Dexie has answered. Undefined for the first frame. */
export function useScanCredential(): ScanCredential | undefined {
  const [cred, setCred] = useState<ScanCredential>();
  useEffect(() => {
    let live = true;
    void scanCredential().then((c) => { if (live) setCred(c); });
    return () => { live = false; };
  }, []);
  return cred;
}

/**
 * Introduce the credential to the server, so the scan endpoint knows the id.
 *
 * The ops endpoint registers an id and a token hash on first sight
 * (`ensureGroup`), and this is that call with nothing in it: the row it leaves
 * holds an id, a hash and a timestamp, and **no op is ever pushed under it**,
 * so the server learns strictly less about a quick split than about a group.
 *
 * Run before every scan rather than once and remembered. It is one small
 * request beside a photo upload, it costs one D1 read when the row is already
 * there, and it is the only version of this that survives the row not being
 * there — a phone holding a credential the server has no record of could
 * otherwise never scan again, with nothing on screen to say why.
 *
 * It never throws. A phone that cannot reach us cannot scan either, and the
 * scan says *that* far better than a registration failure could.
 */
export async function registerScanCredential(cred: ScanCredential): Promise<void> {
  try {
    await fetch(`/api/groups/${encodeURIComponent(cred.id)}/ops`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await groupToken(cred.id, cred.secret)}`,
      },
      body: JSON.stringify({ ops: [], since: 0 }),
    });
  } catch { /* the scan is about to say so, in words about the network */ }
}

// ------------------------------------------------------------- who is here

const EMPTY: readonly QuickPerson[] = Object.freeze([]);
const listeners = new Set<() => void>();
let people: readonly QuickPerson[] = EMPTY;

function emit(): void {
  for (const l of listeners) l();
}

/**
 * Who is splitting, live.
 *
 * Outside React and outside Dexie, exactly like the draft it travels with:
 * three screens share it, and a quick split is no more a fact about the world
 * than a half-typed expense is. Leaving throws it away (ADR-0035).
 */
export function useQuickPeople(): readonly QuickPerson[] {
  return useSyncExternalStore(
    (onChange) => { listeners.add(onChange); return () => listeners.delete(onChange); },
    () => people,
    () => EMPTY,
  );
}

export function quickPeople(): readonly QuickPerson[] {
  return people;
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
export interface QuickShare {
  name: string;
  minor: number;
  lines: MemberLine[];
}

/**
 * What the grid comes to: one figure per person who was at the table, and the
 * bill's own total.
 *
 * The figures are `receiptBill`'s weights read as money. Inside a group those
 * weights are ratios, because a group converts the total through a rate first;
 * a quick split converts nothing, so they are already the answer — and they
 * add to the total by construction, which `quick.test.ts` holds us to.
 *
 * Somebody who was there and ordered nothing stays on the list at zero: they
 * were at the table, and a name that vanishes reads as a mistake.
 */
export function quickShares(
  draft: EntryDraft,
  who: readonly QuickPerson[],
): { totalMinor: number; shares: QuickShare[] } {
  const items = draft.receiptItems ?? [];
  const assignments = (draft.receiptAssignments ?? []).map((row) => new Set(row));
  const involved = new Set(draft.receiptInvolved ?? []);
  const { weights, lines } = receiptBill(draft, items, assignments, involved);
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
 * The whole answer as text, for the clipboard.
 *
 * Plain lines, no columns: this is read in a chat app, where nothing is
 * monospaced and a table drawn with spaces arrives as a mess. Figures are
 * bare — a quick split converts nothing, so a currency here would be a label,
 * and a label read off a photograph is worse than none (ADR-0035).
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
