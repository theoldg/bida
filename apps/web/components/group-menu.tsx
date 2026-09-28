"use client";

import { useRouter } from "next/navigation";
import { copy } from "../lib/copy";
import { exportFilename, groupCsv, handOffCsv } from "../lib/export";
import { route } from "../lib/group-link";
import { type GroupData } from "../lib/hooks";
import { useGroupActions } from "./group-actions";
import { MenuButton, type SheetAction } from "./row-menu";

/**
 * Everything a group can be asked for besides the ledger, behind one button —
 * **not a row of icons in the top bar**, where glyphs are guesses and squeeze
 * the name. The same card as a row's long press (`RowMenu`); copying the link
 * and forgetting are the groups list's too (`useGroupActions`).
 *
 * `data` comes from the screen: export needs the whole ledger, `/g` already
 * holds it, and a second `useGroupData` would be a second live subscription.
 */
export function GroupMenu({ groupId, data }: { groupId: string; data: GroupData }) {
  const router = useRouter();
  // Unlike the groups list, this screen *is* the group: once it's forgotten
  // there is nothing here to come back to, so leave and don't leave it behind
  // in the history either.
  const group = useGroupActions(groupId, () => router.replace(route.groups()));

  /**
   * Export: build the file, then hand it over by whatever this browser has.
   * Silent on success — neither the share sheet nor a download reports an
   * outcome. Only a browser with neither gets a screen.
   */
  async function exportData() {
    if (!data.group) return;
    const csv = groupCsv(data);
    const handoff = await handOffCsv(exportFilename(data.group.name, Date.now()), csv);
    if (handoff === "unavailable") router.push(route.exportCsv(groupId));
  }

  const actions: SheetAction[] = [
    ...group.copyLink,
    { label: copy.group.people, icon: "users", onSelect: () => router.push(route.members(groupId)) },
    { label: copy.rates.title, icon: "fx", onSelect: () => router.push(route.rates(groupId)) },
    { label: copy.group.history, icon: "clock", onSelect: () => router.push(route.history(groupId)) },
    { label: copy.group.export, icon: "share", onSelect: () => void exportData() },
    group.forget,
  ];

  return (
    <>
      <MenuButton icon="more" label={copy.group.menu} actions={actions}
        confirmed={group.copied} />
      {group.dialogs}
    </>
  );
}
