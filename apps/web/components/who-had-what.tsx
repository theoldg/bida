"use client";

import { useEffect, useRef, useState } from "react";
import { parseMinor, type ExtraKind } from "@bida/core";
import { AmountInput } from "./amount-input";
import { keepsFocus } from "./bits";
import { Body, Screen, TopBar } from "./chrome";
import { ConfirmDialog } from "./dialog";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { useRefusal } from "../lib/refusal";
import { nearestOutOfView, revealWhole } from "../lib/reveal";
import { bare, distinctInitials } from "../lib/format";
import { receiptWeights, type EntryDraft } from "../lib/draft";
import {
  foldedLine, portions, receiptTotalMinor, runAssignment, unfoldItem, unfoldableInto,
} from "../lib/scan/items";

/**
 * Who had what: the grid a scanned bill is assigned on (ADR-0016).
 *
 * Two screens wear it, as two screens wear the scan control itself — the
 * group's `/g/entry/items`, a detour off the entry form, and `/quick/items`,
 * where the same bill is being divided among people who are not a group
 * ([ADR-0035](../../docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md)).
 * Neither owns it, because two copies of this arithmetic would disagree
 * within a month, and the cent it hands out is the cent the screen after it
 * has to quote (`receiptWeights`).
 *
 * What the two doors differ in is all here: who the columns are, how a figure
 * is printed — a group's currency, or bare, since a quick split converts
 * nothing — and where Done goes. Everything else, the grid decides.
 *
 * It assumes a bill with lines on it. What "no lines" means is the caller's
 * question: the form says split it by hand instead, and a quick split has
 * nothing left to be.
 */
/**
 * How long a scroll is waited on before the flash runs anyway. A smooth scroll
 * has no end event every browser here agrees on, and a person who has taken the
 * list over mid-travel is owed an answer more than a tidy one.
 */
const SETTLED_MS = 800;

