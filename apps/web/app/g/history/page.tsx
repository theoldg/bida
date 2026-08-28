"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  activityFeed, entityHistory, splitParticipants,
  type CurrencyCode, type Member, type Op, type Revision, type SplitSpec,
} from "@hajsik/core";
import { Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { Icon } from "../../../components/icons";
import { restoreRevision } from "../../../lib/db/commands";
import { db } from "../../../lib/db/dexie";
import { opsForGroup } from "../../../lib/db/fold";
import { money, plural, stamp } from "../../../lib/format";
import { route } from "../../../lib/group-link";
import { useGroupData } from "../../../lib/hooks";

export default function HistoryPage() {
  return <QueryBoundary><HistoryScreen /></QueryBoundary>;
}

interface Described {
  what: string;
  diff?: { was?: string; now: string };
}

/** Every entity kind gets a plain-English sentence and, where it helps, a diff. */
function describe(
  rev: Revision,
  who: string,
  memberById: Map<string, Member>,
  currency: CurrencyCode,
): Described {
  const field = (name: string) => rev.changes.find((c) => c.field === name);
  const nameOf = (id: unknown) => (typeof id === "string" ? memberById.get(id)?.name ?? "someone" : "someone");
  const namesOf = (spec: SplitSpec | null | undefined) =>
    spec ? splitParticipants(spec).map((id) => memberById.get(id)?.name ?? "?").join(", ") : "";

  if (rev.entity === "expense") {
    if (rev.isCreate) {
      const amt = field("baseAmountMinor")?.after as number | undefined;
      const split = field("split")?.after as SplitSpec | undefined;
      const n = split ? splitParticipants(split).length : undefined;
      return {
        what: `${who} created this expense`,
        diff: amt !== undefined
          ? { now: `${money(amt, currency)}${n ? ` · split ${plural(n, "way")}` : ""}` }
          : undefined,
      };
    }
    if (rev.isDelete) return { what: `${who} deleted this expense` };
    if (field("split")) {
      const c = field("split")!;
      return {
        what: `${who} changed who's involved`,
        diff: { was: namesOf(c.before as SplitSpec | null), now: namesOf(c.after as SplitSpec) },
      };
    }
    if (field("amountMinor") || field("currency") || field("rateToBase") || field("baseAmountMinor")) {
      const c = field("baseAmountMinor") ?? field("amountMinor")!;
      return {
        what: `${who} changed the amount`,
        diff: {
          was: typeof c.before === "number" ? money(c.before, currency) : undefined,
          now: typeof c.after === "number" ? money(c.after, currency) : "",
        },
      };
    }
    if (field("paidBy")) {
      const c = field("paidBy")!;
      return { what: `${who} changed who paid`, diff: { was: nameOf(c.before), now: nameOf(c.after) } };
    }
    if (field("description")) {
      const c = field("description")!;
      return {
        what: `${who} changed the description`,
        diff: { was: (c.before as string) || "—", now: (c.after as string) || "—" },
      };
    }
    if (field("occurredAt")) return { what: `${who} changed the date` };
    if (field("categoryId")) return { what: `${who} changed the category` };
    if (field("attachmentIds")) {
      const c = field("attachmentIds")!;
      const before = Array.isArray(c.before) ? c.before.length : 0;
      const after = Array.isArray(c.after) ? c.after.length : 0;
      return { what: `${who} ${after > before ? "added" : "removed"} ${plural(Math.abs(after - before), "photo")}` };
    }
    return { what: `${who} edited this expense` };
  }

  if (rev.entity === "identity") {
    const c = field("memberId");
    const now = nameOf(c?.after);
    // The entity id is a device, not a person: "who" is whoever was speaking
    // for that device a moment ago, and "now" is who it speaks for next.
    if (rev.isCreate) return { what: `${now} started editing from a new device` };
    return {
      what: `${who} handed a device over to ${now}`,
      diff: { was: nameOf(c?.before), now },
    };
  }

  if (rev.entity === "settlement") {
    if (rev.isCreate) {
      const amt = field("baseAmountMinor")?.after as number | undefined;
      return { what: `${who} recorded a settlement`, diff: amt !== undefined ? { now: money(amt, currency) } : undefined };
    }
    if (rev.isDelete) return { what: `${who} deleted a settlement` };
    return { what: `${who} edited a settlement` };
  }

  if (rev.entity === "member") {
    if (rev.isCreate) return { what: `${who} joined the group` };
    if (rev.isDelete) return { what: `${who} left the group` };
    if (field("name")) {
      const c = field("name")!;
      return { what: `${who} changed their name`, diff: { was: c.before as string, now: c.after as string } };
    }
    return { what: `${who} was updated` };
  }

  // group
  if (rev.isCreate) return { what: `${who} created the group` };
  if (field("name")) {
    const c = field("name")!;
    return { what: `${who} renamed the group`, diff: { was: c.before as string, now: c.after as string } };
  }
  if (field("archivedAt")) {
    return { what: field("archivedAt")!.after ? `${who} archived the group` : `${who} restored the group` };
  }
  return { what: `${who} updated the group` };
}

const FIELD_LABELS: Record<string, string> = {
  amountMinor: "the amount", currency: "the amount", rateToBase: "the amount",
  baseAmountMinor: "the amount", split: "who's involved", paidBy: "who paid",
  payers: "who chipped in",
  description: "the description", occurredAt: "the date", categoryId: "the category",
  attachmentIds: "the photos", name: "the name", archivedAt: "the archived status",
  memberId: "who a device speaks for",
  deletedAt: "whether this was deleted",
};

/**
 * "Sam's change to the amount was overwritten by Marie's." — surfaced per
 * docs/sync.md#conflicts: we never show a resolution dialog, just the honest
 * record of what happened, once, in history.
 */
function overwriteNotes(rev: Revision, opsById: Map<string, Op>, memberById: Map<string, Member>): string[] {
  const seen = new Set<string>();
  const notes: string[] = [];
  for (const change of rev.changes) {
    if (!change.supersededByOpId || seen.has(change.supersededByOpId + change.field)) continue;
    const laterOp = opsById.get(change.supersededByOpId);
    if (!laterOp) continue;
    seen.add(change.supersededByOpId + change.field);
    const who = memberById.get(laterOp.actor)?.name ?? "someone";
    const field = FIELD_LABELS[change.field] ?? "this";
    notes.push(`This change to ${field} was later overwritten by ${who}'s edit.`);
  }
  return notes;
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
  const opsById = new Map(ops.map((op) => [op.id, op as Op]));

  const expense = expenseId ? data.expenses.find((e) => e.id === expenseId) : undefined;
  const revisions = !groupId ? [] : expenseId ? entityHistory(ops, expenseId) : activityFeed(ops, 200);

  if (!groupId || !data.group) return <Screen><Body><TopBar title=" " back={true} /></Body></Screen>;
  const group = data.group;
  const currency = group.baseCurrency;

  async function restore(rev: Revision) {
    if (!groupId) return;
    if (!confirm("Restore this version? It adds a new entry rather than erasing what happened since.")) return;
    await restoreRevision(groupId, data.me ?? rev.op.actor, rev.entity, rev.entityId, rev.op.hlc);
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
                  const who = rev.op.actor === data.me ? "You" : memberById.get(rev.op.actor)?.name ?? "Someone";
                  const d = describe(rev, who, memberById, currency);
                  // Restoring an identity claim would mean telling somebody
                  // else's phone who it is. There is nothing to restore.
                  const canRestore = rev.entity !== "group" && rev.entity !== "identity"
                    && !(rev.isCreate && i === revisions.length - 1);
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
                      {overwriteNotes(rev, opsById, memberById).map((n) => (
                        <div className="conflict" key={n}>{n}</div>
                      ))}
                      {canRestore ? (
                        <button className="restore" onClick={() => restore(rev)}>Restore this version</button>
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
