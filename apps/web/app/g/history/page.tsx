"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { activityFeed, entityHistory, type Revision } from "@hajsik/core";
import { Blank, Body, Empty, Foot, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { Icon } from "../../../components/icons";
import { db } from "../../../lib/db/dexie";
import { opsForGroup } from "../../../lib/db/fold";
import { plural, stamp } from "../../../lib/format";
import { describe } from "../../../lib/history-copy";
import { route } from "../../../lib/group-link";
import { useGroupData } from "../../../lib/hooks";

export default function HistoryPage() {
  return <QueryBoundary><HistoryScreen /></QueryBoundary>;
}

function HistoryScreen() {
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const entryId = params.get("e") ?? undefined;
  const data = useGroupData(groupId);

  // History needs every member's name, including people who've since been
  // removed — the alive-only map from useGroupData would erase them from
  // their own past.
  const allMembers = useLiveQuery(
    async () => (groupId ? db().members.where("groupId").equals(groupId).toArray() : []),
    [groupId],
  ) ?? [];
  const memberById = new Map(allMembers.map((m) => [m.id, m]));

  const ops = useLiveQuery(async () => (groupId ? opsForGroup(groupId) : []), [groupId]) ?? [];

  // Every expense the group has ever had, deleted ones included: the feed links
  // to what a revision was about, and half the reason to open history is an
  // expense that isn't there any more.
  const allExpenses = useLiveQuery(
    async () => (groupId ? db().expenses.where("groupId").equals(groupId).toArray() : []),
    [groupId],
  ) ?? [];
  const expenseById = new Map(allExpenses.map((e) => [e.id, e]));

  const allSettlements = useLiveQuery(
    async () => (groupId ? db().settlements.where("groupId").equals(groupId).toArray() : []),
    [groupId],
  ) ?? [];
  const settlementById = new Map(allSettlements.map((s) => [s.id, s]));

    // One id parameter, both tables: history is per-entry, and a transfer has
  // as much of it as an expense does (ADR-0028).
  const subject = entryId
    ? data.expenses.find((e) => e.id === entryId) ?? data.settlements.find((s) => s.id === entryId)
    : undefined;
  const subjectName = !entryId ? undefined
    : subject && "description" in subject ? (subject.description || "Untitled") : "Transfer";
  const revisions = !groupId ? [] : entryId ? entityHistory(ops, entryId) : activityFeed(ops, 200);

  if (!groupId || !data.group) return <Blank />;
  const group = data.group;
  const currency = group.baseCurrency;

  /**
   * Where a revision in the whole-group feed leads. Entries only — they are
   * the only thing with a screen of their own, and "You changed the amount" is
   * not much use in a group feed without saying of what.
   *
   * A deleted entry has no detail screen, so it points at its own history,
   * which is where you would be going next anyway.
   */
  function subjectOf(rev: Revision): { href: string; label: string } | undefined {
    if (!groupId) return undefined;
    if (rev.entity === "expense") {
      const e = expenseById.get(rev.entityId);
      const label = e?.description?.trim() || "Untitled entry";
      return e?.deletedAt
        ? { href: route.history(groupId, rev.entityId), label: `${label} · deleted` }
        : { href: route.entry(groupId, rev.entityId), label };
    }
    if (rev.entity === "settlement") {
      const s = settlementById.get(rev.entityId);
      const from = memberById.get(s?.fromMember ?? "")?.name ?? "?";
      const to = memberById.get(s?.toMember ?? "")?.name ?? "?";
      const label = `${from} → ${to}`;
      return s?.deletedAt
        ? { href: route.history(groupId, rev.entityId), label: `${label} · deleted` }
        : { href: route.entry(groupId, rev.entityId), label };
    }
    return undefined;
  }

  return (
    <Screen>
      <Body>
        <TopBar
          title="History"
          sub={entryId
            ? `${subjectName ?? "Entry"} · ${plural(revisions.length, "revision")}`
            : `${group.name} · ${plural(revisions.length, "revision")}`}
          back={entryId ? route.entry(groupId, entryId) : route.group(groupId)}
        />

        <Scroll>
          <div className="pad">
            {revisions.length === 0 ? (
              <Empty title="Nothing here yet" />
            ) : (
              <div className="tl">
                {revisions.map((rev, i) => {
                  const who = memberById.get(rev.op.actor)?.name ?? "Someone";
                  const d = describe(rev, who, memberById, currency);
                  const subject = entryId ? undefined : subjectOf(rev);
                  return (
                    <div key={rev.op.id} className={`tle${i === 0 ? " now" : ""}`}>
                      <div className="when">{stamp(rev.op.createdAt)} · {who.toUpperCase()}</div>
                      <div className="what">{d.what}</div>
                      {d.diff ? (
                        <div className="diff">
                          {d.diff.was !== undefined ? <span className="was">{d.diff.was}</span> : null}
                          <span className="now2">{d.diff.now}</span>
                        </div>
                      ) : null}
                      {rev.op.note ? <div className="note">&ldquo;{rev.op.note}&rdquo;</div> : null}
                      {subject ? (
                        <Link className="tlink" href={subject.href}>
                          <span>{subject.label}</span><Icon name="chev" size={13} />
                        </Link>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Scroll>
      </Body>

      {entryId ? (
        <Foot>
          <Link href={route.history(groupId)} className="btn btn-s">
            <Icon name="clock" size={15} /> See the whole group&rsquo;s history
          </Link>
        </Foot>
      ) : null}
    </Screen>
  );
}
