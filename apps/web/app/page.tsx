"use client";

import { isDemo } from "@bida/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Avatar, signClass } from "@/components/bits";
import { Icon } from "@/components/icons";
import { Body, Empty, Screen, Scroll, SkeletonRows, TopBar } from "@/components/chrome";
import { ConfirmDialog } from "@/components/dialog";
import { InstallOfferCard } from "@/components/install";
import { DemoNoLink } from "@/components/demo";
import { InviteFallback } from "@/components/invite";
import { usePasteLink } from "@/components/paste-link";
import { useHold, useLongPressMenu } from "@/components/long-press";
import { HomeMenu } from "@/components/home-menu";
import { UpdateNudge } from "@/components/update";
import { copy } from "@/lib/copy";
import { clearDemo, forgetGroup } from "@/lib/db/commands";
import { ago, money, plural } from "@/lib/format";
import { route } from "@/lib/group-link";
import { iosHomeScreenApp } from "@/lib/install";
import { useResumeLastGroup } from "@/lib/launch";
import { useArrivingGroups, useGroupSummaries, useInviteLink, type GroupSummary } from "@/lib/hooks";

export default function GroupsPage() {
  const router = useRouter();
  const summaries = useGroupSummaries();
  // Keys held whose groups haven't landed yet — the freshly installed icon,
  // which saved its carried invites a moment ago (lib/hooks.ts).
  const arriving = useArrivingGroups();
  // Launching the app reopens the group you were last in (lib/launch.ts), so
  // this screen may be on its way out before it has drawn anything. Until that
  // is settled the list is "not answered yet" — the frame it already draws
  // while Dexie is thinking — rather than a list that flashes and is replaced.
  const resuming = useResumeLastGroup();
  const diagHold = useHold(() => router.push(route.diag()));
  // Nothing in the app archives a group any more, but a production log may
  // already carry an `archivedAt`, and the fold still applies one. This is the
  // only place that decides what it means to a list of "your groups".
  const groups = resuming ? undefined : summaries?.filter((g) => !g.group.archivedAt);

  return (
    <Screen>
      <Body>
        {/* The app says its own name once, on the screen you land on. The
            name is the whole bar: a sub-line under it described the screen you
            could already see. */}
        {/* The name is also the door to /diag, on a long press. Hidden
            rather than listed: a diagnostics screen is for the two minutes
            after something went wrong on a phone with no devtools attached,
            and it has no business in a menu a person reads. */}
        {/* One kebab, not two glyphs: the theme switch and the only door to
            the screen the app spends on itself (app/about) are both words in
            a menu now — a sun and an ⓘ were two guesses. It is the one
            control that belongs to the phone, not to a group (ADR-0007). */}
        <TopBar
          title={
            <span className="brand" {...diagHold}>
              {copy.app.name}
            </span>
          }
          right={<HomeMenu />} />

        <Scroll>
          <div className="homescroll">
            {/* undefined is "Dexie hasn't answered yet", not "no groups" — the
              two used to look the same, and the blank was the one you saw. */}
            {groups === undefined ? <SkeletonRows count={4} /> : null}

            {/* An install offer goes first, and only once there is a group to
              lose: an iOS tab's warning, or Chrome's own install prompt
              (components/install.tsx). One card, one of two bodies. The group
              it names is only which one leads the iOS carry — the top row,
              the most recently active and the one the app would reopen by
              itself (lib/launch.ts). */}
            {groups && groups.length > 0 ? <InstallOfferCard groupId={groups[0]!.group.id} /> : null}

            {/* An empty list is only empty once nothing is on its way: an icon
              added to keep someone's groups must not greet them with "No
              groups yet" while those groups are still coming down. */}
            {groups && groups.length === 0 && arriving !== undefined ? (
              arriving > 0 ? (
                <Empty title={copy.groups.arriving.title}>{copy.groups.arriving.body}</Empty>
              ) : (
                <Empty title={copy.groups.empty.title}>{copy.groups.empty.body}</Empty>
              )
            ) : null}

            <div className="rows">
              {groups?.map((summary) => <GroupRow key={summary.group.id} summary={summary} />)}
            </div>

            {/* The update offer, at the foot: it draws only in the installed
              app, so it never appears alongside the install cards above,
              which draw only outside it. */}
            <UpdateNudge />

            {/* The act this screen exists for, at the bottom of it: under the
              list however short the list is, and where a thumb already rests
              on a phone. It carries the column's `margin-top: auto`, so it
              falls to the foot of the screen however short the list is. */}
            <StartTiles />
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}

/**
 * Starting something: a group, or a bill split with people who are not one.
 * Two different jobs, so two figures rather than one box cut in two — the
 * ledger's two FABs at a size that can carry a word as well as an icon. The
 * ghost row's dashed square is the mark for a slot in the list these left.
 *
 * "New group" is the inked one and takes the right, where a thumb rests; the
 * left is a bill split with people who are not a group, and who never become
 * one: it writes no op and leaves nothing behind
 * ([ADR-0035](../../../docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md)),
 * so it wears the scan FAB's outline instead of the ink. An iOS home-screen
 * app gets a third, outlined too, on the far left: `PasteLinkTile`.
 *
 * Sticky (`.homepair`), not just last-in-flow: a group list long enough to
 * scroll would otherwise carry this off the bottom of the screen, the one
 * thing the two figures the ledger echoes never do. It floats over the rows
 * rather than docking above them — on its own two grounds, as the FABs do.
 */
function StartTiles() {
  return (
    <div className="homepair">
      <div className="starttiles">
        <PasteLinkTile />
        <Link href={route.quick()} className="starttile start-s">
          <Icon name="cam" size={26} />
          {copy.groups.quickSplit}
        </Link>
        <Link href={route.newGroup()} className="starttile start-p">
          <Icon name="plus" size={28} />
          {copy.groups.newGroup}
        </Link>
      </div>
    </div>
  );
}

const never = () => () => {};

/**
 * The way into a group on an iOS home-screen app, which a tapped invite never
 * reaches (`iosHomeScreenApp`). Everywhere else the link itself is the door,
 * so this draws nothing. Outlined, like "Quick split": neither is the primary.
 * What pasting does is `usePasteLink`'s.
 */
function PasteLinkTile() {
  // Standalone or not is fixed for the life of the page; nothing to subscribe to.
  const shown = useSyncExternalStore(never, iosHomeScreenApp, () => false);
  const { paste, dialog } = usePasteLink();
  if (!shown) return null;

  return (
    <>
      <button type="button" onClick={() => void paste()} className="starttile start-s">
        <Icon name="link" size={26} />
        {copy.groups.pasteLink}
      </button>
      {dialog}
    </>
  );
}

function GroupRow({ summary }: { summary: GroupSummary }) {
  const { group, memberCount, entryCount, netMinor, lastActivity } = summary;
  const [asking, setAsking] = useState(false);
  const invite = useInviteLink(group.id);
  // The demo sits on this list like any other group once it has been opened —
  // it *is* one. Only the two things it cannot do differ: it has no invite
  // link to copy, and forgetting it would hide a group with no link to bring
  // it back, so the same row clears it instead (lib/db/commands/demo.ts).
  const demo = isDemo(group.id);
  const [noLink, setNoLink] = useState(false);

  const { hold, menu } = useLongPressMenu([
    ...(demo
      ? [{ label: copy.group.copyLink, icon: "link" as const, onSelect: () => setNoLink(true) }]
      : invite.copy
        ? [{ label: copy.group.copyLink, icon: "link" as const, onSelect: invite.copy }]
        : []),
    // Not gated on a claim: a group this phone never said who it was in is
    // the one it most wants off the list, and forgetting is local only
    // (`forgetGroup`).
    { label: demo ? copy.demo.clear : copy.members.forget, icon: "trash", danger: true,
      onSelect: () => setAsking(true) },
  ]);

  async function forget() {
    if (demo) await clearDemo();
    else await forgetGroup(group.id);
  }

  return (
    <>
      <Link href={route.group(group.id)} className="row grouprow" {...hold}>
        <Avatar name={group.name} />
        <div className="rmain">
          <div className="rtitle">{group.name}</div>
          <div className="rmeta">
            {plural(memberCount, copy.noun.person)} · {plural(entryCount, copy.noun.entry)} · {ago(lastActivity)}
          </div>
        </div>
        <div className="ramt">
          {netMinor === undefined ? (
            <>
              <div className="big" style={{ color: "var(--muted)" }}>{copy.none}</div>
              <div className="sm">{copy.groups.whoAreYou}</div>
            </>
          ) : (
            <>
              <div className={`big ${signClass(netMinor)}`}
                style={netMinor === 0 ? { color: "var(--muted)" } : undefined}>
                {money(netMinor, group.baseCurrency, netMinor !== 0)}
              </div>
              <div className="sm">
                {netMinor < 0 ? copy.groups.youOwe
                  : netMinor > 0 ? copy.groups.youreOwed : copy.groups.settled}
              </div>
            </>
          )}
        </div>
      </Link>

      {menu}

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
