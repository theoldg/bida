"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "../../../../components/chrome";
import { distinctInitials, money, tone } from "../../../../lib/format";
import { route } from "../../../../lib/group-link";
import { useGroupData } from "../../../../lib/hooks";
import { saveDraft, useDraft } from "../../../../lib/draft";
import { weightsFromItems } from "../../../../lib/scan/items";

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

  function finish() {
    if (!canFinish || !groupId || !draft) return;
    // Keep receiptItems/receiptTip and the raw assignment around (unlike a
    // discarded scan) so "Edit who-had-what" can reopen this exact grid —
    // later in this session, or after being written onto the expense itself
    // on save and reopened from any device. ADR-0017.
    saveDraft(groupId, {
      ...draft,
      split: { mode: "shares", weights },
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
                  <span className={`avatar ${tone(m.colorSeed)}`} style={{ width: 22, height: 22, fontSize: 10 }}>
                    {labels.get(m.id)}
                  </span>
                  {m.id === data.me ? "You" : m.name}
                </button>
              ))}
            </div>
          </div>

          <div className="pad" style={{ paddingTop: 14 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Tip</div>
            <div className="field">
              <label htmlFor="tip">Tip ({draft.currency}), scaled to what each person had</label>
              <input id="tip" inputMode="decimal" placeholder="0.00" value={draft.receiptTip ?? ""}
                onChange={(e) => saveDraft(groupId, { ...draft, receiptTip: e.target.value.trim() || null })} />
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
                        <span className={`avatar ${tone(m.colorSeed)}`} style={{ width: 24, height: 24, fontSize: 10 }}>
                          {labels.get(m.id)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={i}>
                      <td className="itemlabel">
                        <span>
                          {item.label}
                          {item.quantity && item.quantity > 1 ? (
                            <span className="itemqty"> ×{item.quantity}</span>
                          ) : null}
                        </span>
                        <span className="itemamount">{item.amount}</span>
                      </td>
                      {involvedMembers.map((m) => (
                        <td key={m.id}>
                          <button className="itemcell" onClick={() => toggleCell(i, m.id)}
                            aria-pressed={assignments[i]?.has(m.id) ?? false}
                            aria-label={`${m.name} had ${item.label}`}>
                            {assignments[i]?.has(m.id) ? <span className={`dot ${tone(m.colorSeed)}`} /> : null}
                          </button>
                        </td>
                      ))}
                    </tr>
                  ))}
                  {draft.receiptTip ? (
                    <tr>
                      <td className="itemlabel">
                        <span>Tip</span>
                        <span className="itemamount">{draft.receiptTip}</span>
                      </td>
                      {involvedMembers.map((m) => <td key={m.id}><span className="dot" style={{ opacity: .35 }} /></td>)}
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {!everyItemAssigned ? (
              <div style={{ fontSize: 11.5, color: "var(--debit)", marginTop: 9, fontWeight: 600 }}>
                Every item needs at least one person.
              </div>
            ) : null}
          </div>

          {involvedMembers.length > 0 ? (
            <div className="pad" style={{ paddingTop: 4 }}>
              <div className="card">
                {involvedMembers.map((m) => (
                  <div key={m.id} className="kv">
                    <span className="k">{m.id === data.me ? "You" : m.name}</span>
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
