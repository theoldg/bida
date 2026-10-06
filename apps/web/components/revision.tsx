import Link from "next/link";
import type { Expense, ImportSource, Member, Revision, Settlement } from "@bida/core";
import { Icon } from "@/components/icons";
import { copy } from "@/lib/copy";
import { stamp } from "@/lib/format";
import { describe } from "@/lib/history-copy";
import type { Row } from "@/lib/history-rows";
import { route } from "@/lib/group-link";

/**
 * Everything a revision's line needs to name who and what. **Every member and
 * entry, removed and deleted ones included**: the alive-only maps would erase
 * people from their own past and title a deleted entry "Transfer".
 */
export interface RevisionContext {
  groupId: string;
  currency: string;
  memberById: Map<string, Member>;
  expenseById: Map<string, Expense>;
  settlementById: Map<string, Settlement>;
  /** The group's `importedFrom`, for an imported entry's sentence. */
  source?: ImportSource | null;
  /** Where the entry link says it came from; the ledger passes none. */
  via?: "history";
}

/**
 * Where a revision in the group feed leads — entries only, since "you changed
 * the amount" needs to say of what. A deleted entry leads to its own screen
 * too, which is where Restore is.
 */
function subjectOf(rev: Revision, c: RevisionContext): { href: string; label: string } | undefined {
  const link = (deleted: boolean, label: string) => ({
    href: route.entry(c.groupId, rev.entityId, c.via),
    label: deleted ? copy.history.deleted(label) : label,
  });
  if (rev.entity === "expense") {
    const e = c.expenseById.get(rev.entityId);
    return link(!!e?.deletedAt, e?.description?.trim() || copy.history.untitled);
  }
  if (rev.entity === "settlement") {
    const s = c.settlementById.get(rev.entityId);
    const from = c.memberById.get(s?.fromMember ?? "")?.name ?? copy.unknown;
    const to = c.memberById.get(s?.toMember ?? "")?.name ?? copy.unknown;
    return link(!!s?.deletedAt, `${from} → ${to}`);
  }
  return undefined;
}

/** Past this many, the rest wait behind a tap: a re-read bill can move thirty lines. */
const ROWS_SHOWN = 5;

/**
 * What moved, a row each: "+ Chewie 20.00", "Everyone but Cy 25.00 → 33.33",
 * "Blue milk: Ben → Chewie". The mark carries in-or-out, so the figures need no
 * words; a bill line is set quieter than a person.
 */
function Rows({ rows }: { rows: Row[] }) {
  const one = (r: Row, i: number) => (
    <div key={i} className={`hrow${r.item ? " item" : ""}`}>
      {r.mark ? <span className={r.mark === "+" ? "mk in" : "mk out"}>{r.mark}</span> : null}
      <span className="nm">{r.name}</span>
      {r.was !== undefined ? <span className="was">{r.was}</span> : null}
      {r.was !== undefined && r.now !== undefined && !r.mark ? <span className="to" aria-hidden>→</span> : null}
      {r.now !== undefined ? <span className="now2">{r.now}</span> : null}
    </div>
  );
  // One past the cap is shown rather than folded: "1 more" saves no room.
  const cut = rows.length > ROWS_SHOWN + 1 ? ROWS_SHOWN : rows.length;
  return (
    <div className="hrows">
      {rows.slice(0, cut).map(one)}
      {cut < rows.length ? (
        <details className="hmore">
          <summary>{copy.history.more(String(rows.length - cut))}</summary>
          <div className="hrows">{rows.slice(cut).map((r, i) => one(r, cut + i))}</div>
        </details>
      ) : null}
    </div>
  );
}

/** One point on a `.tl` timeline: who, when, what moved, and what it was about. */
export function RevisionEntry({ rev, first, context, linked = true }: {
  rev: Revision; first: boolean; context: RevisionContext;
  /** Off in an entry's own history, which is already about that entry. */
  linked?: boolean;
}) {
  const who = context.memberById.get(rev.op.actor)?.name ?? copy.someone;
  const d = describe(rev, who, context.memberById, context.currency, context.source);
  const subject = linked ? subjectOf(rev, context) : undefined;
  return (
    <div className={`tle${first ? " now" : ""}`}>
      <div className="when">{stamp(rev.op.createdAt)} · {who.toUpperCase()}</div>
      <div className="what">{d.what}</div>
      {d.diff ? (
        <div className="diff">
          {d.diff.was !== undefined ? <span className="was">{d.diff.was}</span> : null}
          <span className="now2">{d.diff.now}</span>
        </div>
      ) : null}
      {d.rows?.length ? <Rows rows={d.rows} /> : null}
      {d.also?.length ? (
        <div className="also">
          {d.also.map((a) => (
            <div key={a.label} className="alsoi">
              <span className="lbl">{a.label}</span>
              {a.was !== undefined ? <span className="was">{a.was}</span> : null}
              {a.now !== undefined ? <span className="now2">{a.now}</span> : null}
              {a.rows?.length ? <Rows rows={a.rows} /> : null}
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
}
