"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { compareHlc, unseenRevisions, type Revision } from "@bida/core";
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

/**
 * What changed on other phones since this one last showed it: a folded line
 * under the you-owe card, opening onto those edits as history draws them.
 *
 * **New** is `unseenRevisions` (core/history.ts), which the groups list counts
 * too. Two things mark it seen: unfolding it, and leaving the ledger.
 * Unfolding keeps the line up until then, folded again or not, and anything
 * arriving meanwhile joins it rather than the list being swapped under a thumb.
 */
export function NewEdits({ groupId, currency }: { groupId: string; currency: string }) {
  const fresh = useLive("newEdits", async () => {
    const key = await db().groupKeys.get(groupId);
    // No key is the demo; no mark is a group whose first pull hasn't landed.
    if (key?.seenSeq === undefined) return null;
    const { revisions, through } = unseenRevisions(
      await opsForGroup(groupId), key.seenSeq, (await getDevice()).nodeId);
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
  // Folding it again keeps the hold: the line stays until the ledger is left.
  const [held, setHeld] = useState<Revision[] | null>(null);
  const [open, setOpen] = useState(false);
  const live = fresh?.revisions ?? [];
  const shown = held
    ? [...held, ...live.filter((r) => !held.some((h) => h.op.id === r.op.id))]
      .sort((a, b) => compareHlc(b.op.hlc, a.op.hlc))
    : live;

  // Leaving the ledger — another tab, an entry, the groups list — is the other
  // way to have seen them. Read through a ref: the cleanup outlives the render.
  const top = fresh?.through ?? 0;
  const last = useRef(top);
  last.current = top;
  useEffect(() => () => {
    if (last.current > 0) void markEditsSeen(groupId, last.current);
  }, [groupId]);

  // The names outlive the read: once marked seen, the query finds nothing new
  // and returns none, while the held list still has to say who did what.
  const names = useRef(fresh);
  if (fresh?.revisions) names.current = fresh;

  if (shown.length === 0 || !names.current?.revisions) return null;
  const { memberById, expenseById, settlementById } = names.current;
  const context: RevisionContext = { groupId, currency, memberById, expenseById, settlementById };

  function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (held) return;
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
              <Icon name="clock" size={13} />
              <span>{copy.group.moreChanges}</span>
              <Icon name="chev" size={13} />
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
