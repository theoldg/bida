"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CATCH_UP_MS, compareHlc, unseenRevisions, type ImportSource, type Revision } from "@bida/core";
import { Icon } from "@/components/icons";
import { foldAway } from "@/components/ledger-rows";
import { RevisionEntry, type RevisionContext } from "@/components/revision";
import { copy } from "@/lib/copy";
import { markEditsSeen } from "@/lib/db/commands";
import { getDevice } from "@/lib/db/device";
import { db } from "@/lib/db/dexie";
import { opsForGroup } from "@/lib/db/fold";
import { useLive } from "@/lib/db/live";
import { plural } from "@/lib/format";
import { route } from "@/lib/group-link";

/** Past this many the line leaves the rest to the history screen. */
const CAP = 4;

/**
 * What changed on other phones since this one last showed it: a folded line
 * under the you-owe card, opening onto those edits as history draws them.
 *
 * **New** is `unseenRevisions` (core/history.ts), which the groups list counts
 * too. **Showing it is seeing it**: the line holds for as long as the ledger is
 * open, and leaving the ledger marks all of it seen — the catch-up is
 * optional, so it is offered once and not again. Anything arriving meanwhile
 * joins it rather than the list being swapped under a thumb. **Folding it back
 * is done with it**: it goes the way a deleted row does, and only what arrives
 * after brings it back. What waits on a group nobody opens ages out after
 * `CATCH_UP_MS`.
 */
export function NewEdits({ groupId, currency, source }: {
  groupId: string; currency: string; source?: ImportSource | null;
}) {
  const fresh = useLive("newEdits", async () => {
    const key = await db().groupKeys.get(groupId);
    // No key is the demo; no mark is a group whose first pull hasn't landed.
    if (key?.seenSeq === undefined) return null;
    const { revisions, through } = unseenRevisions(await opsForGroup(groupId),
      key.seenSeq, (await getDevice()).nodeId, Date.now() - CATCH_UP_MS);
    // Nothing to name, but still a mark to move: this phone's own ops.
    if (revisions.length === 0) return { through };
    const [members, expenses, settlements] = await Promise.all([
      db().members.where("groupId").equals(groupId).toArray(),
      db().expenses.where("groupId").equals(groupId).toArray(),
      db().settlements.where("groupId").equals(groupId).toArray(),
    ]);
    return {
      through,
      revisions,
      memberById: new Map(members.map((m) => [m.id, m])),
      expenseById: new Map(expenses.map((e) => [e.id, e])),
      settlementById: new Map(settlements.map((s) => [s.id, s])),
    };
  }, [groupId]);

  // What unfolding showed, held so marking it seen doesn't empty the list.
  const [held, setHeld] = useState<Revision[] | null>(null);
  const [open, setOpen] = useState(false);
  // What folding it back put away: kept out while the query catches up with
  // the mark, so only a change arriving after it brings the line back.
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const box = useRef<HTMLDivElement>(null);
  const going = useRef(false);
  const live = (fresh?.revisions ?? []).filter((r) => !done.has(r.op.id));
  const shown = held
    ? [...held, ...live.filter((r) => !held.some((h) => h.op.id === r.op.id))]
      .sort((a, b) => compareHlc(b.op.hlc, a.op.hlc))
    : live;

  // Leaving the ledger — another tab, an entry, the groups list — marks all of
  // it seen: the line was on screen. Read through a ref: the cleanup outlives
  // the render.
  const top = fresh?.through ?? 0;
  const leave = useRef(0);
  leave.current = top;
  useEffect(() => () => {
    if (leave.current > 0) void markEditsSeen(groupId, leave.current);
  }, [groupId]);

  // The names outlive the read: once marked seen, the query finds nothing new
  // and returns none, while the held list still has to say who did what.
  const names = useRef(fresh);
  if (fresh?.revisions) names.current = fresh;

  if (shown.length === 0 || !names.current?.revisions) return null;
  const { memberById, expenseById, settlementById } = names.current;
  const context: RevisionContext = { groupId, currency, memberById, expenseById, settlementById, source };

  function toggle() {
    if (open) {
      if (going.current) return;
      going.current = true;
      const through = top;
      const ids = new Set(shown.map((r) => r.op.id));
      void markEditsSeen(groupId, through);
      void (box.current ? foldAway(box.current) : Promise.resolve()).then(() => {
        setDone((was) => new Set([...was, ...ids]));
        setHeld(null);
        setOpen(false);
        going.current = false;
      });
      return;
    }
    setOpen(true);
    // What arrived since an earlier unfold is seen by this one.
    setHeld(shown);
    void markEditsSeen(groupId, top);
  }

  // Keyed by what was put away: a change arriving mid-fold draws a new line,
  // not the folded one the animation left at no height.
  return (
    <div ref={box} key={done.size} className={`newedits${open ? " on" : ""}`}>
      <button type="button" className="daylabel neweditsbar" aria-expanded={open} onClick={toggle}>
        <span>{plural(shown.length, copy.noun.newChange)}</span>
      </button>
      {open ? (
        <div className="tl neweditslist">
          {shown.slice(0, CAP).map((rev, i) => (
            <RevisionEntry key={rev.op.id} rev={rev} first={i === 0} context={context} />
          ))}
          <Link href={route.history(groupId)} className="tlink neweditsmore">
            <Icon name="clock" size={13} />
            <span>{copy.group.groupHistory}</span>
            <Icon name="chev" size={13} />
          </Link>
        </div>
      ) : null}
    </div>
  );
}
