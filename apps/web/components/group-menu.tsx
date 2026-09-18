"use client";

import { isDemo } from "@bida/core";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { copy } from "../lib/copy";
import { clearDemo, forgetGroup } from "../lib/db/commands";
import { exportFilename, groupCsv, handOffCsv } from "../lib/export";
import { route } from "../lib/group-link";
import { useInviteLink, type GroupData } from "../lib/hooks";
import { DemoNoLink } from "./demo";
import { ConfirmDialog } from "./dialog";
import { InviteFallback } from "./invite";
import { MenuButton, type SheetAction } from "./row-menu";

/**
 * Everything a group can be asked for that isn't the ledger, behind one
 * button. These were four icons in the top bar, which is as many as the bar
 * holds and one more than reads: four unlabelled glyphs are four guesses, and
 * the group's name — the one thing that says which group you are in — was
 * squeezed to fit them. The menu is the same card a long press opens on a row
 * (`RowMenu`), so the app has one menu, not two.
 *
 * Forgetting is here too, and it is the only place inside a group that offers
 * it; the groups list offers the same pair from outside (app/page.tsx). It
 * does not wait for a claim: a group this phone never said who it was in is
 * the one it most wants off the list, and forgetting is purely local
 * (`forgetGroup`), so there is nothing an unclaimed phone lacks to do it.
 *
 * `data` comes from the screen rather than a hook of this component's own:
 * exporting needs the whole ledger, `/g` is already holding it, and a second
 * `useGroupData` here would be a second live subscription to the rows on
 * screen.
 */
export function GroupMenu({ groupId, data }: { groupId: string; data: GroupData }) {
  const router = useRouter();
  const invite = useInviteLink(groupId);
  const [asking, setAsking] = useState(false);
  // The demo has no key and therefore no invite link, so Copy invite link
  // stays on the menu and refuses out loud instead of quietly going missing
  // (components/demo.tsx).
  const demo = isDemo(groupId);
  const [noLink, setNoLink] = useState(false);

  /**
   * Export: build the file, then hand it over by whatever this browser has.
   *
   * Nothing is said on success, because nothing here can honestly say what
   * happened — the share sheet doesn't report which destination was picked and
   * a download has no completion event. A browser with neither is the only
   * outcome that has anything to add, and it gets a screen.
   */
  async function exportData() {
    if (!data.group) return;
    const csv = groupCsv(data);
    const handoff = await handOffCsv(exportFilename(data.group.name, Date.now()), csv);
    if (handoff === "unavailable") router.push(route.exportCsv(groupId));
  }

  const actions: SheetAction[] = [
    ...(demo
      ? [{ label: copy.group.copyLink, icon: "link" as const, onSelect: () => setNoLink(true) }]
      : invite.copy
        ? [{ label: copy.group.copyLink, icon: "link" as const, onSelect: invite.copy }]
        : []),
    { label: copy.group.people, icon: "users", onSelect: () => router.push(route.members(groupId)) },
    { label: copy.rates.title, icon: "fx", onSelect: () => router.push(route.rates(groupId)) },
    { label: copy.group.history, icon: "clock", onSelect: () => router.push(route.history(groupId)) },
    { label: copy.group.export, icon: "share", onSelect: () => void exportData() },
    // Clearing the demo takes its place: forgetting only hides, and a hidden
    // demo with no link to reopen it is a group that is gone and still on disk.
    { label: demo ? copy.demo.clear : copy.members.forget, icon: "trash", danger: true,
      onSelect: () => setAsking(true) },
  ];

  async function forget() {
    if (demo) await clearDemo();
    else await forgetGroup(groupId);
    // Unlike the groups list, this screen *is* the group: once it's forgotten
    // there is nothing here to come back to, so leave and don't leave it
    // behind in the history either.
    router.replace(route.groups());
  }

  return (
    <>
      <MenuButton icon="more" label={copy.group.menu} actions={actions}
        confirmed={invite.copied} />

      <InviteFallback invite={invite} />

      {noLink ? <DemoNoLink onClose={() => setNoLink(false)} /> : null}

      {asking ? (
        <ConfirmDialog
          title={demo ? copy.demo.clear : copy.members.forget}
          confirm={demo ? copy.demo.clear : copy.members.forget}
          danger={true}
          onConfirm={forget} onClose={() => setAsking(false)}>
          <p>{demo ? copy.demo.clearBody : copy.members.forgetBody}</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
