"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { activityFeed, entityHistory, type Revision } from "@bida/core";
import { BadLink, Blank, Body, Empty, Foot, QueryBoundary, Screen, Scroll, TopBar } from "@/components/chrome";
import { Icon } from "@/components/icons";
import { db } from "@/lib/db/dexie";
import { useLive } from "@/lib/db/live";
import { opsForGroup } from "@/lib/db/fold";
import { copy } from "@/lib/copy";
import { plural, stamp } from "@/lib/format";
import { describe } from "@/lib/history-copy";
import { historyParent, parseEntrySource, route } from "@/lib/group-link";
import { useClaimGate, useGroupData } from "@/lib/hooks";

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
  // An entry's own history is below the entry, so it carries the entry's own
  // `via` back up with it (lib/group-link.ts).
  const via = parseEntrySource(params.get("via"));
  const data = useGroupData(groupId);
  const unclaimed = useClaimGate(groupId, data);
  const [shown, setShown] = useState(PAGE);

  // History needs every member's name, including people who've since been
  // removed — the alive-only map from useGroupData would erase them from
  // their own past.
  const allMembers = useLive(
    "historyMembers",
    async () => (groupId ? db().members.where("groupId").equals(groupId).toArray() : []),
    [groupId],
  ) ?? [];
  const memberById = new Map(allMembers.map((m) => [m.id, m]));

  const ops = useLive("historyOps", async () => (groupId ? opsForGroup(groupId) : []), [groupId]) ?? [];

  // Every expense ever, deleted ones included: a deleted expense is half the
  // reason to open history.
  const allExpenses = useLive(
    "historyExpenses",
    async () => (groupId ? db().expenses.where("groupId").equals(groupId).toArray() : []),
    [groupId],
  ) ?? [];
  const expenseById = new Map(allExpenses.map((e) => [e.id, e]));

  const allSettlements = useLive(
    "historySettlements",
    async () => (groupId ? db().settlements.where("groupId").equals(groupId).toArray() : []),
    [groupId],
  ) ?? [];
  const settlementById = new Map(allSettlements.map((s) => [s.id, s]));

  // One id, both tables (ADR-0010). **Looked up in the maps that keep the
  // deleted ones** — the alive-only lists would title every deleted entry
  // "Transfer", the fallback branch.
  const subject = entryId
    ? expenseById.get(entryId) ?? settlementById.get(entryId)
    : undefined;
  // A deleted entry's back skips its "gone" screen for whoever linked to it —
  // the feed, when it was the feed's deleted-entry link that brought us here.
  const back = !groupId ? "/" : entryId
    ? historyParent(groupId, entryId, via, !!subject?.deletedAt)
    : route.group(groupId);
  const subjectName = !subject ? undefined
    : "description" in subject
      ? (subject.description?.trim() || copy.history.untitled) : copy.group.transfer;
  // **Rendering is paged, never the list**: slicing it would make the count
  // report the slice size as the group's revision total.
  const revisions = !groupId ? [] : entryId ? entityHistory(ops, entryId) : activityFeed(ops);
  const visible = revisions.slice(0, shown);
  const rest = revisions.length - visible.length;

  if (!groupId) return <BadLink />;
  if (data.loading || unclaimed) {
    return <Blank back={back} />;
  }
  if (!data.group) return <BadLink />;
  const group = data.group;
  const currency = group.baseCurrency;

  /**
   * Where a revision in the group feed leads — entries only, since "you changed
   * the amount" needs to say of what. A deleted entry points at its own
   * history.
   */
  function subjectOf(rev: Revision): { href: string; label: string } | undefined {
    if (!groupId) return undefined;
    if (rev.entity === "expense") {
      const e = expenseById.get(rev.entityId);
      const label = e?.description?.trim() || copy.history.untitled;
      return e?.deletedAt
        ? { href: route.history(groupId, rev.entityId, "history"), label: copy.history.deleted(label) }
        : { href: route.entry(groupId, rev.entityId, "history"), label };
    }
    if (rev.entity === "settlement") {
      const s = settlementById.get(rev.entityId);
      const from = memberById.get(s?.fromMember ?? "")?.name ?? copy.unknown;
      const to = memberById.get(s?.toMember ?? "")?.name ?? copy.unknown;
      const label = `${from} → ${to}`;
      return s?.deletedAt
        ? { href: route.history(groupId, rev.entityId, "history"), label: copy.history.deleted(label) }
        : { href: route.entry(groupId, rev.entityId, "history"), label };
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
          back={back}
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
                      {d.also?.length ? (
                        <div className="also">
                          {d.also.map((a) => (
                            <div key={a.label} className="alsoi">
                              <span className="lbl">{a.label}</span>
                              {a.was !== undefined ? <span className="was">{a.was}</span> : null}
                              {a.now !== undefined ? <span className="now2">{a.now}</span> : null}
                            </div>
                          ))}
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