/** The scroller has arrived — or has been given long enough to. */
function whenStill(box: Element, target: number, done: () => void) {
  const giveUp = Date.now() + SETTLED_MS;
  const look = () => {
    if (Math.abs(box.scrollTop - target) <= 1 || Date.now() > giveUp) { done(); return; }
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

/**
 * Whether to travel at all. The flash itself is exempt from reduced motion —
 * a colour settling is what that guidance asks for (globals.css) — but this is
 * movement, and movement is exactly what it asks to be spared: the row is put
 * in place at once instead.
 */
const calmly = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function WhoHadWhat({ title, people, draft, save, format, onDone, onBack }: {
  title: string;
  /** The columns: everybody who might have been at this table. */
  people: readonly { id: string; name: string }[];
  draft: EntryDraft;
  /** Writes the draft back — the grid's rows and the bill's lines are one list. */
  save: (draft: EntryDraft) => void;
  format: (minor: number) => string;
  /** Done, with the grid written down. */
  onDone: () => void;
  /** Left without keeping it; the bill has been put back as it was found. */
  onBack: () => void;
}) {
  const items = draft.receiptItems ?? [];
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
  // A refused Done, and what it leaves behind: the flash is spent in ~600ms,
  // the sentence stays until the grid is actually finishable. What blooms is
  // the lines with nobody on them — all of them, off the one refusal, so a
  // second press replays every one together. Done itself doesn't: it is the
  // control that was pressed, not what is missing, so it greys for exactly as
  // long as the flash and comes back, the entry form's Save exactly.
  // What blooms has to be on screen to be a signal at all, and on a twenty-line
  // bill it may not be: with every unassigned line scrolled past, the nearest
  // is brought in first and the flash waits for the list to land (`reveal`
  // below). Done stays spent across both, so one press is one answer.
  const refusal = useRefusal();
  const [seeking, setSeeking] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  /** Every drawn row, by the item it starts at — a folded run is one row. */
  const rowEl = useRef<(HTMLTableRowElement | null)[]>([]);
  const [told, setTold] = useState(false);
  // Which runs of portions are drawn open, by the item index they start at.
  // **This is the whole of folding now**: the bill keeps its portions once a
  // line has been split, and folding is a view of them (`foldedLine`), never a
  // rewrite that would throw away which portion was whose. A restored draft
  // starts with every run folded, which is the compact reading of it.
  const [open, setOpen] = useState<Set<number>>(new Set());
  // A run just opened by tapping a cell in it, and the column that tap was in:
  // it is scrolled to whole and only then does that column flash (`follow`).
  const [pending, setPending] = useState<{ start: number; count: number; member: string } | null>(null);
  const [point, setPoint] = useState<
    { start: number; count: number; member: string; n: number } | null>(null);
  if (!opened.current) {
    opened.current = {
      receiptItems: draft.receiptItems, receiptTip: draft.receiptTip,
      receiptTax: draft.receiptTax, receiptDiscounts: draft.receiptDiscounts,
      receiptInvolved: draft.receiptInvolved, receiptAssignments: draft.receiptAssignments,
      splitTab: draft.splitTab,
    };
  }

  // Seeded once, when the people and the scan's items are both in —
  // restore a previously saved assignment if this grid was already visited,
  // otherwise an empty grid: everyone is at the table (they are the columns
  // you tap in), and nothing is anybody's yet. Starting with every item on
  // everybody meant reading a bill you had already been told the answer to,
  // and unticking your way out of it; ticking what you had is the work this
  // screen is for, so it is what the grid asks for.
  useEffect(() => {
    if (seeded.current || items.length === 0 || people.length === 0) return;
    seeded.current = true;
    const all = new Set(people.map((m) => m.id));
    if (draft.receiptInvolved && draft.receiptAssignments?.length === items.length) {
      setInvolved(new Set(draft.receiptInvolved));
      setAssignments(draft.receiptAssignments.map((row) => new Set(row)));
    } else {
      setInvolved(all);
      setAssignments(items.map(() => new Set<string>()));
    }
  }, [people, items, draft.receiptInvolved, draft.receiptAssignments]);

  const labels = distinctInitials(people);
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
    if (!draft) return;
    setTouched(true);
    setAssignments(nextAssignments);
    save({
      ...draft,
      receiptItems: nextItems,
      receiptInvolved: [...involved],
      receiptAssignments: nextAssignments.map((row) => [...row]),
    });
  }

  /**
   * "Salad ×2" becomes two salads, each starting with whoever had the line.
   * The one press on this screen that still changes the bill: there have to be
   * rows before there is anything to assign per portion. Every press after it
   * only opens and closes the view.
   */
  function unfold(index: number) {
    if (!draft) return;
    const next = unfoldItem(items, index, draft.currency);
    if (!next) return;
    // The rows below shift down by what the line grew, and any run already
    // open down there has to travel with them.
    const grew = next.count - 1;
    setOpen((was) => {
      const now = new Set<number>();
      for (const start of was) now.add(start > index ? start + grew : start);
      now.add(index);
      return now;
    });
    commitRows(next.items, assignments.flatMap((row, i) =>
      i === index ? Array.from({ length: next.count }, () => new Set(row)) : [row]));
  }

  /** Closed and opened again — a view, so nothing is written down either way. */
  const showAsOneLine = (start: number) =>
    setOpen((was) => { const now = new Set(was); now.delete(start); return now; });
  const showPortions = (start: number) =>
    setOpen((was) => new Set(was).add(start));

  function toggleCell(itemIndex: number, memberId: string) {
    setTouched(true);
    setAssignments(assignments.map((row, i) => {
      if (i !== itemIndex) return row;
      const next = new Set(row);
      if (next.has(memberId)) next.delete(memberId); else next.add(memberId);
      return next;
    }));
  }

  /**
   * A folded run where nobody is split across its portions edits like the one
   * line it is drawn as: the tap lands on all of them at once, and the run
   * stays as trivial as it was.
   */
  function toggleRun(start: number, count: number, memberId: string, had: boolean) {
    setTouched(true);
    setAssignments(assignments.map((row, i) => {
      if (i < start || i >= start + count) return row;
      const next = new Set(row);
      if (had) next.delete(memberId); else next.add(memberId);
      return next;
    }));
  }

  /**
   * And a run that *is* split cannot: a tap on one of those cells could mean
   * either portion, so it opens the line instead of guessing. What it costs is
   * a second tap; what it buys is that the split is never quietly flattened.
   * The rest happens once the rows are on screen (`follow`).
   */
  function openForEditing(start: number, count: number, memberId: string) {
    showPortions(start);
    setPending({ start, count, member: memberId });
  }

  /**
   * The run that was just opened, brought into view whole and then pointed at.
   *
   * Two rows have to be in view, not one — the portions are the answer to
   * "which of them?" and half an answer is no answer — and when there are more
   * of them than fit, the top wins (`revealWhole`). The flash waits for the
   * scroll for the same reason the refusal's does: a pointer spent on rows
   * still travelling is a pointer nobody saw.
   */
  useEffect(() => {
    if (!pending) return;
    const box = wrap.current;
    const head = rowEl.current[pending.start];
    const tail = rowEl.current[pending.start + pending.count - 1];
    const aim = () => {
      setPoint((was) => ({ ...pending, n: (was?.n ?? 0) + 1 }));
      setPending(null);
    };
    if (!box || !head || !tail) { aim(); return; }
    const sticky = box.querySelector("thead th");
    const view = box.getBoundingClientRect();
    const reach = revealWhole(
      { top: head.getBoundingClientRect().top, bottom: tail.getBoundingClientRect().bottom },
      { top: sticky ? sticky.getBoundingClientRect().bottom : view.top, bottom: view.bottom },
    );
    const target = Math.max(0, Math.min(box.scrollTop + reach, box.scrollHeight - box.clientHeight));
    if (target === box.scrollTop) { aim(); return; }
    box.scrollTo({ top: target, behavior: calmly() ? "auto" : "smooth" });
    whenStill(box, target, aim);
  }, [pending]);

  const involvedMembers = people.filter((m) => involved.has(m.id));
  // Asked of lib/draft, not of weightsFromItems directly: what these rows are
  // worth has to be the same answer the form gives once Done has written them
  // down, and the seed that decides it is not this screen's to pick.
  const weights = receiptWeights(draft, items, assignments, involved);
  const missing = items.map((_, i) => (assignments[i]?.size ?? 0) === 0);
  // What the grid actually draws: one entry per row, which is one item —
  // or one closed run of portions read as the line it came from.
  const lines: { start: number; count: number }[] = [];
  for (let i = 0; i < items.length; ) {
    const part = runs[i];
    if (part && part.index === 1 && !open.has(part.start)) {
      lines.push({ start: part.start, count: part.of });
      i += part.of;
    } else {
      lines.push({ start: i, count: 1 });
      i++;
    }
  }
  // A drawn row is missing somebody if any of the items under it is: a folded
  // run with one unassigned portion blooms whole, because that row is all
  // there is to point at.
  const lineMissing = lines.map(
    (line) => missing.slice(line.start, line.start + line.count).some(Boolean));
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

  // Which of the bill's own charges this receipt actually has, in the order
  // their rows print — what the caption under them names (`copy.items.extraNote`).
  const tipMinor = draft.receiptTip ? minorOf(draft.receiptTip) : null;
  const extraKinds: ExtraKind[] = [
    ...(discounts.length > 0 ? ["discount" as const] : []),
    ...(taxMinor !== null ? ["tax" as const] : []),
    ...(tipMinor !== null && tipMinor > 0 ? ["tip" as const] : []),
  ];

  // A tip is a percentage of what the food actually came to, so the discounts
  // are already off it and the tax is not on it — which is how a bill prints a
  // suggested tip, and how anybody works one out in their head.
  let tipPercent: number | null = null;
  if (tipMinor !== null) {
    try {
      const ordered = receiptTotalMinor(
        items, { tip: null, tax: null, discounts: draft.receiptDiscounts ?? [] }, draft.currency) ?? 0;
      if (ordered > 0) tipPercent = Math.round((tipMinor / ordered) * 100);
    } catch { /* mid-type */ }
  }

  /**
   * The refusal, once the lines it points at can be seen.
   *
   * Nothing moves while any of them is in view — a list that jumps under
   * somebody already looking at the answer is worse than one that sits still.
   * Otherwise the nearest is scrolled to, and only then does the flash run:
   * a bloom spent while the rows are still travelling is a bloom nobody saw.
   */
  function reveal() {
    const box = wrap.current;
    // The cells are what is sticky, not the row around them (globals.css):
    // `thead`'s own box stays where the table put it, halfway up the bill.
    const head = box?.querySelector("thead th");
    const seen = lines.flatMap((line, li) => {
      const el = lineMissing[li] ? rowEl.current[line.start] : null;
      if (!el) return [];
      const { top, bottom } = el.getBoundingClientRect();
      return [{ top, bottom }];
    });
    if (!box || seen.length === 0) { refusal.refuse(); return; }
    // The header is sticky, so the top of the scroller is not where a row
    // becomes visible — it is where it goes underneath something.
    const view = box.getBoundingClientRect();
    const reach = nearestOutOfView(seen, {
      top: head ? head.getBoundingClientRect().bottom : view.top, bottom: view.bottom,
    });
    if (reach === null) { refusal.refuse(); return; }
    const target = Math.max(0, Math.min(box.scrollTop + reach, box.scrollHeight - box.clientHeight));
    if (target === box.scrollTop) { refusal.refuse(); return; }
    setSeeking(true);
    box.scrollTo({ top: target, behavior: calmly() ? "auto" : "smooth" });
    whenStill(box, target, () => { setSeeking(false); refusal.refuse(); });
  }

  function finish() {
    // Never held grey: a Done that can't go through points at what is missing
    // rather than sitting dead with a sentence beside it (design-system.md).
    if (!canFinish) {
      setTold(true);
      // The flash lives on the lines, so there has to be one to put it on:
      // the button is spent until that animation ends, and waiting on one
      // that never runs would leave it spent for good.
      if (!refusal.live && !seeking && missing.some(Boolean)) reveal();
      return;
    }
    // This screen owns only the raw grid: who was there, and who had what.
    // The total and the split it implies are derived from these fields
    // wherever they're needed (the expense form's render, and its save) —
    // not written down here too, so there's nothing that can drift out of
    // sync with them (ADR-0016). Keep receiptItems/receiptTip and the raw
    // assignment around (unlike a discarded scan) so "Edit who-had-what" can
    // reopen this exact grid later, on any device. ADR-0016.
    save({
      ...draft,
      receiptInvolved: [...involved],
      receiptAssignments: assignments.map((row) => [...row]),
      splitTab: "receipt",
    });
    onDone();
  }

  /** Leaving undoes what this screen wrote; `finish` is the only way to keep it. */
  function mayLeave() {
    if (touched) { setAsking(true); return false; }
    return true;
  }

  function discard() {
    if (opened.current) save({ ...draft, ...opened.current });
    onBack();
  }

  // One line under the grid at a time: what a refused Done was pointing at, or
  // — until the control has been found once — what the ×N does. The sentence
  // waits for the refusal that earns it: on arrival nothing is assigned yet, so
  // printing it then scolds a grid for being untouched. A control you've used
  // doesn't need explaining either, and the footer is one line tall.
  // The gentle pointer's restart, the refusal flash's trick exactly
  // (lib/refusal.ts): two identical animations, so a second one replays.
  const pointClass = point ? (point.n % 2 === 1 ? " point-a" : " point-b") : "";

  const note = told && !everyItemAssigned ? (
    <div className="footnote bad">{copy.items.needsSomeone}</div>
  ) : canUnfoldSomething && runs.every((r) => r === null) ? (
    <div className="footnote">
      {copy.items.unfoldHint.before} <b>×N</b> {copy.items.unfoldHint.after}
    </div>
  ) : null;

  return (
    <Screen>
      <Body>
        <TopBar title={title} back={{ ask: mayLeave }} />

        {/* Three bands, not one scrolling page: who was there stays put at the
            top, the running totals at the foot, and the grid in between owns
            the scroll — which is what lets its initials row freeze while a long
            bill scrolls under it. A twenty-line receipt is the case this screen
            exists for, and the column you're tapping in has to keep its name. */}
        <div className="itemhead">
          <div className="eyebrow" style={{ marginBottom: 8 }}>{copy.items.whoWasThere}</div>
          <div className="whostrip">
            {people.map((m) => (
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

        <div className="itemtablewrap" ref={wrap}>
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
              {lines.map((line, li) => {
                const item = items[line.start];
                if (!item) return null;
                // A closed run is drawn as the line it came from, which is a
                // reading of the rows rather than a replacement for them.
                const folded = line.count > 1;
                const shown = (folded && foldedLine(items, line.start, line.count, draft.currency)) || item;
                const run = folded
                  ? runAssignment(assignments.slice(line.start, line.start + line.count)) : null;
                const part = folded ? null : runs[line.start] ?? null;
                const into = folded || part ? null : unfoldableInto(item, draft.currency);
                return (
                  <tr key={line.start} className={part ? "part" : undefined}
                    ref={(el) => { rowEl.current[line.start] = el; }}>
                    <td className="itemlabel">
                      <div className="itemrow">
                        {/* A line nobody has been given blooms with the
                            refusal — name and amount, which is how you find
                            it again in twenty rows of bill. */}
                        <span className={`itemtext${lineMissing[li] ? refusal.flash : ""}`}
                          onAnimationEnd={refusal.onFlashEnd}>
                          <span className="itemname">
                            {shown.label}
                            {/* The printed count, but only where the button
                                below isn't already carrying it. */}
                            {!folded && !part && into === null && item.quantity && item.quantity > 1 ? (
                              <span className="itemqty"> ×{item.quantity}</span>
                            ) : null}
                          </span>
                          {/* Which portion this is goes on the amount line:
                              the label's own line has a button to share
                              with and a name of any length in it. */}
                          <span className="itemamount">
                            {shown.amount}
                            {part ? <span className="itemqty"> · {copy.items.portion(part.index, part.of)}</span> : null}
                          </span>
                        </span>
                        {/* One button, one meaning: show the portions, or show
                            them as one line. Only the first press of all —
                            on a line the receipt printed a count for — also
                            splits the bill into the rows to assign. */}
                        {folded ? (
                          <button className="itemfold" onClick={() => showPortions(line.start)}
                            title={copy.items.showPortions(line.count)}
                            aria-label={copy.items.openItem(item.label, line.count)}
                            aria-expanded={false}>
                            ×{line.count}<Icon name="split" size={12} />
                          </button>
                        ) : into !== null ? (
                          <button className="itemfold" onClick={() => unfold(line.start)}
                            title={copy.items.splitInto(into)}
                            aria-label={copy.items.splitItem(item.label, into)}>
                            ×{into}<Icon name="split" size={12} />
                          </button>
                        ) : part && part.index === 1 ? (
                          <button className="itemfold on" onClick={() => showAsOneLine(part.start)}
                            title={copy.items.mergeBack}
                            aria-label={copy.items.mergeItem(item.label, part.of)}
                            aria-expanded={true}>
                            ×{part.of}<Icon name="merge" size={12} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                    {involvedMembers.map((m) => {
                      // What this cell shows: nothing, a dot, or the split mark
                      // a folded run wears while somebody is on some of it.
                      const mark = run
                        ? run.marks.get(m.id) ?? null
                        : assignments[line.start]?.has(m.id) ? "all" : null;
                      const aimed = point && point.member === m.id
                        && line.start >= point.start && line.start < point.start + point.count;
                      return (
                        <td key={m.id}>
                          <button className={`itemcell${aimed ? pointClass : ""}`}
                            onAnimationEnd={() => setPoint(null)}
                            onClick={() => (run?.detailed
                              ? openForEditing(line.start, line.count, m.id)
                              : folded
                                ? toggleRun(line.start, line.count, m.id, mark === "all")
                                : toggleCell(line.start, m.id))}
                            aria-pressed={mark === "some" ? "mixed" : mark === "all"}
                            aria-label={folded
                              ? (run?.detailed
                                ? copy.items.hadSome(m.name, item.label, line.count)
                                : copy.items.hadAll(m.name, item.label, line.count))
                              : part
                                ? copy.items.hadPortion(m.name, item.label, part.index, part.of)
                                : copy.items.had(m.name, item.label)}>
                            {/* The empty cells carry a dot too, invisible until
                                something points at this column: what a person
                                is being shown is where their answer would go,
                                so the pointer has to be the shape of one. */}
                            <span className={`dot${mark === "some" ? " some" : mark ? "" : " off"}`} />
                          </button>
                        </td>
                      );
                    })}
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
                          title={openDiscounts
                            ? copy.items.mergeDiscounts(row.of) : copy.items.splitDiscounts(row.of)}
                          aria-label={openDiscounts
                            ? copy.items.mergeDiscounts(row.of) : copy.items.splitDiscounts(row.of)}
                          aria-expanded={openDiscounts}>
                          ×{row.of}<Icon name={openDiscounts ? "merge" : "split"} size={12} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                  {involvedMembers.map((m) => (
                    <td key={m.id}><span className="itemcell ghost"><span className="dot" /></span></td>
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
                    <td key={m.id}><span className="itemcell ghost"><span className="dot" /></span></td>
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
                        save({ ...draft, receiptTip: text || null });
                      }} />
                    <Icon name="edit" size={11} className="tipedit" />
                  </span>
                  {draft.receiptTip ? null : <span className="tiphint">{copy.items.tipHint}</span>}
                </td>
                {involvedMembers.map((m) => <td key={m.id}><span className="itemcell ghost"><span className="dot" /></span></td>)}
              </tr>
              {/* Why the rows above have no cells to tap. Under them rather
                  than in the footer: the footer's line is what to do next,
                  and this is what the grid is already doing. */}
              {extraKinds.length > 0 ? (
                <tr className="itemnote">
                  <td colSpan={1 + involvedMembers.length}>{copy.items.extraNote(extraKinds)}</td>
                </tr>
              ) : null}
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
                  <span className="amt">{format(weights[m.id] ?? 0)}</span>
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
            onClick={finish} disabled={refusal.live || seeking} {...keepsFocus}>
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
