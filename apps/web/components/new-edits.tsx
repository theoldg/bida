"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { activityFeed, compareHlc, parseHlc, type Revision } from "@bida/core";
import { Icon } from "@/components/icons";
import { RevisionEntry, type RevisionContext } from "@/components/revision";
import { copy } from "@/lib/copy";
import { markEditsSeen } from "@/lib/db/commands";
import { getDevice } from "@/lib/db/device";
import { db } from "@/lib/db/dexie";
import { opsForGroup } from "@/lib/db/fold";
import { useLive } from "@/lib/db/live";
import { plural } from "@/lib/format";
import { route } from "@/lib/group-link";

/** Past this many the line hands over to the history screen. */
const CAP = 4;

const nodeOf = (hlc: string): string | undefined => {
  try { return parseHlc(hlc).node; } catch { return undefined; }
};

/**
 * What changed on other phones since this one last showed it: a folded line
 * under the you-owe card, opening onto those edits as history draws them.
 *
 * **New** is an op the server numbered past `seenSeq` whose stamp is another
 * phone's — your own laptop included, since this phone never showed it. Two
 * things mark it seen: unfolding it, and leaving the ledger. Unfolding keeps
 * the list up until then, and anything arriving meanwhile joins it rather than
 * the list being swapped under a thumb.
 */
export function NewEdits({ groupId, currency }: { groupId: string; currency: string }) {
  const fresh = useLive("newEdits", async () => {
    const key = await db().groupKeys.get(groupId);
    // No key is the demo; no mark is a group whose first pull hasn't landed.
    if (key?.seenSeq === undefined) return null;
    const seen = key.seenSeq;
    const mine = (await getDevice()).nodeId;
    const ops = await opsForGroup(groupId);
    const news = new Set(ops
      .filter((o) => (o.seq ?? 0) > seen && nodeOf(o.hlc) !== mine)
      .map((o) => o.id));
    if (news.size === 0) return null;
    // A revision's diff needs its entity's earlier ops, so the feed is folded
    // over every op of the touched entities, then cut down to the new ones.
    const touched = new Set(ops.filter((o) => news.has(o.id)).map((o) => o.entityId));
    const revisions = activityFeed(ops.filter((o) => touched.has(o.entityId)))
      .filter((r) => news.has(r.op.id));
    const [members, expenses, settlements] = await Promise.all([
      db().members.where("groupId").equals(groupId).toArray(),
      db().expenses.where("groupId").equals(groupId).toArray(),
      db().settlements.where("groupId").equals(groupId).toArray(),
    ]);
    return {
      revisions,
      memberById: new Map(members.map((m) => [m.id, m])),
      expenseById: new Map(expenses.map((e) => [e.id, e])),
      settlementById: new Map(settlements.map((s) => [s.id, s])),
    };
  }, [groupId]);

  // What unfolding showed, held so marking it seen doesn't empty the list.
  const [held, setHeld] = useState<Revision[] | null>(null);
  const live = fresh?.revisions ?? [];
  const shown = held
    ? [...held, ...live.filter((r) => !held.some((h) => h.op.id === r.op.id))]
      .sort((a, b) => compareHlc(b.op.hlc, a.op.hlc))
    : live;

  // Leaving the ledger — another tab, an entry, the groups list — is the other
  // way to have seen them. Read through a ref: the cleanup outlives the render.
  const top = Math.max(0, ...shown.map((r) => r.op.seq ?? 0));
  const last = useRef(top);
  last.current = top;
  useEffect(() => () => {
    if (last.current > 0) void markEditsSeen(groupId, last.current);
  }, [groupId]);

  // The names outlive the read: once marked seen, the query finds nothing new
  // and returns none, while the held list still has to say who did what.
  const names = useRef(fresh);
  if (fresh) names.current = fresh;

  if (shown.length === 0 || !names.current) return null;
  const open = held !== null;
  const context: RevisionContext = { groupId, currency, ...names.current };

  function toggle() {
    if (open) { setHeld(null); return; }
    setHeld(live);
    void markEditsSeen(groupId, top);
  }

  return (
    <div className={`newedits${open ? " on" : ""}`}>
      <button type="button" className="daylabel neweditsbar" aria-expanded={open} onClick={toggle}>
        <span>{plural(shown.length, copy.noun.newChange)}</span>
        <Icon name="chev" size={13} className="neweditschev" />
      </button>
      {open ? (
        <div className="tl neweditslist">
          {shown.slice(0, CAP).map((rev, i) => (
            <RevisionEntry key={rev.op.id} rev={rev} first={i === 0} context={context} />
          ))}
          {shown.length > CAP ? (
            <Link href={route.history(groupId)} className="tlink neweditsmore">
              <span>{copy.group.moreChanges(shown.length - CAP)}</span>
              <Icon name="chev" size={13} />
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
