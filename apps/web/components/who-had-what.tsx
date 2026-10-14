"use client";
// Doc: docs/who-had-what.md#the-grid

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { parseMinor, type ExtraKind } from "@bida/core";
import { AmountInput } from "./amount-input";
import { Body, Screen, TopBar } from "./chrome";
import { ConfirmDialog } from "./dialog";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { useRefusal } from "../lib/refusal";
import { revealWhole, scrollTarget, seekTarget } from "../lib/reveal";
import { glide } from "../lib/seek";
import { bare, distinctInitials, priced } from "../lib/format";
import { receiptBill, type EntryDraft } from "../lib/draft";
import {
  billLabel, foldedLine, hasTranslation, portions, receiptTotalMinor, runAssignment,
  unfoldAll,
} from "../lib/scan/items";

/**
 * The floor under how long the pointed column stays faint, so a run already in
 * view doesn't open and resolve in one frame.
 */
const HOLD_MS = 280;

const inColumn = (
  at: { start: number; count: number; member: string } | null,
  start: number,
  memberId: string,
) => !!at && at.member === memberId && start >= at.start && start < at.start + at.count;

/**
 * The grid a scanned bill is assigned on (ADR-0016), worn by `/g/entry/items` and
 * `/quick/items`. **Neither owns it** — two copies would disagree on a cent; the
 * props are what the two differ in.
 */
