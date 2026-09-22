"use client";

import { isDemo } from "@bida/core";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { copy } from "../lib/copy";
import { clearDemo, forgetGroup } from "../lib/db/commands";
import { exportFilename, groupCsv, handOffCsv } from "../lib/export";
import { route } from "../lib/group-link";
import { useHost, useInviteLink, type GroupData } from "../lib/hooks";
import { DemoNoLink } from "./demo";
import { ConfirmDialog } from "./dialog";
import { InviteFallback } from "./invite";
import { MenuButton, type SheetAction } from "./row-menu";

/**
 * Everything a group can be asked for besides the ledger, behind one button —
 * **not a row of icons in the top bar**, where glyphs are guesses and squeeze
 * the name. The same card as a row's long press (`RowMenu`).
 *
 * Forgetting is here too (and on the groups list, app/page.tsx). **It doesn't
 * wait for a claim**: an unclaimed group is the one most wanted off the list,
 * and `forgetGroup` is purely local.
 *
 * `data` comes from the screen: export needs the whole ledger, `/g` already
 * holds it, and a second `useGroupData` would be a second live subscription.
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
  // Clearing the demo names the address that lays a fresh one down, and only
  // the browser knows which host that is (`useHost`).
  const host = useHost();

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
          <p>{demo ? copy.demo.clearBody(`${host}${route.demo()}`) : copy.members.forgetBody}</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
