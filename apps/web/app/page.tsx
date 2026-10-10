"use client";

import { isDemo } from "@bida/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";
import { Avatar, signClass } from "@/components/bits";
import { FitLine } from "@/components/fit-line";
import { Icon } from "@/components/icons";
import { Empty, LedgerSkeleton, SkeletonRows } from "@/components/chrome";
import { HomeFrame } from "@/components/home-frame";
import { InstallOfferCard, SkeletonBanner } from "@/components/install";
import { useGroupActions } from "@/components/group-actions";
import { LedgerRows } from "@/components/ledger-rows";
import { useHold, useLongPressMenu } from "@/components/long-press";
import { UpdateNudge } from "@/components/update";
import { copy } from "@/lib/copy";
import { ago, money, plural } from "@/lib/format";
import { route } from "@/lib/group-link";
import { groupMeta } from "@/lib/row-meta";
import { JoiningFrame } from "@/components/joining";
import { useResumeLastGroup } from "@/lib/launch";
import { useArrivingGroups, useGroupSummaries, type GroupSummary } from "@/lib/hooks";

export default function GroupsPage() {
  const router = useRouter();
  const summaries = useGroupSummaries();
  // Keys held whose groups haven't landed yet: a freshly installed icon's.
  const arriving = useArrivingGroups();
  // Until a launch decides whether to reopen the last group, the list stays unanswered.
  const { deciding: resuming, joining } = useResumeLastGroup();
  const hydrating = useSyncExternalStore(never, () => false, () => true);
  const marked = useSyncExternalStore(never, resumingMarked, () => true);
  const diagHold = useHold(() => router.push(route.diag()));
  // Nothing archives a group any more, but a production log may carry an
  // `archivedAt`. Memoised: the list below takes a new array as a change.
  const groups = useMemo(() => resuming ? undefined : summaries?.filter((g) => !g.group.archivedAt),
    [resuming, summaries]);
  // The first an icon would actually carry: the demo has no key.
  const lead = groups?.find((g) => !isDemo(g.group.id));
  const rows = useMemo(() => (groups ?? []).map((summary) =>
    ({ key: summary.group.id, kind: "row" as const, row: summary })), [groups]);

  // `/join` is only passing through this list.
  if (joining) return <JoiningFrame />;

  return (
    <>
    {/* Both frames are drawn and globals.css picks, because the mark is set
        before React runs and the prerender can't know it (lib/resume-hint.ts). */}
    {hydrating || (resuming && marked) ? <LedgerSkeleton className="resumeframe" head={<SkeletonBanner />} /> : null}
    <HomeFrame brand={diagHold}>
      {/* undefined is "Dexie hasn't answered yet", not "no groups". */}
      {groups === undefined ? <SkeletonRows count={4} /> : null}

      {/* Only once there is a group to lose. */}
      {lead ? <InstallOfferCard groupId={lead.group.id} /> : null}

      {groups && groups.length === 0 && arriving !== undefined ? (
        arriving > 0 ? (
          <Empty title={copy.groups.arriving.title}>{copy.groups.arriving.body}</Empty>
        ) : (
          <Empty title={copy.groups.empty.title}>{copy.groups.empty.body}</Empty>
        )
      ) : null}

      <LedgerRows opens={false} items={rows} row={(summary: GroupSummary) => <GroupRow summary={summary} />} />

      <UpdateNudge />
    </HomeFrame>
    </>
  );
}

const never = () => () => {};
const resumingMarked = () => document.documentElement.hasAttribute("data-resuming");

function GroupRow({ summary }: { summary: GroupSummary }) {
  const { group, memberCount, entryCount, netMinor, lastActivity, newCount } = summary;
  const actions = useGroupActions(group.id);
  const { hold, menu } = useLongPressMenu([...actions.copyLink, actions.forget], actions.asking);

  return (
    <>
      <Link href={route.group(group.id)} className="row grouprow" {...hold}>
        <Avatar name={group.name} />
        <div className="rmain">
          <div className="rtitle">{group.name}</div>
          {/* The new count leads, where neither the ladder nor the ellipsis reaches it. */}
          <FitLine className="rmeta" leadClassName="rnew"
            lead={newCount > 0 ? plural(newCount, copy.noun.newChange) : undefined}
            options={groupMeta({ people: memberCount, entries: entryCount, when: ago(lastActivity) })} />
        </div>
        {/* The menu has closed and the clipboard says nothing, so the copy answers here. */}
        <div className={`ramt${actions.copied ? " copied" : ""}`}>
          <div className="amtface">
            {netMinor === undefined ? (
              <>
                <div className="big muted">{copy.none}</div>
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
          {/* Always drawn: the flip back is a transition on a class going away. */}
          <div className="copiedface" aria-hidden={!actions.copied}>
            <Icon name="check" size={18} />
            <div className="sm">{copy.groups.copied}</div>
          </div>
        </div>
      </Link>

      {menu}
      {actions.dialogs}
    </>
  );
}
