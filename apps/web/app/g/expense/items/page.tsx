"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { parseMinor } from "@hajsik/core";
import { Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "../../../../components/chrome";
import { Icon } from "../../../../components/icons";
import { distinctInitials, money } from "../../../../lib/format";
import { route } from "../../../../lib/group-link";
import { useGroupData } from "../../../../lib/hooks";
import { saveDraft, useDraft } from "../../../../lib/draft";
import {
  foldPortions, portions, receiptTotalMinor, unfoldItem, unfoldableInto, weightsFromItems,
} from "../../../../lib/scan/items";

/**
 * Who had what, filled from a receipt scan and reopenable later via "Edit
 * who-had-what" (ADR-0017). Its own screen rather than a mode inside the
 * split editor — a different question ("who ate this") from "how does the
 * total divide" — and it ends by writing an ordinary `shares` split, so
 * nothing downstream needs to know a scan was involved.
 */
export default function ItemsPage() {
  return <QueryBoundary><ItemsScreen /></QueryBoundary>;
}

function ItemsScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const draft = useDraft(groupId);
  const items = draft?.receiptItems ?? [];

  const [involved, setInvolved] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<Set<string>[]>([]);
  const seeded = useRef(false);

  // Seeded once, when the group's members and the scan's items are both in —
  // restore a previously saved assignment if this grid was already visited,
  // otherwise the ordinary case: everyone included, every item shared by all.
  useEffect(() => {
    if (seeded.current || data.loading || items.length === 0) return;
    seeded.current = true;
    const all = new Set(data.members.map((m) => m.id));
    if (draft?.receiptInvolved && draft.receiptAssignments?.length === items.length) {
      setInvolved(new Set(draft.receiptInvolved));
      setAssignments(draft.receiptAssignments.map((row) => new Set(row)));
    } else {
      setInvolved(all);
      setAssignments(items.map(() => new Set(all)));
    }
  }, [data.loading, data.members, items, draft?.receiptInvolved, draft?.receiptAssignments]);

  if (!groupId || !data.group || !draft) {
    return <Screen><Body><TopBar title="Who had what" back={true} /></Body></Screen>;
  }

  if (items.length === 0) {
    return (
      <Screen><Body>
        <TopBar title="Who had what"
          back={draft.expenseId ? route.editExpense(groupId, draft.expenseId) : route.addExpense(groupId)} />
        <Empty title="No line items on that scan">Assign the split from the expense form instead.</Empty>
      </Body></Screen>
    );
  }

  const labels = distinctInitials(data.members);
  const runs = portions(items);

  function toggleInvolved(memberId: string) {
    const nextInvolved = new Set(involved);
    const adding = !nextInvolved.has(memberId);
    if (adding) nextInvolved.add(memberId); else nextInvolved.delete(memberId);
    setInvolved(nextInvolved);
    setAssignments(assignments.map((row) => {
      const next = new Set(row);
      if (adding) next.add(memberId); else next.delete(memberId);
      return next;
    }));
  }

  // Unfolding and merging change the bill's shape, so the grid's rows have to
  // move with it: both are written together, keeping the invariant the seeding
  // effect above relies on (one assignment row per item) true even if this
  // screen is left without pressing Done.
  function commitRows(nextItems: typeof items, nextAssignments: Set<string>[]) {
    if (!groupId || !draft) return;
    setAssignments(nextAssignments);
    saveDraft(groupId, {
      ...draft,
      receiptItems: nextItems,
      receiptInvolved: [...involved],
      receiptAssignments: nextAssignments.map((row) => [...row]),
    });
  }

  /** "Salad ×2" becomes two salads, each starting with whoever had the line. */
  function unfold(index: number) {
    if (!draft) return;
    const next = unfoldItem(items, index, draft.currency);
    if (!next) return;
    commitRows(next.items, assignments.flatMap((row, i) =>
      i === index ? Array.from({ length: next.count }, () => new Set(row)) : [row]));
  }

  /** And back — everyone who had any portion had the line it becomes again. */
  function fold(start: number, count: number) {
    if (!draft) return;
    const next = foldPortions(items, start, count, draft.currency);
    if (!next) return;
    const merged = new Set<string>();
    for (const row of assignments.slice(start, start + count)) for (const id of row) merged.add(id);
    commitRows(next.items, [...assignments.slice(0, start), merged, ...assignments.slice(start + count)]);
  }

  function toggleCell(itemIndex: number, memberId: string) {
    setAssignments(assignments.map((row, i) => {
      if (i !== itemIndex) return row;
      const next = new Set(row);
      if (next.has(memberId)) next.delete(memberId); else next.add(memberId);
      return next;
    }));
  }

  const involvedMembers = data.members.filter((m) => involved.has(m.id));
  const weights = weightsFromItems(
    items, assignments,
    draft.receiptTip ? { amount: draft.receiptTip, members: involved } : null,
    draft.currency, draft.expenseId ?? "new",
  );
  const everyItemAssigned = assignments.length === items.length && assignments.every((r) => r.size > 0);
  const canFinish = involvedMembers.length > 0 && everyItemAssigned && Object.keys(weights).length > 0;
  const canUnfoldSomething = items.some((item) => unfoldableInto(item, draft.currency) !== null);

  let tipPercent: number | null = null;
  if (draft.receiptTip) {
    try {
      const tipMinor = parseMinor(draft.receiptTip, draft.currency);
      const subtotal = receiptTotalMinor(items, null, draft.currency) ?? 0;
      if (subtotal > 0) tipPercent = Math.round((tipMinor / subtotal) * 100);
    } catch { /* mid-type */ }
  }

  function finish() {
    if (!canFinish || !groupId || !draft) return;
    // This screen owns only the raw grid: who was there, and who had what.
    // The total and the split it implies are derived from these fields
    // wherever they're needed (the expense form's render, and its save) —
    // not written down here too, so there's nothing that can drift out of
    // sync with them (ADR-0020). Keep receiptItems/receiptTip and the raw
    // assignment around (unlike a discarded scan) so "Edit who-had-what" can
    // reopen this exact grid later, on any device. ADR-0017.
    saveDraft(groupId, {
      ...draft,
      receiptInvolved: [...involved],
      receiptAssignments: assignments.map((row) => [...row]),
      splitTab: "receipt",
    });
    router.back();
  }

  return (
    <Screen>
      <Body>
        <TopBar title="Who had what" sub={`${items.length} item${items.length === 1 ? "" : "s"}`}
          back={true}
          right={<button className="action" onClick={finish} disabled={!canFinish}>Done</button>} />

        <Scroll>
          <div className="pad" style={{ paddingTop: 10 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Who was there</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {data.members.map((m) => (
                <button key={m.id} onClick={() => toggleInvolved(m.id)}
                  aria-pressed={involved.has(m.id)}
                  aria-label={`${m.name}${involved.has(m.id) ? " was there" : " wasn't there"}`}
                  className="itemchip" style={{ opacity: involved.has(m.id) ? 1 : .4 }}>
                  <span className="avatar" style={{ width: 22, height: 22, fontSize: 10 }}>
                    {labels.get(m.id)}
                  </span>
                  {m.name}
                </button>
              ))}
            </div>
          </div>

          <div className="pad" style={{ paddingTop: 14 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Tap who had each item</div>
            <div className="itemtablewrap">
              <table className="itemtable">
                <thead>
                  <tr>
                    <th />
                    {involvedMembers.map((m) => (
                      <th key={m.id}>
                        <span className="avatar" style={{ width: 24, height: 24, fontSize: 10 }}>
                          {labels.get(m.id)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => {
                    const part = runs[i] ?? null;
                    const into = part ? null : unfoldableInto(item, draft.currency);
                    return (
                      <tr key={i} className={part ? "part" : undefined}>
                        <td className="itemlabel">
                          <div className="itemrow">
                            <span className="itemtext">
                              <span className="itemname">
                                {item.label}
                                {/* The printed count, but only where the button
                                    below isn't already carrying it. */}
                                {!part && into === null && item.quantity && item.quantity > 1 ? (
                                  <span className="itemqty"> ×{item.quantity}</span>
                                ) : null}
                              </span>
                              {/* Which portion this is goes on the amount line:
                                  the label's own line has a button to share
                                  with and a name of any length in it. */}
                              <span className="itemamount">
                                {item.amount}
                                {part ? <span className="itemqty"> · {part.index} of {part.of}</span> : null}
                              </span>
                            </span>
                            {into !== null ? (
                              <button className="itemfold" onClick={() => unfold(i)}
                                title={`Split into ${into} separate lines`}
                                aria-label={`Split ${item.label} into ${into} separate lines`}>
                                ×{into}<Icon name="split" size={12} />
                              </button>
                            ) : part && part.index === 1 ? (
                              <button className="itemfold on" onClick={() => fold(part.start, part.of)}
                                title="Merge back into one line"
                                aria-label={`Merge the ${part.of} ${item.label} lines back into one`}>
                                ×{part.of}<Icon name="merge" size={12} />
                              </button>
                            ) : null}
                          </div>
                        </td>
                        {involvedMembers.map((m) => (
                          <td key={m.id}>
                            <button className="itemcell" onClick={() => toggleCell(i, m.id)}
                              aria-pressed={assignments[i]?.has(m.id) ?? false}
                              aria-label={part
                                ? `${m.name} had ${item.label}, portion ${part.index} of ${part.of}`
                                : `${m.name} had ${item.label}`}>
                              {assignments[i]?.has(m.id) ? <span className="dot" /> : null}
                            </button>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  <tr>
                    <td className="itemlabel">
                      <span className="itemname">
                        Tip + service
                        {tipPercent !== null ? <span className="itemqty"> ({tipPercent}%)</span> : null}
                      </span>
                      <input className="itemamountin" inputMode="decimal" placeholder="0.00"
                        aria-label={`Tip and service, in ${draft.currency}`}
                        value={draft.receiptTip ?? ""}
                        onChange={(e) => saveDraft(groupId, { ...draft, receiptTip: e.target.value.trim() || null })} />
                    </td>
                    {involvedMembers.map((m) => <td key={m.id}><span className="dot" style={{ opacity: .35 }} /></td>)}
                  </tr>
                </tbody>
              </table>
            </div>
            {!everyItemAssigned ? (
              <div style={{ fontSize: 11.5, color: "var(--debit)", marginTop: 9, fontWeight: 600 }}>
                Every item needs at least one person.
              </div>
            ) : null}
            {/* Only until it's been used once: a control you've found doesn't
                need explaining, and the grid is tight enough already. */}
            {canUnfoldSomething && runs.every((r) => r === null) ? (
              <div className="hint" style={{ fontSize: 11.5 }}>
                Tap a <span style={{ fontFamily: "var(--f-mono)" }}>×N</span> to split that line into
                separate portions.
              </div>
            ) : null}
          </div>

          {involvedMembers.length > 0 ? (
            <div className="pad" style={{ paddingTop: 4 }}>
              <div className="card">
                {involvedMembers.map((m) => (
                  <div key={m.id} className="kv">
                    <span className="k">{m.name}</span>
                    <span className="v">{money(weights[m.id] ?? 0, draft.currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div style={{ height: 24 }} />
        </Scroll>
      </Body>
    </Screen>
  );
}
