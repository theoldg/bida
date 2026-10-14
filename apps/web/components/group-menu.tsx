"use client";
// Doc: docs/navigation.md#routing

import { useRouter } from "next/navigation";
import { copy } from "../lib/copy";
import { exportFilename, groupCsv, handOffCsv } from "../lib/export";
import { route } from "../lib/group-link";
import { usePrefetch } from "../lib/prefetch";
import { type GroupData } from "../lib/hooks";
import { useGroupActions } from "./group-actions";
import { summonLedgerSearch } from "./ledger-search";
import { MenuButton, type SheetAction } from "./row-menu";

/**
 * Everything a group can be asked for besides the ledger and its history,
 * behind one button — **not a row of icons in the top bar**, where glyphs are
 * guesses and squeeze the name. History alone stands beside it
 * (`HistoryButton`), since its dot is how the ledger says what changed. The same card as a row's long press (`RowMenu`); copying the link
 * and forgetting are the groups list's too (`useGroupActions`).
 *
 * `data` comes from the screen: export needs the whole ledger, `/g` already
 * holds it, and a second `useGroupData` would be a second live subscription.
 */
export function GroupMenu({ groupId, data }: { groupId: string; data: GroupData }) {
  const router = useRouter();
  usePrefetch([route.members(groupId), route.settings()]);
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
    { label: copy.group.search.menu, icon: "search", onSelect: summonLedgerSearch },
    { label: copy.group.export, icon: "share", onSelect: () => void exportData() },
    // The phone's, not the group's: the same screen the groups list opens.
    { label: copy.groups.settings, icon: "sliders", onSelect: () => router.push(route.settings()) },
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
