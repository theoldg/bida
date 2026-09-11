"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { copy } from "../lib/copy";
import { forgetGroup } from "../lib/db/commands";
import { route } from "../lib/group-link";
import { useInviteLink } from "../lib/hooks";
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
 * it; the groups list offers the same pair from outside (app/page.tsx).
 */
export function GroupMenu({ groupId, claimed }: {
  groupId: string;
  /** Whether this phone has said who it is — forgetting waits for that. */
  claimed: boolean;
}) {
  const router = useRouter();
  const invite = useInviteLink(groupId);
  const [asking, setAsking] = useState(false);

  const actions: SheetAction[] = [
    ...(invite.copy ? [{ label: copy.group.copyLink, icon: "link" as const, onSelect: invite.copy }] : []),
    { label: copy.group.people, icon: "users", onSelect: () => router.push(route.members(groupId)) },
    { label: copy.rates.title, icon: "fx", onSelect: () => router.push(route.rates(groupId)) },
    { label: copy.group.history, icon: "clock", onSelect: () => router.push(route.history(groupId)) },
    ...(claimed
      ? [{ label: copy.members.forget, icon: "trash" as const, danger: true, onSelect: () => setAsking(true) }]
      : []),
  ];

  async function forget() {
    await forgetGroup(groupId);
    // Unlike the groups list, this screen *is* the group: once it's forgotten
    // there is nothing here to come back to, so leave and don't leave it
    // behind in the history either.
    router.replace(route.groups());
  }

  return (
    <>
      <MenuButton icon="more" label={copy.group.menu} actions={actions} />

      <InviteFallback invite={invite} />

      {asking ? (
        <ConfirmDialog title={copy.members.forget} confirm={copy.members.forget}
          onConfirm={forget} onClose={() => setAsking(false)}>
          <p>{copy.members.forgetBody}</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
