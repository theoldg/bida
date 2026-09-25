"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { activityFeed, entityHistory } from "@bida/core";
import { BadLink, Blank, Body, Empty, Foot, QueryBoundary, Screen, Scroll, TopBar } from "@/components/chrome";
import { Icon } from "@/components/icons";
import { RevisionEntry, type RevisionContext } from "@/components/revision";
import { db } from "@/lib/db/dexie";
import { useLive } from "@/lib/db/live";
import { opsForGroup } from "@/lib/db/fold";
import { copy } from "@/lib/copy";
import { plural } from "@/lib/format";
import { parseEntrySource, route } from "@/lib/group-link";
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
  // An entry's history backs up to the entry, deleted or not: a deleted one's
  // screen is where Restore is.
  const back = !groupId ? "/" : entryId ? route.entry(groupId, entryId, via) : route.group(groupId);
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

  const context: RevisionContext = {
    groupId: group.id, currency, memberById, expenseById, settlementById, via: "history",
  };

  return (
    <Screen>
      <Body>
        <TopBar
          title={entryId ? copy.history.entryTitle : copy.history.title}
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
                {visible.map((rev, i) => (
                  <RevisionEntry key={rev.op.id} rev={rev} first={i === 0} context={context}
                    linked={!entryId} />
                ))}
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
