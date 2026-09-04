"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { activityFeed, entityHistory, type Revision } from "@hajsik/core";
import { BadLink, Blank, Body, Empty, Foot, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { Icon } from "../../../components/icons";
import { db } from "../../../lib/db/dexie";
import { opsForGroup } from "../../../lib/db/fold";
import { copy } from "../../../lib/copy";
import { plural, stamp } from "../../../lib/format";
import { describe } from "../../../lib/history-copy";
import { route } from "../../../lib/group-link";
import { useGroupData } from "../../../lib/hooks";

/** How much of a long feed is drawn before asking. The rest comes in one tap,
 *  which is why the button can say exactly how many it is. */
const PAGE = 200;

export default function HistoryPage() {
  return <QueryBoundary><HistoryScreen /></QueryBoundary>;
}

function HistoryScreen() {
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const entryId = params.get("e") ?? undefined;
  const data = useGroupData(groupId);
  const [shown, setShown] = useState(PAGE);

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
  // as much of it as an expense does (ADR-0010).
  const subject = entryId
    ? data.expenses.find((e) => e.id === entryId) ?? data.settlements.find((s) => s.id === entryId)
    : undefined;
  const subjectName = !entryId ? undefined
    : subject && "description" in subject
      ? (subject.description || copy.group.untitled) : copy.group.transfer;
  // The feed is whole, and the page grows into it. It used to be sliced to 200
  // and then counted *after* the slice, so a group with more history than that
  // was told it had exactly 200 revisions — the one number on this screen, and
  // wrong. Rendering is what's paged now; the count is the real one.
  const revisions = !groupId ? [] : entryId ? entityHistory(ops, entryId) : activityFeed(ops);
  const visible = revisions.slice(0, shown);
  const rest = revisions.length - visible.length;

  if (!groupId) return <BadLink />;
  if (data.loading) {
    return <Blank back={entryId ? route.entry(groupId, entryId) : route.group(groupId)} />;
  }
  if (!data.group) return <BadLink />;
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
      const label = e?.description?.trim() || copy.history.untitled;
      return e?.deletedAt
        ? { href: route.history(groupId, rev.entityId), label: copy.history.deleted(label) }
        : { href: route.entry(groupId, rev.entityId), label };
    }
    if (rev.entity === "settlement") {
      const s = settlementById.get(rev.entityId);
      const from = memberById.get(s?.fromMember ?? "")?.name ?? copy.unknown;
      const to = memberById.get(s?.toMember ?? "")?.name ?? copy.unknown;
      const label = `${from} → ${to}`;
      return s?.deletedAt
        ? { href: route.history(groupId, rev.entityId), label: copy.history.deleted(label) }
        : { href: route.entry(groupId, rev.entityId), label };
    }
    return undefined;
  }

  return (
    <Screen>
      <Body>
        <TopBar
          title={copy.history.title}
          sub={copy.history.subject(
            entryId ? subjectName ?? copy.history.entry : group.name,
            plural(revisions.length, copy.noun.revision))}
          back={entryId ? route.entry(groupId, entryId) : route.group(groupId)}
        />

        <Scroll>
          <div className="pad">
            {revisions.length === 0 ? (
              <Empty title={copy.history.empty} />
            ) : (
              <div className="tl">
                {visible.map((rev, i) => {
                  const who = memberById.get(rev.op.actor)?.name ?? copy.someone;
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

            {rest > 0 ? (
              <button className="btn btn-s" style={{ marginTop: 12 }}
                onClick={() => setShown(revisions.length)}>
                {copy.history.more(plural(rest, copy.noun.revision))}
              </button>
            ) : null}
          </div>
        </Scroll>
      </Body>

      {entryId ? (
        <Foot>
          <Link href={route.history(groupId)} className="btn btn-s">
            <Icon name="clock" size={15} /> {copy.history.wholeGroup}
          </Link>
        </Foot>
      ) : null}
    </Screen>
  );
}
