"use client";

import { useState, type ReactNode } from "react";
import { copy } from "../lib/copy";
import { deleteExpense, deleteSettlement } from "../lib/db/commands";
import type { EntryKind } from "../lib/entry-kind";
import { ConfirmDialog } from "./dialog";

/**
 * Deleting an entry, from its row's long press or from its own screen: one
 * question, then a delete op, which the history can restore (ADR-0010). `ask`
 * puts the question; `dialog` is where it is drawn. `then` runs once deleted.
 */
export function useDeleteEntry({ groupId, me, kind, entryId, then }: {
  groupId: string | undefined;
  me: string | undefined;
  kind: EntryKind;
  entryId: string;
  then?: () => void;
}): { ask: () => void; dialog: ReactNode } {
  const [asking, setAsking] = useState(false);

  async function remove() {
    if (!groupId || !me) return;
    if (kind === "transfer") await deleteSettlement(groupId, me, entryId);
    else await deleteExpense(groupId, me, entryId);
    then?.();
  }

  return {
    ask: () => setAsking(true),
    dialog: asking ? (
      <ConfirmDialog title={copy.entry.deleteTitle(copy.entryKind.label[kind].toLowerCase())}
        confirm={copy.act.delete} danger={true} onConfirm={remove} onClose={() => setAsking(false)}>
        <p>{copy.entry.deleteBody}</p>
      </ConfirmDialog>
    ) : null,
  };
}