export function WhoHadWhat({
  title, people, draft, save, format, saysCurrency = true, onDone, onBack, leaving,
}: {
  title: string;
  people: readonly { id: string; name: string }[];
  draft: EntryDraft;
  save: (draft: EntryDraft) => void;
  format: (minor: number) => string;
  /**
   * A quick split prints no symbol, so the tip's label must not name one to a
   * screen reader either.
   */
  saysCurrency?: boolean;
  onDone: () => void;
  onBack: () => void;
  /**
   * Asks before every way back: a quick split's screen behind can only scan
   * again.
   */
  leaving?: { title: string; body: string };
}) {
  const items = draft.receiptItems ?? [];
  // The draft's, so the saved expense reads the same on every phone. **Never
  // applied to `items` itself** — splitting a line writes the labels back.
  const english = draft.receiptEnglish === true;
  const said = (line: { label: string; labelEn?: string | null }) => billLabel(line, english);
  const [involved, setInvolved] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<Set<string>[]>([]);
  const seeded = useRef(false);
  const [asking, setAsking] = useState(false);
  const [openDiscounts, setOpenDiscounts] = useState(false);
  // Older bills are split into portions as the grid opens: **keep what was found
  // and put it back on the way out.**
  const opened = useRef<Pick<EntryDraft,
    "receiptItems" | "receiptTip" | "receiptTax" | "receiptDiscounts"
    | "receiptInvolved" | "receiptAssignments" | "splitTab"> | null>(null);
  const [touched, setTouched] = useState(false);
  // One refusal blooms every unassigned line; one off screen is scrolled to first
  // (`reveal`).
  const refusal = useRefusal();
  const [seeking, setSeeking] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const rowEl = useRef<(HTMLTableRowElement | null)[]>([]);
  const [told, setTold] = useState(false);
  // Folding is only a view (`foldedLine`): the bill holds its portions from the
  // start (`unfoldAll`).
  const [open, setOpen] = useState<Set<number>>(new Set());
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

  // **Never start with every item on everybody** — that is unticking your way out
  // of an answer.
  useEffect(() => {
    if (seeded.current || items.length === 0 || people.length === 0) return;
    seeded.current = true;
    const saved = draft.receiptInvolved && draft.receiptAssignments?.length === items.length
      ? draft.receiptAssignments : null;
    // Somebody removed since was only ticked as there — a line would have kept
    // them (`expenseInvolves`) — so they leave the bill with their chip.
    const here = people.map((m) => m.id);
    setInvolved(new Set(saved ? (draft.receiptInvolved ?? []).filter((id) => here.includes(id)) : here));
    const rows = saved ? saved.map((row) => new Set(row)) : items.map(() => new Set<string>());
    // Written straight away; history reads it as the same bill (`printedBill`).
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

  // Taking somebody out takes back their items, since a hidden column can't be
  // corrected. The last one there can't be taken away.
  function toggleInvolved(memberId: string) {
    const adding = !involved.has(memberId);
    if (!adding && involved.size === 1) return;
    setTouched(true);
    const nextInvolved = new Set(involved);
    if (adding) nextInvolved.add(memberId); else nextInvolved.delete(memberId);
    setInvolved(nextInvolved);
    if (adding) return;
    setAssignments(assignments.map((row) => {
      const next = new Set(row);
      next.delete(memberId);
      return next;
    }));
  }

  const showAsOneLine = (start: number) => {
    // An animation removed mid-flight reports nothing: drop the point rather than
    // replay it on whatever opens next.
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
   * **It overwrites**, including a run somebody is split across, which a cell
   * refuses — there the tap could mean either portion.
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

  function toggleRun(start: number, count: number, memberId: string, had: boolean) {
    setTouched(true);
    setAssignments(assignments.map((row, i) => {
      if (i < start || i >= start + count) return row;
      const next = new Set(row);
      if (had) next.delete(memberId); else next.add(memberId);
      return next;
    }));
  }

  /** Opens rather than guessing which portion a tap meant. */
  function openForEditing(start: number, count: number, memberId: string) {
    showPortions(start);
    setPending({ start, count, member: memberId });
  }

  /** Two rows in view, not one; past that the top wins. */
  useEffect(() => {
    if (!pending) return;
    const box = wrap.current;
    const head = rowEl.current[pending.start];
    const tail = rowEl.current[pending.start + pending.count - 1];
    // **Never sooner than `HOLD_MS`**, or a run that needed no scrolling resolves
    // in one frame.
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
  // Of lib/draft, not receiptBreakdown: the seed that decides the cent is not
  // this screen's to pick.
  const { weights } = receiptBill(draft, items, assignments, involved);
  const missing = items.map((_, i) => (assignments[i]?.size ?? 0) === 0);
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
  const lineMissing = lines.map(
    (line) => missing.slice(line.start, line.start + line.count).some(Boolean));
  // In a ref too: a scroll finishing after the grid was fixed would refuse off a
  // stale reading.
  const blooms = missing.some(Boolean);
  const stillBlooms = useRef(blooms);
  stillBlooms.current = blooms;

  /**
   * Assigning the last line mid-flash removes the class, and a removed animation
   * never fires `animationend` — Done would stay greyed for good.
   */
  useEffect(() => {
    if (refusal.live && !blooms) refusal.onFlashEnd();
  }, [refusal, blooms]);
  const everyItemAssigned = assignments.length === items.length && assignments.every((r) => r.size > 0);
  const canFinish = involvedMembers.length > 0 && everyItemAssigned && Object.keys(weights).length > 0;
  // A deduction is the one figure here that comes off. The tip is typed, and has
  // its own row.
  const minorOf = (amount: string) => {
    try { return parseMinor(amount, draft.currency); } catch { return null; }
  };
  const discounts = (draft.receiptDiscounts ?? []).flatMap((d) => {
    const minor = minorOf(d.amount);
    return minor === null || minor <= 0 ? [] : [{ label: said(d), minor: -minor }];
  });
  const taxMinor = draft.receiptTax ? minorOf(draft.receiptTax) : null;
  // Display only — never written to the draft.
  const discountTotal = discounts.reduce((sum, d) => sum + d.minor, 0);
  const discountRows = discounts.length > 1 && !openDiscounts
    ? [{ label: "", minor: discountTotal, of: discounts.length }]
    : discounts.map((d) => ({ ...d, of: discounts.length > 1 ? discounts.length : 0 }));

  const tipMinor = draft.receiptTip ? minorOf(draft.receiptTip) : null;
  const extraKinds: ExtraKind[] = [
    ...(discounts.length > 0 ? ["discount" as const] : []),
    ...(taxMinor !== null ? ["tax" as const] : []),
    ...(tipMinor !== null && tipMinor > 0 ? ["tip" as const] : []),
  ];

  // A tip is a percentage of what the food came to: discounts off, tax not on —
  // as a bill prints one.
  let tipPercent: number | null = null;
  if (tipMinor !== null) {
    try {
      const ordered = receiptTotalMinor(
        items, { tip: null, tax: null, discounts: draft.receiptDiscounts ?? [] }, draft.currency) ?? 0;
      if (ordered > 0) tipPercent = Math.round((tipMinor / ordered) * 100);
    } catch { /* mid-type */ }
  }

  /** **Nothing moves while any of them is in view.** */
  function reveal() {
    const box = wrap.current;
    // The cells are sticky, not the row: `thead`'s own box stays where the table
    // put it.
    const head = box?.querySelector("thead th");
    const aimed = lines.flatMap((line, li) => {
      const el = lineMissing[li] ? rowEl.current[line.start] : null;
      return el ? [el] : [];
    });
    if (!box) { refusal.refuse(); return; }
    const view = box.getBoundingClientRect();
    const target = seekTarget(box, aimed, {
      top: head ? head.getBoundingClientRect().bottom : view.top, bottom: view.bottom,
    });
    if (target === null) { refusal.refuse(); return; }
    setSeeking(true);
    glide(box, target, () => {
      setSeeking(false);
      // Fixed mid-travel: a refusal with nothing blooming never ends itself.
      if (stillBlooms.current) refusal.refuse();
    });
  }

  function finish() {
    if (!canFinish) {
      setTold(true);
      // Done is spent until the flash ends; one that never runs would spend it
      // for good.
      if (!refusal.live && !seeking && missing.some(Boolean)) reveal();
      return;
    }
    // **This screen writes only the raw grid**; the total and split are derived
    // where needed, so nothing drifts. ADR-0016.
    save({
      ...draft,
      receiptInvolved: [...involved],
      receiptAssignments: assignments.map((row) => [...row]),
      splitTab: "receipt",
    });
    onDone();
  }

  function mayLeave() {
    if (touched || leaving) { setAsking(true); return false; }
    return true;
  }

  function discard() {
    if (opened.current) save({ ...draft, ...opened.current });
    onBack();
  }

  // **The sentence waits for the refusal that earns it** — on arrival nothing is
  // assigned yet.
  const pointClass = point ? (point.n % 2 === 1 ? " point-a" : " point-b") : "";

  const translate = hasTranslation(items, draft.receiptDiscounts) ? (
    <button type="button" className={`iconbtn${english ? " lit" : ""}`}
      // Not a touch: a way of reading the bill, which leaving keeps.
      onClick={() => save({ ...draft, receiptEnglish: english ? null : true })}
      aria-pressed={english} title={copy.items.translate[english ? "off" : "on"]}
      aria-label={copy.items.translate[english ? "off" : "on"]}>
      <Icon name="translate" size={17} />
    </button>
  ) : null;

  const note = told && !everyItemAssigned ? (
    <div role="status" style={{ marginBottom: 9 }}
      className={`splitfoot bad alone${refusal.flash}`} onAnimationEnd={refusal.onFlashEnd}>
      <span>{copy.items.needsSomeone}</span>
    </div>
  ) : null;

  return (
    <Screen>
      <Body>
        <TopBar title={title} back={{ ask: mayLeave }} right={translate} />

        <div className="itemscroll" ref={wrap}>
          <div className="itemhead itemwide">
            <div className="eyebrow" style={{ marginBottom: 8 }}>{copy.items.whoWasThere}</div>
            <div className="whostrip">
              {people.map((m) => (
                <button key={m.id} onClick={() => toggleInvolved(m.id)}
                  aria-pressed={involved.has(m.id)}
                  disabled={involved.size === 1 && involved.has(m.id)}
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
            {/* Widths decided once (`table-layout: fixed`): nothing in a row can move them. */}
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
                const folded = line.count > 1;
                const shown = (folded && foldedLine(items, line.start, line.count, draft.currency)) || item;
                const run = folded
                  ? runAssignment(assignments.slice(line.start, line.start + line.count)) : null;
                const part = folded ? null : runs[line.start] ?? null;
                // The listener is on the row: the animation runs on the cells and
                // `animationend` bubbles.
                return (
                  <tr key={line.start} ref={(el) => { rowEl.current[line.start] = el; }}
                    onAnimationEnd={refusal.onFlashEnd}
                    className={`${part ? "part" : ""}${lineMissing[li] ? refusal.flash : ""}` || undefined}>
                    <td className="itemlabel">
                      <div className="itemrow">
                        <button type="button" className="itemtext"
                          onClick={() => toggleEveryone(line.start, folded ? line.count : 1)}
                          aria-label={copy.items.everyone(said(shown))}>
                          <span className="itemname">
                            {said(shown)}
                            {!folded && !part && item.quantity && item.quantity > 1 ? (
                              <span className="itemqty"> ×{item.quantity}</span>
                            ) : null}
                          </span>
                          {/* On the amount line: the label's line has a button and a name of any length. */}
                          <span className="itemamount">
                            {priced(shown.amount, draft.currency)}
                            {part ? <span className="itemqty"> · {copy.items.portion(part.index, part.of)}</span> : null}
                          </span>
                        </button>
                        {folded ? (
                          <button className="itemfold" onClick={() => showPortions(line.start)}
                            title={copy.items.showPortions(line.count)}
                            aria-label={copy.items.openItem(said(item), line.count)}
                            aria-expanded={false}>
                            ×{line.count}<Icon name="split" size={12} />
                          </button>
                        ) : part && part.index === 1 ? (
                          <button className="itemfold on" onClick={() => showAsOneLine(part.start)}
                            title={copy.items.mergeBack}
                            aria-label={copy.items.mergeItem(said(item), part.of)}
                            aria-expanded={true}>
                            ×{part.of}<Icon name="merge" size={12} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                    {involvedMembers.map((m) => {
                      const mark = run
                        ? run.marks.get(m.id) ?? null
                        : assignments[line.start]?.has(m.id) ? "all" : null;
                      // Painted faint with the rows and eased back once they
                      // stop: dimmed a beat later, it flickers.
                      const held = inColumn(pending, line.start, m.id);
                      const aimed = inColumn(point, line.start, m.id);
                      return (
                        <td key={m.id} className="itemwho">
                          <button className={`itemcell${held ? " point-hold" : aimed ? pointClass : ""}`}
                            // Stopped here, or the refusal would read a pointer
                            // settling as its flash ending.
                            onAnimationEnd={(e) => { e.stopPropagation(); setPoint(null); }}
                            onClick={() => (run?.detailed
                              ? openForEditing(line.start, line.count, m.id)
                              : folded
                                ? toggleRun(line.start, line.count, m.id, mark === "all")
                                : toggleCell(line.start, m.id))}
                            aria-pressed={mark === "some" ? "mixed" : mark === "all"}
                            aria-label={folded
                              ? (run?.detailed
                                ? copy.items.hadSome(m.name, said(item), line.count)
                                // "Leia had all 2" beside "Luke had all 2" reads
                                // as four salads.
                                : run && [...run.marks].some(([id, v]) => id !== m.id && v === "all")
                                  ? copy.items.sharedAll(m.name, said(item), line.count)
                                  : copy.items.hadAll(m.name, said(item), line.count))
                              : part
                                ? copy.items.hadPortion(m.name, said(item), part.index, part.of)
                                : copy.items.had(m.name, said(item))}>
                            <span className={`dot${mark === "some" ? " some" : mark ? "" : " off"}`} />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
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
                  <span className="tipfield">
                    {/* A bare input took "5.5.5" and kept showing it while the total dropped it. */}
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

          {/* Under the table: a sentence in a cell wraps at the table's width. */}
          {extraKinds.length > 0 ? (
            <div className="itemnote itemwide">{copy.items.extraNote(extraKinds)}</div>
          ) : null}

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

        <div className="pad whodock" style={{ paddingTop: note ? 9 : 18 }}>
          {note}
          <button type="button" className="btn btn-p btn-lg"
            onClick={finish} disabled={refusal.live || seeking}>
            {copy.act.done}
          </button>
        </div>
      </Body>

      {asking ? (
        <ConfirmDialog title={leaving?.title ?? copy.items.discardTitle} confirm={copy.act.discard}
          danger={true} onConfirm={discard} onClose={() => setAsking(false)}>
          <p>{leaving?.body ?? copy.items.discardBody}</p>
        </ConfirmDialog>
      ) : null}
    </Screen>
  );
}
