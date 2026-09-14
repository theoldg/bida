"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar, signClass } from "../components/bits";
import { Icon } from "../components/icons";
import { Body, Empty, Screen, Scroll, SkeletonRows, TopBar } from "../components/chrome";
import { ConfirmDialog } from "../components/dialog";
import { Wordmark } from "../components/icons";
import { InstallNudge } from "../components/install";
import { InviteFallback } from "../components/invite";
import { useLongPressMenu } from "../components/long-press";
import { ThemeToggle } from "../components/theme-toggle";
import { UpdateNudge } from "../components/update";
import { copy } from "../lib/copy";
import { forgetGroup } from "../lib/db/commands";
import { ago, money, plural } from "../lib/format";
import { route } from "../lib/group-link";
import { useResumeLastGroup } from "../lib/launch";
import { useGroupSummaries, useInviteLink, type GroupSummary } from "../lib/hooks";

export default function GroupsPage() {
  const router = useRouter();
  const summaries = useGroupSummaries();
  // Launching the app reopens the group you were last in (lib/launch.ts), so
  // this screen may be on its way out before it has drawn anything. Until that
  // is settled the list is "not answered yet" — the frame it already draws
  // while Dexie is thinking — rather than a list that flashes and is replaced.
  const resuming = useResumeLastGroup();
  // Nothing in the app archives a group any more, but a production log may
  // already carry an `archivedAt`, and the fold still applies one. This is the
  // only place that decides what it means to a list of "your groups".
  const groups = resuming ? undefined : summaries?.filter((g) => !g.group.archivedAt);

  return (
    <Screen>
      <Body>
        {/* The app says its own name once, on the screen you land on — and
            carries the one switch that belongs to the phone rather than to any
            group (ADR-0007). The name is the whole bar: a sub-line under it
            described the screen you could already see. */}
        {/* The wordmark is also the door to /diag, on a long press. Hidden
            rather than listed: a diagnostics screen is for the two minutes
            after something went wrong on a phone with no devtools attached,
            and it has no business in a menu a person reads. */}
        <TopBar
          title={
            <span className="brand" onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); router.push(route.diag()); }}>
              <Wordmark size={38} /> {copy.app.name}
            </span>
          }
          right={<ThemeToggle />} />

        <Scroll>
         <div className="homescroll">
          {/* undefined is "Dexie hasn't answered yet", not "no groups" — the
              two used to look the same, and the blank was the one you saw. */}
          {groups === undefined ? <SkeletonRows count={4} /> : null}

          {groups && groups.length === 0 ? (
            <Empty title={copy.groups.empty.title}>{copy.groups.empty.body}</Empty>
          ) : null}

          <div className="rows">
            {groups?.map((summary) => <GroupRow key={summary.group.id} summary={summary} />)}
          </div>

          {/* The two cards the app spends on itself, and they are mutually
              exclusive by construction: the update offer draws only in the
              installed app, the install offer only outside it. At most one of
              them is ever under the list. */}
          <UpdateNudge />

          {/* Once there is something to come back to, and never before it. */}
          {groups && groups.length > 0 ? <InstallNudge /> : null}

          {/* The act this screen exists for, at the bottom of it: under the
              list however short the list is, and where a thumb already rests
              on a phone. It carries the column's `margin-top: auto`, so it and
              the about line under it are one block at the foot of the screen. */}
          <StartPair />

          {/* The only door to the screen the app spends on itself: what this
              is, what the server can see, and where to complain (app/about). */}
          <Link href={route.about()} className="homeabout">
            <Icon name="info" size={14} />{copy.groups.about}
          </Link>
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
 * so it wears the scan FAB's outline instead of the ink.
 */
function StartPair() {
  return (
    <div className="homepair">
      <div className="starttiles">
        <Link href={route.quick()} className="starttile start-s">
          <Icon name="cam" size={19} />
          {copy.groups.quickSplit}
        </Link>
        <Link href={route.newGroup()} className="starttile start-p">
          <Icon name="plus" size={20} />
          {copy.groups.newGroup}
        </Link>
      </div>
    </div>
  );
}

function GroupRow({ summary }: { summary: GroupSummary }) {
  const { group, memberCount, entryCount, netMinor, lastActivity, me } = summary;
  const [asking, setAsking] = useState(false);
  const invite = useInviteLink(group.id);

  const { onContextMenu, menu } = useLongPressMenu([
    ...(invite.copy
      ? [{ label: copy.group.copyLink, icon: "link" as const, onSelect: invite.copy }]
      : []),
    ...(me === undefined
      ? []
      : [{ label: copy.members.forget, icon: "trash" as const, onSelect: () => setAsking(true) }]),
  ]);

  async function forget() {
    await forgetGroup(group.id);
  }

  return (
    <>
      <Link href={route.group(group.id)} className="row grouprow" onContextMenu={onContextMenu}>
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

      {asking ? (
        <ConfirmDialog title={copy.members.forget} confirm={copy.members.forget}
          onConfirm={forget} onClose={() => setAsking(false)}>
          <p>{copy.members.forgetBody}</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
