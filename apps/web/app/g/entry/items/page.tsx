"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { parseMinor, receiptExtras } from "@bida/core";
import { AmountInput } from "../../../../components/amount-input";
import { Blank, Body, Empty, QueryBoundary, Screen, TopBar } from "../../../../components/chrome";
import { ConfirmDialog } from "../../../../components/dialog";
import { Icon } from "../../../../components/icons";
import { copy } from "../../../../lib/copy";
import { bare, distinctInitials, money } from "../../../../lib/format";
import { parseEntrySource, route } from "../../../../lib/group-link";
import { useClaimGate, useGroupData } from "../../../../lib/hooks";
import { receiptWeights, saveDraft, useDraft, type EntryDraft } from "../../../../lib/draft";
import {
  foldPortions, portions, receiptTotalMinor, unfoldItem, unfoldableInto,
} from "../../../../lib/scan/items";

/**
 * Who had what, filled from a receipt scan and reopenable later via "Edit
 * who-had-what" (ADR-0016). Its own screen rather than a mode inside the
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
  // Held, not read: this screen is a detour off the entry form, and the form's
  // `via` has to survive it or saving lands somewhere else than it would have
  // (lib/group-link.ts).
  const via = parseEntrySource(params.get("via"));
  const data = useGroupData(groupId);
  const unclaimed = useClaimGate(groupId, data);
  const draft = useDraft(groupId);
  const items = draft?.receiptItems ?? [];

  const [involved, setInvolved] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<Set<string>[]>([]);
  const seeded = useRef(false);
  const [asking, setAsking] = useState(false);
  // Whether the deductions are showing one by one or as one figure. Display
  // only — it changes nothing the bill is worth, so nothing is written down.
  const [openDiscounts, setOpenDiscounts] = useState(false);
  // Splitting a line and merging one back have to be written to the draft as
  // they happen — the grid's rows and the bill's lines are one list, and the
  // seeding effect above trusts them to be the same length. So this screen
  // keeps what it found, and leaving puts it back: tapping ×N to see what a
  // shared bottle would look like was otherwise a change you couldn't undo.
  const opened = useRef<Pick<EntryDraft,
    "receiptItems" | "receiptTip" | "receiptTax" | "receiptDiscounts"
    | "receiptInvolved" | "receiptAssignments" | "splitTab"> | null>(null);
  const [touched, setTouched] = useState(false);
  if (draft && !opened.current) {
    opened.current = {
      receiptItems: draft.receiptItems, receiptTip: draft.receiptTip,
      receiptTax: draft.receiptTax, receiptDiscounts: draft.receiptDiscounts,
      receiptInvolved: draft.receiptInvolved, receiptAssignments: draft.receiptAssignments,
      splitTab: draft.splitTab,
    };
  }

  // Seeded once, when the group's members and the scan's items are both in —
  // restore a previously saved assignment if this grid was already visited,
  // otherwise an empty grid: everyone is at the table (they are the columns
  // you tap in), and nothing is anybody's yet. Starting with every item on
  // everybody meant reading a bill you had already been told the answer to,
  // and unticking your way out of it; ticking what you had is the work this
  // screen is for, so it is what the grid asks for.
  useEffect(() => {
    if (seeded.current || data.loading || items.length === 0) return;
    seeded.current = true;
    const all = new Set(data.members.map((m) => m.id));
    if (draft?.receiptInvolved && draft.receiptAssignments?.length === items.length) {
      setInvolved(new Set(draft.receiptInvolved));
      setAssignments(draft.receiptAssignments.map((row) => new Set(row)));
    } else {
      setInvolved(all);
      setAssignments(items.map(() => new Set<string>()));
    }
  }, [data.loading, data.members, items, draft?.receiptInvolved, draft?.receiptAssignments]);

  if (!groupId || unclaimed || !data.group || !draft) {
    return <Blank title={copy.items.title} />;
  }

  if (items.length === 0) {
    return (
      <Screen><Body>
        <TopBar title={copy.items.title}
          back={draft.entryId ? route.editEntry(groupId, draft.entryId, via)
            : route.addEntry(groupId, draft.kind, via)} />
        <Empty title={copy.items.none.title}>{copy.items.none.body}</Empty>
      </Body></Screen>
    );
  }

  const labels = distinctInitials(data.members);
  const runs = portions(items);

  // Saying somebody was there opens their column and nothing more — an empty
  // one, like the grid starts. Saying they weren't takes back every item they
  // had been given, since a column that isn't shown can't be corrected.
  function toggleInvolved(memberId: string) {
    setTouched(true);
    const nextInvolved = new Set(involved);
    const adding = !nextInvolved.has(memberId);
    if (adding) nextInvolved.add(memberId); else nextInvolved.delete(memberId);
    setInvolved(nextInvolved);
    if (adding) return;
    setAssignments(assignments.map((row) => {
      const next = new Set(row);
      next.delete(memberId);
      return next;
    }));
  }

  // Unfolding and merging change the bill's shape, so the grid's rows have to
  // move with it: both are written together, keeping the invariant the seeding
  // effect above relies on (one assignment row per item) true even if this
  // screen is left without pressing Done.
  function commitRows(nextItems: typeof items, nextAssignments: Set<string>[]) {
    if (!groupId || !draft) return;
    setTouched(true);
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
    setTouched(true);
    setAssignments(assignments.map((row, i) => {
      if (i !== itemIndex) return row;
      const next = new Set(row);
      if (next.has(memberId)) next.delete(memberId); else next.add(memberId);
      return next;
    }));
  }

  const involvedMembers = data.members.filter((m) => involved.has(m.id));
  // Asked of lib/draft, not of weightsFromItems directly: what these rows are
  // worth has to be the same answer the form gives once Done has written them
  // down, and the seed that decides it is not this screen's to pick.
  const weights = receiptWeights(draft, items, assignments, involved);
  const everyItemAssigned = assignments.length === items.length && assignments.every((r) => r.size > 0);
  const canFinish = involvedMembers.length > 0 && everyItemAssigned && Object.keys(weights).length > 0;
  const canUnfoldSomething = items.some((item) => unfoldableInto(item, draft.currency) !== null);
  // The extras the bill printed, in the order it printed them, and signed the
  // way they are worth: a deduction is the one figure on this screen that comes
  // off. The tip is not among them — it is typed, and has its own row.
  const minorOf = (amount: string) => {
    try { return parseMinor(amount, draft.currency); } catch { return null; }
  };
  const discounts = (draft.receiptDiscounts ?? []).flatMap((d) => {
    const minor = minorOf(d.amount);
    return minor === null || minor <= 0 ? [] : [{ label: d.label, minor: -minor }];
  });
  const taxMinor = draft.receiptTax ? minorOf(draft.receiptTax) : null;
  // Several deductions collapse into one row the way repeated items do, and
  // open the same way — the printed names are worth reading ("2 for 1" is not
  // "Loyalty"), but four of them above the tip is a bill nobody can see past.
  // Unlike an item's ×N this changes nothing about the bill: the rows are not
  // assignable either way, so it is this screen's own state, not a draft write.
  const discountTotal = discounts.reduce((sum, d) => sum + d.minor, 0);
  const discountRows = discounts.length > 1 && !openDiscounts
    ? [{ label: "", minor: discountTotal, of: discounts.length }]
    : discounts.map((d) => ({ ...d, of: discounts.length > 1 ? discounts.length : 0 }));

  // A tip is a percentage of what the food actually came to, so the discounts
  // are already off it and the tax is not on it — which is how a bill prints a
  // suggested tip, and how anybody works one out in their head.
  let tipPercent: number | null = null;
  if (draft.receiptTip) {
    try {
      const tipMinor = parseMinor(draft.receiptTip, draft.currency);
      const ordered = receiptTotalMinor(
        items, { tip: null, tax: null, discounts: draft.receiptDiscounts ?? [] }, draft.currency) ?? 0;
      if (ordered > 0) tipPercent = Math.round((tipMinor / ordered) * 100);
    } catch { /* mid-type */ }
  }

  function finish() {
    if (!canFinish || !groupId || !draft) return;
    // This screen owns only the raw grid: who was there, and who had what.
    // The total and the split it implies are derived from these fields
    // wherever they're needed (the expense form's render, and its save) —
    // not written down here too, so there's nothing that can drift out of
    // sync with them (ADR-0016). Keep receiptItems/receiptTip and the raw
    // assignment around (unlike a discarded scan) so "Edit who-had-what" can
    // reopen this exact grid later, on any device. ADR-0016.
    saveDraft(groupId, {
      ...draft,
      receiptInvolved: [...involved],
      receiptAssignments: assignments.map((row) => [...row]),
      splitTab: "receipt",
    });
    router.back();
  }

  /** Leaving undoes what this screen wrote; `finish` is the only way to keep it. */
  function mayLeave() {
    if (touched) { setAsking(true); return false; }
    return true;
  }

  function discard() {
    if (groupId && draft && opened.current) saveDraft(groupId, { ...draft, ...opened.current });
    router.back();
  }

  // One line under the grid at a time: what still has to be fixed, or — until
  // the control has been found once — what the ×N does. A control you've used
  // doesn't need explaining, and the footer is one line tall.
  const note = !everyItemAssigned ? (
    <div className="footnote bad">{copy.items.needsSomeone}</div>
  ) : canUnfoldSomething && runs.every((r) => r === null) ? (
    <div className="footnote">
      {copy.items.unfoldHint.before} <b>×N</b> {copy.items.unfoldHint.after}
    </div>
  ) : discounts.length > 0 || taxMinor !== null ? (
    <div className="footnote">{copy.items.extraNote}</div>
  ) : null;

  return (
    <Screen>
      <Body>
        <TopBar title={copy.items.title} back={{ ask: mayLeave }} />

        {/* Three bands, not one scrolling page: who was there stays put at the
            top, the running totals at the foot, and the grid in between owns
            the scroll — which is what lets its initials row freeze while a long
            bill scrolls under it. A twenty-line receipt is the case this screen
            exists for, and the column you're tapping in has to keep its name. */}
        <div className="itemhead">
          <div className="eyebrow" style={{ marginBottom: 8 }}>{copy.items.whoWasThere}</div>
          <div className="whostrip">
            {data.members.map((m) => (
              <button key={m.id} onClick={() => toggleInvolved(m.id)}
                aria-pressed={involved.has(m.id)}
                aria-label={involved.has(m.id) ? copy.items.wasThere(m.name) : copy.items.wasntThere(m.name)}
                className="itemchip" style={{ opacity: involved.has(m.id) ? 1 : .4 }}>
                <span className="avatar" style={{ width: 22, height: 22, fontSize: 10 }}>
                  {labels.get(m.id)}
                </span>
                {m.name}
              </button>
            ))}
          </div>
        </div>

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
                            {part ? <span className="itemqty"> · {copy.items.portion(part.index, part.of)}</span> : null}
                          </span>
                        </span>
                        {into !== null ? (
                          <button className="itemfold" onClick={() => unfold(i)}
                            title={copy.items.splitInto(into)}
                            aria-label={copy.items.splitItem(item.label, into)}>
                            ×{into}<Icon name="split" size={12} />
                          </button>
                        ) : part && part.index === 1 ? (
                          <button className="itemfold on" onClick={() => fold(part.start, part.of)}
                            title={copy.items.mergeBack}
                            aria-label={copy.items.mergeItem(item.label, part.of)}>
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
                            ? copy.items.hadPortion(m.name, item.label, part.index, part.of)
                            : copy.items.had(m.name, item.label)}>
                          {assignments[i]?.has(m.id) ? <span className="dot" /> : null}
                        </button>
                      </td>
                    ))}
                  </tr>
                );
              })}
              {/* What the bill took off and what it added on. Read off the
                  receipt rather than typed, and with no cells to tap: nobody
                  ordered them, so they follow what everybody did order
                  (`receiptBreakdown`). */}
              {discountRows.map((row, i) => (
                <tr key={`off${i}`} className={discountRows.length > 1 ? "part" : undefined}>
                  <td className="itemlabel">
                    <div className="itemrow">
                      <span className="itemtext">
                        <span className="itemname">
                          {row.label || copy.items.extra.discount}
                        </span>
                        <span className="itemamount">{bare(row.minor, draft.currency)}</span>
                      </span>
                      {/* The same ×N the repeated items wear, so one control
                          means one thing on this screen. */}
                      {row.of > 1 && (openDiscounts ? i === 0 : true) ? (
                        <button className={`itemfold${openDiscounts ? " on" : ""}`}
                          onClick={() => setOpenDiscounts(!openDiscounts)}
                          title={openDiscounts ? copy.items.mergeBack : copy.items.splitInto(row.of)}
                          aria-label={openDiscounts
                            ? copy.items.mergeDiscounts(row.of) : copy.items.splitDiscounts(row.of)}
                          aria-expanded={openDiscounts}>
                          ×{row.of}<Icon name={openDiscounts ? "merge" : "split"} size={12} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                  {involvedMembers.map((m) => (
                    <td key={m.id}><span className="dot" style={{ opacity: .35 }} /></td>
                  ))}
                </tr>
              ))}
              {taxMinor !== null ? (
                <tr>
                  <td className="itemlabel">
                    <div className="itemrow">
                      <span className="itemtext">
                        <span className="itemname">{copy.items.extra.tax}</span>
                        <span className="itemamount">{bare(taxMinor, draft.currency)}</span>
                      </span>
                    </div>
                  </td>
                  {involvedMembers.map((m) => (
                    <td key={m.id}><span className="dot" style={{ opacity: .35 }} /></td>
                  ))}
                </tr>
              ) : null}
              <tr>
                <td className="itemlabel">
                  <span className="itemname">
                    {copy.items.extra.tip}
                    {tipPercent !== null ? <span className="itemqty"> {copy.items.tipPercent(tipPercent)}</span> : null}
                  </span>
                  {/* The only figure on this screen that is typed rather than
                      read off the bill, so it is drawn as a field and says so
                      until it holds something. */}
                  <span className="tipfield">
                    {/* `AmountInput`, like every other typed figure: a bare
                        input took "5.5.5" and kept showing it while
                        `receiptTotalMinor` quietly dropped it from the total. */}
                    <AmountInput className="itemamountin" frame="none"
                      currency={draft.currency} placeholder={bare(0, draft.currency)}
                      aria-label={copy.items.tipLabel(draft.currency)}
                      value={draft.receiptTip ?? ""}
                      onChange={(text) => {
                        setTouched(true);
                        saveDraft(groupId, { ...draft, receiptTip: text || null });
                      }} />
                    <Icon name="edit" size={11} className="tipedit" />
                  </span>
                  {draft.receiptTip ? null : <span className="tiphint">{copy.items.tipHint}</span>}
                </td>
                {involvedMembers.map((m) => <td key={m.id}><span className="dot" style={{ opacity: .35 }} /></td>)}
              </tr>
            </tbody>
          </table>
        </div>

        {/* What the grid adds up to, kept in sight while it's being tapped
            rather than at the bottom of a scroll — one name per line, so the
            figures share a right edge and none of them is off-screen. */}
        <div className="itemfoot">
          {note}
          {involvedMembers.length > 0 ? (
            <div className="totalstrip">
              {involvedMembers.map((m) => (
                <div key={m.id} className="tot" aria-label={copy.items.share(m.name)}>
                  <span className="who">{m.name}</span>
                  <span className="amt">{money(weights[m.id] ?? 0, draft.currency)}</span>
                </div>
              ))}
            </div>
          ) : null}
          {/* The same button the entry form ends on, under the totals it
              agrees with. It can't scroll with the content the way that one
              does — the grid owns this screen's scroll, sideways as well as
              down — so it stays in the band, which pays `--kb` for the tip
              being typed a row above it. */}
          <button type="button" className="btn btn-p btn-lg itemsave"
            onClick={finish} disabled={!canFinish}>
            {copy.act.done}
          </button>
        </div>
      </Body>

      {asking ? (
        <ConfirmDialog title={copy.items.discardTitle} confirm={copy.act.discard}
          danger={true} onConfirm={discard} onClose={() => setAsking(false)}>
          <p>{copy.items.discardBody}</p>
        </ConfirmDialog>
      ) : null}
    </Screen>
  );
}
