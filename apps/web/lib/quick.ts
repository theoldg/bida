"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { isDemo, memberIdFor, newGroupId, newGroupSecret, receiptExtras } from "@bida/core";
import { copy } from "./copy";
import { groupToken } from "./seal";
import { getDevice, updateDevice } from "./db/device";
import { useGroupSecret } from "./hooks";
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
 * What lives here is what a draft has no room for: who is splitting, and what
 * this phone scans with.
 */

/** Somebody at the table. Keyed like a member, by their name (ADR-0034). */
export interface QuickPerson {
  id: string;
  name: string;
}

/**
 * What this phone scans with outside a group — or in the demo, which the
 * server has never heard of
 * ([sync.md](../../../docs/sync.md#the-demo-group-has-no-key)).
 *
 * The scan endpoint authenticates a bearer against a D1 row and refuses
 * unknown ids (or it would be an open proxy to our Gemini key), so this is a
 * credential shaped like a group's. One per *phone*, not per split: a stable
 * caller is what throttling counts, and one per bill would be a row per photo.
 */
interface ScanCredential {
  id: string;
  secret: string;
}

/**
 * A credential plus whatever must happen before the first photo — introducing
 * it to the server. What every scan is sent under.
 */
export interface ScanAs extends ScanCredential {
  /** Run once the photo is in hand and before anything is sent. Never throws. */
  prepare?: () => Promise<void>;
}

/** Read this phone's scan credential, minting one the first time. */
async function scanCredential(): Promise<ScanCredential> {
  const device = await getDevice();
  if (device.scan) return device.scan;
  const scan = { id: newGroupId(), secret: newGroupSecret() };
  await updateDevice({ scan });
  return scan;
}

/**
 * The credential, once Dexie has answered. `when` false on a screen that won't
 * scan with it: reading it mints it.
 */
export function useScanCredential(when = true): ScanCredential | undefined {
  const [cred, setCred] = useState<ScanCredential>();
  useEffect(() => {
    if (!when) return;
    let live = true;
    void scanCredential().then((c) => { if (live) setCred(c); });
    return () => { live = false; };
  }, [when]);
  return cred;
}

/**
 * Introduce the credential to the server so the scan endpoint knows the id —
 * the ops endpoint's first-sight registration (`ensureGroup`) with no ops.
 * **No op is ever pushed under it**, so the server learns less than about a
 * group.
 *
 * **Run before every scan, never once and remembered**: it is cheap, and it
 * is the only version that survives the row going missing — otherwise the
 * phone could never scan again, with nothing saying why.
 *
 * Never throws: an unreachable server fails the scan with a better sentence.
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

/**
 * What a scan inside a group is sent under: usually the group's id and
 * derived bearer. **The demo is the exception** — no key, and its id must
 * never reach the server — so it scans on this phone's own credential
 * ([sync.md](../../../docs/sync.md#the-demo-group-has-no-key)).
 *
 * Undefined until there is something to scan with, which disables the camera
 * rather than failing at the shutter.
 */
export function useScanAs(groupId: string | undefined): ScanAs | undefined {
  const demo = isDemo(groupId);
  const secret = useGroupSecret(demo ? undefined : groupId);
  const cred = useScanCredential(demo);
  return useMemo(() => {
    if (demo) {
      return cred && { ...cred, prepare: () => registerScanCredential(cred) };
    }
    return groupId && secret ? { id: groupId, secret } : undefined;
  }, [demo, cred, groupId, secret]);
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
  /** Read the bill's own words in English rather than as printed (`billLabel`). */
  english = false,
): { totalMinor: number; shares: QuickShare[] } {
  // Only the labels move: the arithmetic below reads amounts, and the text
  // this ends on is the same bill in whichever language it is being read.
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
