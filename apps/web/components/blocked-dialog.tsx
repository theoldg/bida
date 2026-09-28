"use client";

import Link from "next/link";
import type { Expense, Settlement } from "@bida/core";
import { NoticeDialog } from "./dialog";
import { copy } from "../lib/copy";
import { money } from "../lib/format";
import { route, type EntrySource } from "../lib/group-link";

/** One entry still leaning on what is being removed — the dialog treats both kinds alike. */
export interface BlockingEntry {
  id: string;
  label: string;
  baseAmountMinor: number;
}

/** Expenses and transfers as the rows `BlockedDialog` lists, in that order. */
export function blockingEntries(
  expenses: readonly Expense[],
  settlements: readonly Settlement[],
  nameOf: (id: string) => string,
): BlockingEntry[] {
  return [
    ...expenses.map((e) => ({
      id: e.id,
      label: e.description || copy.group.untitled,
      baseAmountMinor: e.baseAmountMinor,
    })),
    ...settlements.map((s) => ({
      id: s.id,
      label: copy.group.paidTo(nameOf(s.fromMember), nameOf(s.toMember)),
      baseAmountMinor: s.baseAmountMinor,
    })),
  ];
}

/**
 * "Can't remove this": a person or a currency is removed only when nothing
 * leans on it, and the refusal lists what does, each row a way to go and
 * change it. `via` is the screen the entry's back arrow returns to.
 */
export function BlockedDialog({ title, body, entries, groupId, via, base, onClose }: {
  title: string;
  body: string;
  entries: readonly BlockingEntry[];
  groupId: string;
  via: EntrySource;
  base: string;
  onClose: () => void;
}) {
  return (
    <NoticeDialog title={title} onClose={onClose} list={entries.map((e) => (
      <Link key={e.id} href={route.entry(groupId, e.id, via)} className="drow-pick">
        <span className="rmain">
          <span className="rtitle">{e.label}</span>
        </span>
        <span className="rmeta">{money(e.baseAmountMinor, base)}</span>
      </Link>
    ))}>
      <p>{body}</p>
    </NoticeDialog>
  );
}
