"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { parseMinor, type ExtraKind } from "@bida/core";
import { AmountInput } from "./amount-input";
import { keepsFocus } from "./bits";
import { Body, Screen, TopBar } from "./chrome";
import { ConfirmDialog } from "./dialog";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { useRefusal } from "../lib/refusal";
import { nearestOutOfView, revealWhole, scrollTarget } from "../lib/reveal";
import { glide } from "../lib/seek";
import { bare, distinctInitials, priced } from "../lib/format";
import { receiptWeights, type EntryDraft } from "../lib/draft";
import {
  billLabel, foldedLine, hasTranslation, portions, receiptTotalMinor, runAssignment,
  unfoldAll,
} from "../lib/scan/items";
import { useBillEnglish } from "../lib/hooks";
import { setBillEnglish } from "../lib/db/device";

/**
 * The floor under how long the pointed column stays faint. The scroll is
 * usually longer and sets the pace; this keeps a run already in view from
 * opening and resolving in one frame.
 */
const HOLD_MS = 280;

/** Whether a drawn row and column are the ones being pointed at. */
const inColumn = (
  at: { start: number; count: number; member: string } | null,
  start: number,
  memberId: string,
) => !!at && at.member === memberId && start >= at.start && start < at.start + at.count;

/**
 * Who had what: the grid a scanned bill is assigned on (ADR-0016).
 *
 * Worn by `/g/entry/items` and by `/quick/items`
 * ([ADR-0035](../../docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md)).
 * **Neither owns it** — two copies of this arithmetic would disagree, and the
 * cent it hands out is the cent the next screen quotes (`receiptWeights`). The
 * props are exactly what the two differ in: the columns, how a figure prints,
 * where Done goes. Assumes a bill with lines on it.
 */
