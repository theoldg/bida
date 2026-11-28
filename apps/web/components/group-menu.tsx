"use client";
// Doc: docs/navigation.md#routing

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { endCatchUp, useLedgerLook } from "../lib/catch-up";
import { copy } from "../lib/copy";
import { useLive } from "../lib/db/live";
import { newsCount } from "../lib/db/news";
import { exportFilename, groupCsv, handOffCsv } from "../lib/export";
import { route } from "../lib/group-link";
import { usePrefetch } from "../lib/prefetch";
import { type GroupData, warmHistory } from "../lib/hooks";
import { useGroupActions } from "./group-actions";
import { summonLedgerSearch } from "./ledger-search";
import { MenuButton, type SheetAction } from "./row-menu";

/**
 * Everything a group can be asked for besides the ledger, behind one button —
 * **not a row of icons in the top bar**, where glyphs are guesses and squeeze
 * the name. The same card as a row's long press (`RowMenu`); copying the link
 * and forgetting are the groups list's too (`useGroupActions`). What changed
 * on other phones shows as a dot on the button and on History's icon
 * (`useHistoryNews`).
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
  const news = useHistoryNews(groupId);

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
    { label: copy.group.history, icon: "clock", dot: news,
      onSelect: () => router.push(route.history(groupId)) },
    { label: copy.group.people, icon: "users", onSelect: () => router.push(route.members(groupId)) },
    // An empty ledger has nothing to find, and no first row to glide under the bar.
    ...(data.expenses.length + data.settlements.length > 0
      ? [{ label: copy.group.search.menu, icon: "search", onSelect: summonLedgerSearch } as const]
      : []),
    { label: copy.group.export, icon: "share", onSelect: () => void exportData() },
    // The phone's, not the group's: the same screen the groups list opens.
    { label: copy.groups.settings, icon: "sliders", onSelect: () => router.push(route.settings()) },
    group.forget,
  ];

  return (
    <>
      <MenuButton icon="more" label={news ? copy.group.menuNew : copy.group.menu}
        actions={actions} confirmed={group.copied} dot={news}
        onOpen={() => warmHistory(groupId)} />
      {group.dialogs}
    </>
  );
}

/**
 * Whether other phones changed something this one hasn't seen — the menu's dot.
 *
 * **New** is `newsCount` (lib/db/news.ts), which the groups list counts too.
 * The dot stays until history is opened (`useCatchUp`) or the ledger is opened
 * again (`useLedgerLook`), or the change ages out after `CATCH_UP_MS`. Being
 * back on the ledger ends the last look at history, so the next one draws its
 * torn line afresh.
 */
function useHistoryNews(groupId: string): boolean {
  const look = useLedgerLook(groupId);
  // Keyed by the look: the last look's answer, remembered, would flash its dot.
  const news = useLive("newEdits", async () => look !== undefined && await newsCount(groupId) > 0,
    [groupId, look]);

  useEffect(() => endCatchUp(groupId), [groupId]);
  return news === true;
}
