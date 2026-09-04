"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar, GhostRow, signClass } from "../components/bits";
import { Body, Empty, Screen, Scroll, SkeletonRows, TopBar } from "../components/chrome";
import { ConfirmDialog } from "../components/dialog";
import { Wordmark } from "../components/icons";
import { InstallNudge } from "../components/install";
import { useLongPressMenu } from "../components/long-press";
import { ThemeToggle } from "../components/theme-toggle";
import { copy } from "../lib/copy";
import { forgetGroup } from "../lib/db/commands";
import { ago, money, plural } from "../lib/format";
import { route } from "../lib/group-link";
import { useDevice, useGroupSummaries, type GroupSummary } from "../lib/hooks";

export default function GroupsPage() {
  const summaries = useGroupSummaries();
  // Archiving is explicit and unreachable from the UI today — nothing sets
  // it on the path that used to (leaving no longer does) — but the filter
  // stays cheap insurance against a group with no reason to show up here.
  const groups = summaries?.filter((g) => !g.group.archivedAt);

  return (
    <Screen>
      <Body>
        {/* The app says its own name once, on the screen you land on — and
            carries the one switch that belongs to the phone rather than to any
            group (ADR-0007). The name is the whole bar: a sub-line under it
            described the screen you could already see. */}
        <TopBar title={<span className="brand"><Wordmark size={26} /> {copy.app.name}</span>}
          right={<ThemeToggle />} />

        <Scroll>
          {/* undefined is "Dexie hasn't answered yet", not "no groups" — the
              two used to look the same, and the blank was the one you saw. */}
          {groups === undefined ? <SkeletonRows count={4} /> : null}

          {groups && groups.length === 0 ? (
            <Empty title={copy.groups.empty.title}>{copy.groups.empty.body}</Empty>
          ) : null}

          <div className="rows">
            {groups?.map((summary) => <GroupRow key={summary.group.id} summary={summary} />)}

            <GhostRow icon="plus" label={copy.groups.newGroup} href={route.newGroup()} />
          </div>

          {/* Once there is something to come back to, and never before it. */}
          {groups && groups.length > 0 ? <InstallNudge /> : null}
        </Scroll>

        <LastUpdate />
      </Body>
    </Screen>
  );
}

/**
 * One row of "your groups" — and, on a long press or a right click, the one
 * action forgetting belongs to. Mirrors the gate on the Members screen's own
 * "Forget group" row: offered once this device has claimed a member here,
 * though `forgetGroup` itself doesn't need one.
 */
function GroupRow({ summary }: { summary: GroupSummary }) {
  const { group, memberCount, entryCount, netMinor, lastActivity, me } = summary;
  const [asking, setAsking] = useState(false);

  const { onContextMenu, menu } = useLongPressMenu(me === undefined ? [] : [
    { label: copy.members.forget, icon: "trash", onSelect: () => setAsking(true) },
  ]);

  async function forget() {
    await forgetGroup(group.id);
  }

  return (
    <>
      <Link href={route.group(group.id)} className="row" onContextMenu={onContextMenu}>
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

      {asking ? (
        <ConfirmDialog title={copy.members.forget} confirm={copy.members.forget}
          onConfirm={forget} onClose={() => setAsking(false)}>
          <p>{copy.members.forgetBody}</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

/**
 * What the app itself last gained, along the bottom edge of the screen you land
 * on — the one place the app is allowed to talk about itself (ADR-0007). It is
 * there so an app with no version number, no store listing and no release notes
 * can still show it is alive, and it sits under the scroller rather than after
 * the last group so that a long list doesn't bury it.
 *
 * The date is this phone's, not the deploy's: `lib/app-version.ts` records the
 * moment a new build actually replaced the cached one here, which on a phone
 * can be days after it shipped. `copy.release.what` — baked into that same
 * build — says what came with it.
 */
function LastUpdate() {
  // `undefined` until Dexie answers, and on any launch that has never had a
  // worker take over: no honest date to show, so no line. It also keeps `ago`,
  // which reads the clock, out of the static export's prerendered HTML, where
  // the build's "just now" against the browser's "3d ago" is a hydration
  // mismatch.
  const updatedAt = useDevice()?.appUpdatedAt;
  if (updatedAt === undefined) return null;

  return <p className="lastup">{copy.release.updated(ago(updatedAt), copy.release.what)}</p>;
}
