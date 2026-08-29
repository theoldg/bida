"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { activityFeed, entityHistory, type Revision } from "@hajsik/core";
import { Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
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
  const expenseId = params.get("e") ?? undefined;
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

  const expense = expenseId ? data.expenses.find((e) => e.id === expenseId) : undefined;
  const revisions = !groupId ? [] : expenseId ? entityHistory(ops, expenseId) : activityFeed(ops, 200);

  // An entity's newest revision IS its current state, so there is nothing to
  // put back — offering a rewind there is a dead end. Both feeds are
  // newest-first, so the first revision seen for an entity is its latest.
  const latestOf = new Map<string, string>();
  for (const rev of revisions) {
    if (!latestOf.has(rev.entityId)) latestOf.set(rev.entityId, rev.op.id);
  }

  if (!groupId || !data.group) return <Screen><Body><TopBar title=" " back={true} /></Body></Screen>;
  const group = data.group;
  const currency = group.baseCurrency;

  /**
   * Where a revision in the whole-group feed leads. Expenses only — they are
   * the only thing with a screen of their own, and "You changed the amount" is
   * not much use in a group feed without saying of what.
   *
   * A deleted expense has no detail screen, so it points at its own history,
   * which is where you would be going next anyway.
   */
  function subjectOf(rev: Revision): { href: string; label: string } | undefined {
    if (!groupId || rev.entity !== "expense") return undefined;
    const e = expenseById.get(rev.entityId);
    const label = e?.description?.trim() || "Untitled expense";
    return e?.deletedAt
      ? { href: route.history(groupId, rev.entityId), label: `${label} · deleted` }
      : { href: route.expense(groupId, rev.entityId), label };
  }

  return (
    <Screen>
      <Body>
        <TopBar
          title="History"
          sub={expenseId
            ? `${expense?.description || "Expense"} · ${plural(revisions.length, "revision")}`
            : `${group.name} · ${plural(revisions.length, "revision")}`}
          back={expenseId ? route.expense(groupId, expenseId) : route.group(groupId)}
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
                  // Restoring an identity claim would mean telling somebody
                  // else's phone who it is. There is nothing to restore.
                  const canRestore = rev.entity !== "group" && rev.entity !== "identity"
                    && latestOf.get(rev.entityId) !== rev.op.id;
                  const subject = expenseId ? undefined : subjectOf(rev);
                  return (
                    <div key={rev.op.id} className={`tle${i === 0 ? " now" : ""}`}>
                      {canRestore ? (
                        <Link className="tlrewind" aria-label="Restore this version"
                          href={route.restore(groupId, rev.entity, rev.entityId, rev.op.hlc)}>
                          <Icon name="rewind" size={15} />
                        </Link>
                      ) : null}
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

      {expenseId ? (
        <div className="pad" style={{ borderTop: "1px solid var(--rule)", flex: "none", padding: "11px 16px" }}>
          <Link href={route.history(groupId)} className="btn btn-s">
            <Icon name="clock" size={15} /> See the whole group&rsquo;s history
          </Link>
        </div>
      ) : null}
    </Screen>
  );
}
