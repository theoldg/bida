"use client";

import { isDemo } from "@bida/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Avatar, signClass } from "@/components/bits";
import { FitLine } from "@/components/fit-line";
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
import { groupMeta } from "@/lib/row-meta";
import { iosHomeScreenApp } from "@/lib/install";
import { JoiningFrame } from "@/components/joining";
import { useResumeLastGroup } from "@/lib/launch";
import { useArrivingGroups, useGroupSummaries, useHost, useInviteLink, type GroupSummary } from "@/lib/hooks";

export default function GroupsPage() {
  const router = useRouter();
  const summaries = useGroupSummaries();
  // Keys held whose groups haven't landed yet — the freshly installed icon,
  // which saved its carried invites a moment ago (lib/hooks.ts).
  const arriving = useArrivingGroups();
  // A launch may reopen the last group (lib/launch.ts), so until that settles
  // the list stays "not answered yet" rather than flashing and being replaced.
  const { deciding: resuming, joining } = useResumeLastGroup();
  const diagHold = useHold(() => router.push(route.diag()));
  // Nothing in the app archives a group any more, but a production log may
  // already carry an `archivedAt`, and the fold still applies one. This is the
  // only place that decides what it means to a list of "your groups".
  const groups = resuming ? undefined : summaries?.filter((g) => !g.group.archivedAt);
  // Which group the install offer draws for, and whether it draws at all: the
  // first that an icon would actually carry, so the demo is passed over.
  const lead = groups?.find((g) => !isDemo(g.group.id));

  // Handed a group by `/join`, which this list is only passing through: its
  // frame, not four skeletons, until the push lands (components/joining.tsx).
  if (joining) return <JoiningFrame />;

  return (
    <Screen>
      <Body>
        {/* The app says its own name once, on the screen you land on. The
            name is the whole bar: a sub-line under it described the screen you
            could already see. */}
        {/* The name is also the door to /diag, on a long press — for a phone with
            no devtools, kept out of any menu a person reads. */}
        {/* One kebab holds the theme switch and the door to app/about — the one
            control that belongs to the phone, not a group (ADR-0007). */}
        <TopBar
          title={
            <span className="brand" {...diagHold}>
              {copy.app.name}
            </span>
          }
          right={<HomeMenu />} />

        <Scroll>
          <div className="homescroll">
            {/* undefined is "Dexie hasn't answered yet", not "no groups". */}
            {groups === undefined ? <SkeletonRows count={4} /> : null}

            {/* An install offer goes first, once there is a group to lose: an iOS
              tab's warning or Chrome's prompt (components/install.tsx), and in the
              installed app the notifications offer in its place. The group it
              names leads the iOS carry — the top row, which the app would reopen
              (lib/launch.ts).

              The demo doesn't count: it has no key, so no icon would carry it, and
              `/demo` lays it down again anyway (docs/sync.md#the-demo-group-has-no-key). */}
            {lead ? <InstallOfferCard groupId={lead.group.id} /> : null}

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
              which draw only outside it — the notifications card is the one
              it can share the screen with. */}
            <UpdateNudge />

            {/* The act this screen exists for, under the list where a thumb rests; its
              `margin-top: auto` drops it to the foot however short the list is. */}
            <StartTiles />
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}

/**
 * Starting something: a group, or a bill split with people who are not one.
 * Two jobs, two figures. "New group" is inked and on the right, under the
 * thumb. "Quick split" writes nothing
 * ([ADR-0035](../../../docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md))
 * so it is outlined. An iOS home-screen app gets a third, `PasteLinkTile`.
 *
 * **Sticky (`.homepair`)**, or a long list scrolls it off the bottom.
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
 * reaches (`iosHomeScreenApp`); elsewhere it draws nothing. Outlined: not the
 * primary. Pasting is `usePasteLink`'s.
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
  const { group, memberCount, entryCount, netMinor, lastActivity, newCount } = summary;
  const [asking, setAsking] = useState(false);
  const invite = useInviteLink(group.id);
  // The demo is a group like any other here, except it has no invite link, and
  // forgetting would hide it with no way back — so the same row clears it
  // (lib/db/commands/demo.ts).
  const demo = isDemo(group.id);
  const [noLink, setNoLink] = useState(false);
  // As in the group's own menu: the fresh demo's address is the browser's to
  // know, not the build's (`useHost`).
  const host = useHost();

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
          {/* The new count leads, where neither the ladder nor the ellipsis
              reaches it. The ledger's line says the same count, and opening
              the group is what clears both. */}
          <FitLine className="rmeta" leadClassName="rnew"
            lead={newCount > 0 ? plural(newCount, copy.noun.newChange) : undefined}
            options={groupMeta({ people: memberCount, entries: entryCount, when: ago(lastActivity) })} />
        </div>
        {/* Copying the row's link answers here: the figure flips to a check while
            `invite.copied` holds. The menu has closed and the clipboard says
            nothing, so without this a long press ends in silence. */}
        <div className={`ramt${invite.copied ? " copied" : ""}`}>
          <div className="amtface">
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
          {/* Always drawn, because the flip back is a transition on a class
              going away — and hidden from a reader until it means something. */}
          <div className="copiedface" aria-hidden={!invite.copied}>
            <Icon name="check" size={18} />
            <div className="sm">{copy.groups.copied}</div>
          </div>
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
          <p>{demo ? copy.demo.clearBody(`${host}${route.demo()}`) : copy.members.forgetBody}</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