export function WhoHadWhat({
  title, people, draft, save, format, saysCurrency = true, onDone, onBack,
}: {
  title: string;
  /** The columns: everybody who might have been at this table. */
  people: readonly { id: string; name: string }[];
  draft: EntryDraft;
  /** Writes the draft back — the grid's rows and the bill's lines are one list. */
  save: (draft: EntryDraft) => void;
  format: (minor: number) => string;
  /**
   * Whether the currency may be *said*. A quick split prints no symbol
   * ([ADR-0035](../../../docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md)),
   * so the tip field's label must not name one to a screen reader either.
   */
  saysCurrency?: boolean;
  /** Done, with the grid written down. */
  onDone: () => void;
  /** Left without keeping it; the bill has been put back as it was found. */
  onBack: () => void;
}) {
  const items = draft.receiptItems ?? [];
  // Which language the bill's own words are read in. Device-local and
  // remembered, so the expense this grid saves reads the same way afterwards
  // (`billLabel`). **Never applied to `items` itself** — the labels on the
  // draft are the bill's, and splitting a line writes them back.
  const english = useBillEnglish();
  const said = (line: { label: string; labelEn?: string | null }) => billLabel(line, english);
  const [involved, setInvolved] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<Set<string>[]>([]);
  const seeded = useRef(false);
  const [asking, setAsking] = useState(false);
  // Whether the deductions are showing one by one or as one figure. Display
  // only — it changes nothing the bill is worth, so nothing is written down.
  const [openDiscounts, setOpenDiscounts] = useState(false);
  // The grid's rows and the bill's lines are one list, and an older bill's
  // lines are split into portions on the draft as the grid opens (the seeding
  // effect). **So keep what was found and put it back on the way out.**
  const opened = useRef<Pick<EntryDraft,
    "receiptItems" | "receiptTip" | "receiptTax" | "receiptDiscounts"
    | "receiptInvolved" | "receiptAssignments" | "splitTab"> | null>(null);
  const [touched, setTouched] = useState(false);
  // A refused Done blooms every line with nobody on it, off one refusal, so a
  // second press replays them together; Done greys for the flash. The sentence
  // stays until the grid is finishable. **A bloom off screen is no signal**:
  // the nearest unassigned line is scrolled in first and the flash waits for it
  // (`reveal`), with Done spent across both.
  const refusal = useRefusal();
  const [seeking, setSeeking] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  /** Every drawn row, by the item it starts at — a folded run is one row. */
  const rowEl = useRef<(HTMLTableRowElement | null)[]>([]);
  const [told, setTold] = useState(false);
  // Which runs of portions are drawn open, by the item index they start at.
  // Folding is only a view (`foldedLine`): the bill holds its portions from the
  // start (`unfoldAll`), so which portion was whose is never thrown away. A
  // restored draft starts with every run folded.
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

  // Seeded once, when people and items are both in: a saved assignment if there
  // is one, otherwise everyone at the table and nothing assigned. **Never start
  // with every item on everybody** — that is unticking your way out of an answer.
  useEffect(() => {
    if (seeded.current || items.length === 0 || people.length === 0) return;
    seeded.current = true;
    const saved = draft.receiptInvolved && draft.receiptAssignments?.length === items.length
      ? draft.receiptAssignments : null;
    setInvolved(new Set(saved ? draft.receiptInvolved : people.map((m) => m.id)));
    const rows = saved ? saved.map((row) => new Set(row)) : items.map(() => new Set<string>());
    // A bill arrives with its lines of several already in portions
    // (`unfoldAll`); one saved before that did not is split here, each portion
    // starting with whoever had the line. Written straight away, since the
    // grid's rows and the bill's lines are one list — and the history reads it
    // as the same bill (`printedBill`), so it is no edit anybody sees.
    const split = unfoldAll(items, draft.currency);
    if (split.items.length === items.length) { setAssignments(rows); return; }
    const widened = split.from.map((i) => new Set(rows[i]));
    setAssignments(widened);
    save({
      ...draft,
      receiptItems: split.items,
      ...(saved ? { receiptAssignments: widened.map((row) => [...row]) } : {}),
    });
  }, [people, items, draft, save]);

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

  /** Closed and opened again — a view, so nothing is written down either way. */
  const showAsOneLine = (start: number) => {
    // The pointed cells go with the rows, and an animation removed mid-flight
    // reports nothing: drop the point rather than leave it to be replayed on
    // whatever opens next.
    setPoint(null);
    setOpen((was) => { const now = new Set(was); now.delete(start); return now; });
  };
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
   * The line itself, tapped: everybody had it, or nobody did.
   *
   * **It overwrites**, including a folded run somebody is split across, which
   * `toggleRun` refuses — that refusal is about a *cell*, where the tap could
   * mean either portion.
   */
  function toggleEveryone(start: number, count: number) {
    const ids = involvedMembers.map((m) => m.id);
    if (ids.length === 0) return;
    setTouched(true);
    const everyone = assignments.slice(start, start + count)
      .every((row) => ids.every((id) => row.has(id)));
    setAssignments(assignments.map((row, i) =>
      i < start || i >= start + count ? row : new Set(everyone ? [] : ids)));
  }

  /**
   * A folded run nobody is split across edits like the one line it is drawn as.
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
   * A run that *is* split opens instead of guessing which portion a tap meant,
   * so the split is never quietly flattened. The rest is `follow`'s.
   */
  function openForEditing(start: number, count: number, memberId: string) {
    showPortions(start);
    setPending({ start, count, member: memberId });
  }

  /**
   * The run just opened, brought into view whole and then pointed at.
   * **Two rows in view, not one** — and when more than fit, the top wins
   * (`revealWhole`). The flash waits for the scroll, like the refusal's.
   */
  useEffect(() => {
    if (!pending) return;
    const box = wrap.current;
    const head = rowEl.current[pending.start];
    const tail = rowEl.current[pending.start + pending.count - 1];
    // The column was painted faint with the rows (`point-hold`), so `aim` is
    // the *release*: the dots ease back to what they really are. **Never sooner
    // than `HOLD_MS`**, or a run that needed no scrolling resolves in one frame.
    const since = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const aim = () => {
      timer = setTimeout(() => {
        setPoint((was) => ({ ...pending, n: (was?.n ?? 0) + 1 }));
        setPending(null);
      }, Math.max(0, HOLD_MS - (Date.now() - since)));
    };
    let cancelGlide: (() => void) | undefined;
    const stop = () => { clearTimeout(timer); cancelGlide?.(); };
    if (!box || !head || !tail) { aim(); return stop; }
    const sticky = box.querySelector("thead th");
    const view = box.getBoundingClientRect();
    const reach = revealWhole(
      { top: head.getBoundingClientRect().top, bottom: tail.getBoundingClientRect().bottom },
      { top: sticky ? sticky.getBoundingClientRect().bottom : view.top, bottom: view.bottom },
    );
    const target = scrollTarget(box, reach);
    if (target === box.scrollTop) { aim(); return stop; }
    cancelGlide = glide(box, target, aim);
    return stop;
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
  // Whether anything is left to bloom at all. Kept in a ref as well, because a
  // scroll that finishes after the grid was fixed would otherwise start a
  // refusal off a stale reading of it.
  const blooms = missing.some(Boolean);
  const stillBlooms = useRef(blooms);
  stillBlooms.current = blooms;

  /**
   * A refusal whose lines stopped being refused. Assigning the last of them
   * during the flash takes the class off every element carrying it, and a
   * removed animation never fires `animationend` — so Done would stay greyed
   * for good (lib/refusal.ts).
   */
  useEffect(() => {
    if (refusal.live && !blooms) refusal.onFlashEnd();
  }, [refusal, blooms]);
  const everyItemAssigned = assignments.length === items.length && assignments.every((r) => r.size > 0);
  const canFinish = involvedMembers.length > 0 && everyItemAssigned && Object.keys(weights).length > 0;
  // The extras the bill printed, in the order it printed them, and signed the
  // way they are worth: a deduction is the one figure on this screen that comes
  // off. The tip is not among them — it is typed, and has its own row.
  const minorOf = (amount: string) => {
    try { return parseMinor(amount, draft.currency); } catch { return null; }
  };
  const discounts = (draft.receiptDiscounts ?? []).flatMap((d) => {
    const minor = minorOf(d.amount);
    return minor === null || minor <= 0 ? [] : [{ label: said(d), minor: -minor }];
  });
  const taxMinor = draft.receiptTax ? minorOf(draft.receiptTax) : null;
  // Several deductions collapse into one row the way repeated items do: the
  // printed names are worth reading, but four above the tip bury the bill.
  // Display only — not assignable, so never written to the draft.
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
   * The refusal, once the lines it points at can be seen. **Nothing moves while
   * any of them is in view**; otherwise the nearest is scrolled to, then the
   * flash runs.
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
    const target = scrollTarget(box, reach);
    if (target === box.scrollTop) { refusal.refuse(); return; }
    setSeeking(true);
    glide(box, target, () => {
      setSeeking(false);
      // Fixed while the list was still travelling: there is nothing left to
      // point at, and a refusal with nothing blooming never ends itself.
      if (stillBlooms.current) refusal.refuse();
    });
  }

  function finish() {
    // Never held grey: a Done that can't go through points at what is missing
    // rather than sitting dead with a sentence beside it (design-system.md).
    if (!canFinish) {
      setTold(true);
      // The flash needs a line to run on: Done is spent until it ends, and one that
      // never runs would leave it spent for good.
      if (!refusal.live && !seeking && missing.some(Boolean)) reveal();
      return;
    }
    // **This screen writes only the raw grid**: who was there and who had what.
    // The total and split are derived where needed (the form's render and save),
    // so nothing drifts. The items, tip and assignment are kept so "Edit
    // who-had-what" reopens this grid later, on any device. ADR-0016.
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

  // What a refused Done was pointing at. **The sentence waits for the refusal
  // that earns it** — on arrival nothing is assigned yet. The pointer restarts
  // by the refusal's two-name trick (lib/refusal.ts).
  const pointClass = point ? (point.n % 2 === 1 ? " point-a" : " point-b") : "";

  // The bar's one control: the bill in its own words, or in English. Only where
  // the model had something to translate (`hasTranslation`).
  const translate = hasTranslation(items, draft.receiptDiscounts) ? (
    <button type="button" className={`iconbtn${english ? " lit" : ""}`}
      onClick={() => void setBillEnglish(!english)} {...keepsFocus}
      aria-pressed={english} title={copy.items.translate[english ? "off" : "on"]}
      aria-label={copy.items.translate[english ? "off" : "on"]}>
      <Icon name="translate" size={17} />
    </button>
  ) : null;

  const note = told && !everyItemAssigned ? (
    <div className="footnote bad">{copy.items.needsSomeone}</div>
  ) : null;

  return (
    <Screen>
      <Body>
        <TopBar title={title} back={{ ask: mayLeave }} right={translate} />

        {/* One scroller: who was there, the grid and the totals pass through
            it together. What stays put is what you work against: the initials
            row and the names column (globals.css). */}
        <div className="itemscroll" ref={wrap}>
          <div className="itemhead itemwide">
            <div className="eyebrow" style={{ marginBottom: 8 }}>{copy.items.whoWasThere}</div>
            <div className="whostrip">
              {people.map((m) => (
                <button key={m.id} onClick={() => toggleInvolved(m.id)} {...keepsFocus}
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

          <table className="itemtable"
            style={{ "--cols": involvedMembers.length } as CSSProperties}>
            {/* Where the widths are decided, once — see `table-layout: fixed`
                in globals.css. Nothing in a row can move them after this. */}
            <colgroup>
              <col className="collabel" />
              {involvedMembers.map((m) => <col key={m.id} className="colwho" />)}
            </colgroup>
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
                // A line nobody has been given blooms whole, across every column
                // (globals.css). The listener is on the row because the animation runs
                // on the cells and `animationend` bubbles up.
                return (
                  <tr key={line.start} ref={(el) => { rowEl.current[line.start] = el; }}
                    onAnimationEnd={refusal.onFlashEnd}
                    className={`${part ? "part" : ""}${lineMissing[li] ? refusal.flash : ""}` || undefined}>
                    <td className="itemlabel">
                      <div className="itemrow">
                        {/* "Everybody had this" / "nobody did" (`toggleEveryone`): the name is
                            the row's one target that isn't a person's column. */}
                        <button type="button" className="itemtext" {...keepsFocus}
                          onClick={() => toggleEveryone(line.start, folded ? line.count : 1)}
                          aria-label={copy.items.everyone(said(shown))}>
                          <span className="itemname">
                            {said(shown)}
                            {/* The printed count, where no fold button below is
                                carrying it: a count that can't be portioned. */}
                            {!folded && !part && item.quantity && item.quantity > 1 ? (
                              <span className="itemqty"> ×{item.quantity}</span>
                            ) : null}
                          </span>
                          {/* Which portion this is goes on the amount line:
                              the label's own line has a button to share
                              with and a name of any length in it. */}
                          <span className="itemamount">
                            {priced(shown.amount, draft.currency)}
                            {part ? <span className="itemqty"> · {copy.items.portion(part.index, part.of)}</span> : null}
                          </span>
                        </button>
                        {/* Show the portions, or show them as one line — a view
                            either way, since the bill holds them split. */}
                        {folded ? (
                          <button className="itemfold" onClick={() => showPortions(line.start)} {...keepsFocus}
                            title={copy.items.showPortions(line.count)}
                            aria-label={copy.items.openItem(said(item), line.count)}
                            aria-expanded={false}>
                            ×{line.count}<Icon name="split" size={12} />
                          </button>
                        ) : part && part.index === 1 ? (
                          <button className="itemfold on" onClick={() => showAsOneLine(part.start)} {...keepsFocus}
                            title={copy.items.mergeBack}
                            aria-label={copy.items.mergeItem(said(item), part.of)}
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
                      // Faint from the moment the rows appear, and eased back
                      // once they have stopped moving: a column that paints at
                      // full strength and is dimmed a beat later flickers.
                      const held = inColumn(pending, line.start, m.id);
                      const aimed = inColumn(point, line.start, m.id);
                      return (
                        <td key={m.id} className="itemwho">
                          <button className={`itemcell${held ? " point-hold" : aimed ? pointClass : ""}`}
                            // Stopped here: the refusal listens for its flash on the row, and a
                            // pointer settling inside would read as that flash ending — handing
                            // Done back mid-bloom (docs/design-system.md).
                            onAnimationEnd={(e) => { e.stopPropagation(); setPoint(null); }}
                            {...keepsFocus}
                            onClick={() => (run?.detailed
                              ? openForEditing(line.start, line.count, m.id)
                              : folded
                                ? toggleRun(line.start, line.count, m.id, mark === "all")
                                : toggleCell(line.start, m.id))}
                            aria-pressed={mark === "some" ? "mixed" : mark === "all"}
                            aria-label={folded
                              ? (run?.detailed
                                ? copy.items.hadSome(m.name, said(item), line.count)
                                : copy.items.hadAll(m.name, said(item), line.count))
                              : part
                                ? copy.items.hadPortion(m.name, said(item), part.index, part.of)
                                : copy.items.had(m.name, said(item))}>
                            {/* Empty cells carry an invisible dot, so a pointer at this column
                                shows where an answer would go. */}
                            <span className={`dot${mark === "some" ? " some" : mark ? "" : " off"}`} />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {/* What the bill took off and added on. Nobody ordered them, so they
                  follow what everybody did order (`receiptBreakdown`). */}
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
                          onClick={() => setOpenDiscounts(!openDiscounts)} {...keepsFocus}
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
                  {/* The one figure here that is typed, so it is drawn as a field. */}
                  <span className="tipfield">
                    {/* `AmountInput`, like every other typed figure: a bare
                        input took "5.5.5" and kept showing it while
                        `receiptTotalMinor` quietly dropped it from the total. */}
                    <AmountInput className="itemamountin" frame="none"
                      enterKeyHint="done"
                      currency={draft.currency} placeholder={bare(0, draft.currency)}
                      aria-label={copy.items.tipLabel(saysCurrency ? draft.currency : null)}
                      value={draft.receiptTip ?? ""}
                      onChange={(text) => {
                        setTouched(true);
                        save({ ...draft, receiptTip: text || null });
                      }} />
                    <Icon name="edit" size={11} className="tipedit" />
                  </span>
                </td>
                {involvedMembers.map((m) => <td key={m.id}><span className="itemcell ghost"><span className="dot" /></span></td>)}
              </tr>
            </tbody>
          </table>

          {/* Why the rows above have no cells. A block under the table, not its
              last row: a sentence in a cell wraps at the table's width. */}
          {extraKinds.length > 0 ? (
            <div className="itemnote itemwide">{copy.items.extraNote(extraKinds)}</div>
          ) : null}

          {/* What the grid adds up to, one name per line, at the end of the
              scroll. */}
          {involvedMembers.length > 0 ? (
            <div className="itemtotals itemwide">
              <div className="totalstrip">
                {involvedMembers.map((m) => (
                  <div key={m.id} className="tot" aria-label={copy.items.share(m.name)}>
                    <span className="who">{m.name}</span>
                    <span className="amt">{format(weights[m.id] ?? 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="itemfoot">
          {note}
          {/* The one thing that doesn't scroll: the way out. Its band pays `--kb`
              for the tip being typed above it. */}
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
