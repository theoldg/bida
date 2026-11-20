"use client";
// Doc: docs/who-had-what.md#a-split-by-days

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  addDays, canonicalSplit, daysBetween, dragStayEnd, emptyStayRows, resolveSplit, restay,
  setStayAll, setStayRun, stayAt, stayCount, stayDates, stayEnd, stayers, stayHeads, stayRunAt,
  toggleStayRow, type DaysSplit, type StayUnit,
} from "@bida/core";
import { Body, Screen, TopBar } from "./chrome";
import { ConfirmDialog, Dialog } from "./dialog";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { NO_AUTOFILL } from "../lib/autofill";
import { useRefusal } from "../lib/refusal";
import { seekTarget } from "../lib/reveal";
import { glide } from "../lib/seek";
import { bare, distinctInitials, money, plural, stayDay } from "../lib/format";
import { draftAmountMinor, firstStay, splitSeed, type EntryDraft } from "../lib/draft";

type Drag = {
  member: string;
  run: { first: number; last: number };
  /** Undecided on a run of one until the finger says which way. */
  end: "first" | "last" | null;
  from: number;
  base: DaysSplit;
  moved: boolean;
  /** Held by the morning after: the finger is where they leave, a night past the last. */
  morning: boolean;
};

/**
 * The calendar a rental is divided on: a row a night (or day), a column a
 * person, worn the way who-had-what wears a bill — chips, initials over the
 * columns, the running totals under them. A tap flips one night; the ends of a
 * stay's bar drag; a total opens that person's dates to type.
 */
export function StayGrid({ people, draft, save, onDone, onBack }: {
  people: readonly { id: string; name: string }[];
  draft: EntryDraft;
  save: (change: (latest: EntryDraft) => EntryDraft) => void;
  onDone: () => void;
  onBack: () => void;
}) {
  const [stay, setStay] = useState<DaysSplit>(() => {
    // Somebody removed since leaves the stay with their chip.
    const was = draft.stay ?? firstStay(draft);
    const here = new Set(people.map((m) => m.id));
    return Object.keys(was.stays).filter((id) => !here.has(id))
      .reduce((s, id) => setStayAll(s, id, false), was);
  });
  // Columns: whoever has a night, and a chip lit with none stays a column.
  const [involved, setInvolved] = useState<Set<string>>(() => {
    const ids = stayers(stay);
    return new Set(ids.length > 0 ? ids : people.map((m) => m.id));
  });
  const [touched, setTouched] = useState(false);
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [told, setTold] = useState(false);
  const refusal = useRefusal();
  const [seeking, setSeeking] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const rowEl = useRef<(HTMLTableRowElement | null)[]>([]);
  const drag = useRef<Drag | null>(null);
  // A drag can end in a click on the cell it started on, which must not flip
  // it — and on a touch screen often ends in none, so the guard is a moment,
  // never a flag left waiting: a flag outlived the drag and ate the next tap.
  const swallowUntil = useRef(0);
  // Read off a ref by every change: two quick taps can land before a render.
  const now = useRef(stay);
  now.current = stay;

  const change = (next: DaysSplit) => {
    now.current = next;
    setStay(next);
    setTouched(true);
  };

  const labels = distinctInitials(people);
  const columns = people.filter((m) => involved.has(m.id));
  const dates = stayDates(stay);
  const heads = stayHeads(stay);
  const empty = new Set(emptyStayRows(stay));
  const total = draftAmountMinor(draft);
  const word = copy.stay.noun[stay.unit];
  const nights = stay.unit === "night";

  // What each is owed for, as the form will save it: the same seed, the same cent.
  let shares: Record<string, number> = {};
  if (empty.size === 0 && total > 0) {
    try { shares = resolveSplit(total, stay, { tiebreakSeed: splitSeed(draft) }).shares; } catch { /* nobody */ }
  }

  const blooms = empty.size > 0;
  const stillBlooms = useRef(blooms);
  stillBlooms.current = blooms;
  // Fixed mid-flash: a removed animation never ends itself.
  useEffect(() => {
    if (refusal.live && !blooms) refusal.onFlashEnd();
  }, [refusal, blooms]);

  function toggleInvolved(id: string) {
    const was = involved;
    if (was.has(id) && was.size === 1) return;
    const next = new Set(was);
    if (was.has(id)) next.delete(id); else next.add(id);
    setInvolved(next);
    change(setStayAll(now.current, id, !was.has(id)));
  }

  function toggleCell(id: string, row: number) {
    if (Date.now() < swallowUntil.current) return;
    change(toggleStayRow(now.current, id, row));
  }

  /**
   * The row under a finger, clamped to the table: past either end is that end.
   * By nights the departure row counts, one past the last night.
   */
  function rowAt(y: number): number {
    const n = dates.length + (nights ? 1 : 0);
    const rows = rowEl.current.slice(0, n);
    for (let i = 0; i < rows.length; i++) {
      const box = rows[i]?.getBoundingClientRect();
      if (box && y < box.bottom) return i;
    }
    return Math.max(0, n - 1);
  }

  /**
   * By days a bar's two ends are its first and last cells. By nights the last
   * night's bar runs on into the next morning, the row below, and that is
   * where its end is held — the cell of the last night itself is no handle.
   */
  function startDrag(e: React.PointerEvent, id: string, row: number) {
    // A new press is a new tap, whatever the last drag left behind.
    swallowUntil.current = 0;
    const s = now.current;
    const morning = nights && !stayAt(s, id, row) && stayAt(s, id, row - 1);
    const run = stayRunAt(s, id, morning ? row - 1 : row);
    if (!run) return;
    let end: Drag["end"];
    if (morning) end = "last";
    else if (nights) { if (row !== run.first) return; end = "first"; }
    else if (row !== run.first && row !== run.last) return;
    else end = run.first === run.last ? null : row === run.first ? "first" : "last";
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { member: id, run, from: row, base: s, moved: false, end, morning };
  }

  function moveDrag(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const row = rowAt(e.clientY);
    if (row === d.from && !d.moved) return;
    d.moved = true;
    const end = d.end ?? (row < d.from ? "first" : "last");
    // Held by the morning, the finger is the day they leave: the night before is the last.
    change(dragStayEnd(d.base, d.member, d.run, end, d.morning ? row - 1 : row));
  }

  function endDrag() {
    if (drag.current?.moved) swallowUntil.current = Date.now() + 400;
    drag.current = null;
  }

  function setRange(from: string, end: string, unit: StayUnit = stay.unit) {
    const next = restay(now.current, from, end, unit);
    if (next) change(next);
  }

  /** Scrolls the first row nobody was at into view, then blooms them all. */
  function reveal() {
    const box = wrap.current;
    const head = box?.querySelector("thead th");
    const aimed = [...empty].flatMap((i) => (rowEl.current[i] ? [rowEl.current[i]!] : []));
    if (!box) { refusal.refuse(); return; }
    const view = box.getBoundingClientRect();
    const target = seekTarget(box, aimed, {
      top: head ? head.getBoundingClientRect().bottom : view.top, bottom: view.bottom,
    });
    if (target === null) { refusal.refuse(); return; }
    setSeeking(true);
    glide(box, target, () => {
      setSeeking(false);
      if (stillBlooms.current) refusal.refuse();
    });
  }

  function finish() {
    if (blooms || stayers(stay).length === 0) {
      setTold(true);
      if (!refusal.live && !seeking) reveal();
      return;
    }
    save((latest) => ({ ...latest, stay: canonicalSplit(stay) as DaysSplit, splitTab: "days" }));
    onDone();
  }

  function mayLeave() {
    if (touched) { setAsking(true); return false; }
    return true;
  }

  const note = told && blooms ? (
    <div role="status" style={{ marginBottom: 9 }}
      className={`splitfoot bad alone${refusal.flash}`} onAnimationEnd={refusal.onFlashEnd}>
      <span>{copy.stay.needsSomeone}</span>
    </div>
  ) : null;

  const end = stayEnd(stay);
  const person = editing ? people.find((m) => m.id === editing) ?? null : null;

  return (
    <Screen>
      <Body>
        <TopBar title={copy.stay.title} back={{ ask: mayLeave }} />

        <div className="itemscroll" ref={wrap}>
          <div className="itemhead itemwide">
            <div className="eyebrow" style={{ marginBottom: 8 }}>{copy.stay.whoStayed}</div>
            <div className="whostrip">
              {people.map((m) => (
                <button key={m.id} onClick={() => toggleInvolved(m.id)}
                  aria-pressed={involved.has(m.id)}
                  disabled={involved.size === 1 && involved.has(m.id)}
                  aria-label={involved.has(m.id) ? copy.stay.stayed(m.name) : copy.stay.didntStay(m.name)}
                  className="itemchip" style={{ opacity: involved.has(m.id) ? 1 : .4 }}>
                  <span className="avatar" style={{ width: 22, height: 22, fontSize: 10 }}>
                    {labels.get(m.id)}
                  </span>
                  {m.name}
                </button>
              ))}
            </div>
            <div className="stayhead">
              <div className="eyebrow">{copy.stay.dates}</div>
              <div className="seg stayunit">
                {(["night", "day"] as const).map((u) => (
                  <button key={u} type="button" className={stay.unit === u ? "on" : ""} aria-pressed={stay.unit === u}
                    onClick={() => setRange(stay.from, stayEnd({ ...stay, unit: u }), u)}>
                    {copy.stay.unit[u]}
                  </button>
                ))}
              </div>
            </div>
            <div className="stayrange">
              <label className="stayfield">
                <span className="fieldlabel">{copy.stay.from[stay.unit]}</span>
                <input type="date" data-field="stay-from" autoComplete={NO_AUTOFILL} value={stay.from}
                  aria-label={copy.stay.from[stay.unit]}
                  onChange={(e) => {
                    // The stay moves whole: its length is kept, as a booking moved is.
                    const shift = daysBetween(stay.from, e.target.value);
                    if (shift !== null) setRange(e.target.value, addDays(end, shift));
                  }} />
              </label>
              <span className="stayarrow" aria-hidden="true">→</span>
              <label className="stayfield">
                <span className="fieldlabel">{copy.stay.toLabel[stay.unit]}</span>
                <input type="date" data-field="stay-to" autoComplete={NO_AUTOFILL} value={end}
                  min={stay.unit === "night" ? addDays(stay.from, 1) : stay.from}
                  aria-label={copy.stay.toLabel[stay.unit]}
                  onChange={(e) => setRange(stay.from, e.target.value)} />
              </label>
            </div>
          </div>

          <table className={`itemtable staytable${nights ? " bynight" : ""}`} style={{ "--cols": columns.length } as CSSProperties}
            onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
            <colgroup>
              <col className="collabel" />
              {columns.map((m) => <col key={m.id} className="colwho" />)}
            </colgroup>
            <thead>
              <tr>
                <th className="stayrowhead">{copy.stay.row[stay.unit]}</th>
                {columns.map((m) => (
                  <th key={m.id}>
                    <span className="avatar" style={{ width: 24, height: 24, fontSize: 10 }}>{labels.get(m.id)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map((date, i) => {
                const h = heads[i] ?? 0;
                const day = stayDay(date);
                // Display only: what one head pays that row, to the nearest unit.
                const each = h > 0 ? Math.round(total / (stay.count * h)) : 0;
                return (
                  <tr key={date} ref={(el) => { rowEl.current[i] = el; }}
                    onAnimationEnd={refusal.onFlashEnd}
                    className={empty.has(i) && told ? refusal.flash.trim() || undefined : undefined}>
                    <td className="itemlabel">
                      <span className="itemname">{day}</span>
                      <span className="itemamount">
                        {h > 0 ? copy.stay.each(h, bare(each, draft.currency)) : copy.stay.nobody}
                      </span>
                    </td>
                    {columns.map((m) => {
                      const there = stayAt(stay, m.id, i);
                      const first = there && !stayAt(stay, m.id, i - 1);
                      const last = there && !stayAt(stay, m.id, i + 1);
                      // The morning after a last night: where its bar ends, and is held.
                      const morning = nights && !there && stayAt(stay, m.id, i - 1);
                      return (
                        <td key={m.id} className="itemwho">
                          <button type="button"
                            className={`itemcell staycell${there ? " in" : ""}${first ? " first" : ""}${
                              last ? " last" : ""}${morning ? " morning" : ""}`}
                            aria-pressed={there}
                            aria-label={there ? copy.stay.there(m.name, day) : copy.stay.away(m.name, day)}
                            onPointerDown={(e) => startDrag(e, m.id, i)}
                            onClick={() => toggleCell(m.id, i)}>
                            {there ? <span className="staybar" /> : <span className="dot" />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {nights && dates.length > 0 ? (
                // The morning everyone has gone: no night to pay for, only the
                // last night's bars landing, and their ends to hold.
                <tr className="staydeparture" ref={(el) => { rowEl.current[dates.length] = el; }}>
                  <td className="itemlabel">
                    <span className="itemname">{stayDay(end)}</span>
                    <span className="itemamount">{copy.stay.departure}</span>
                  </td>
                  {columns.map((m) => (
                    <td key={m.id} className="itemwho">
                      {stayAt(stay, m.id, dates.length - 1) ? (
                        <button type="button" className="itemcell staycell morning"
                          aria-label={copy.stay.leaves(m.name, stayDay(end))}
                          onPointerDown={(e) => startDrag(e, m.id, dates.length)} />
                      ) : null}
                    </td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </table>

          {columns.length > 0 ? (
            <div className="itemtotals itemwide">
              <div className="totalstrip">
                {columns.map((m) => (
                  <button key={m.id} type="button" className="tot staytot" onClick={() => setEditing(m.id)}
                    aria-label={copy.stay.share(m.name)}>
                    <span className="who">{m.name}</span>
                    <span className="staynights">
                      {plural(stayCount(stay, m.id), word)}
                    </span>
                    <span className="amt">{empty.size > 0 ? "–" : money(shares[m.id] ?? 0, draft.currency)}</span>
                    <Icon name="chev" size={12} className="staychev" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="pad whodock" style={{ paddingTop: note ? 9 : 18 }}>
          {note}
          <button type="button" className="btn btn-p btn-lg" onClick={finish} disabled={refusal.live || seeking}>
            {copy.act.done}
          </button>
        </div>
      </Body>

      {person ? (
        <PersonDates name={person.name} stay={stay} id={person.id}
          onClose={() => setEditing(null)}
          onSet={(next) => { change(next); setEditing(null); }} />
      ) : null}

      {asking ? (
        <ConfirmDialog title={copy.stay.discardTitle} confirm={copy.act.discard}
          danger={true} onConfirm={onBack} onClose={() => setAsking(false)}>
          <p>{copy.stay.discardBody}</p>
        </ConfirmDialog>
      ) : null}
    </Screen>
  );
}

/**
 * One person's dates, typed: the way in for a stay too long to drag, or a
 * person who came for one weekend of a month. Dates outside the stay widen it,
 * nobody else on the nights added.
 */
function PersonDates({ name, id, stay, onClose, onSet }: {
  name: string;
  id: string;
  stay: DaysSplit;
  onClose: () => void;
  onSet: (next: DaysSplit) => void;
}) {
  const there = stayDates(stay).filter((_, i) => stayAt(stay, id, i));
  const nights = stay.unit === "night";
  const [arrived, setArrived] = useState(there[0] ?? stay.from);
  const [left, setLeft] = useState(
    there.length ? addDays(there[there.length - 1]!, nights ? 1 : 0) : stayEnd(stay));
  const span = daysBetween(arrived, left);
  const ok = span !== null && (nights ? span >= 1 : span >= 0);

  function set() {
    if (!ok) return;
    const from = arrived < stay.from ? arrived : stay.from;
    const end = left > stayEnd(stay) ? left : stayEnd(stay);
    const wide = restay(stay, from, end, stay.unit, "away");
    if (!wide) return;
    const first = daysBetween(wide.from, arrived) ?? 0;
    const last = (daysBetween(wide.from, left) ?? 0) - (nights ? 1 : 0);
    onSet(setStayRun(wide, id, first, last));
  }

  return (
    <Dialog title={copy.stay.person.title(name)} onClose={onClose}>
      <div className="dbody staydates">
        <label className="stayfield">
          <span className="fieldlabel">{copy.stay.person.arrived[stay.unit]}</span>
          <input type="date" className="dinput" autoComplete={NO_AUTOFILL} value={arrived}
            aria-label={copy.stay.person.arrived[stay.unit]} onChange={(e) => setArrived(e.target.value)} />
        </label>
        <label className="stayfield">
          <span className="fieldlabel">{copy.stay.person.left[stay.unit]}</span>
          <input type="date" className="dinput" autoComplete={NO_AUTOFILL} value={left}
            aria-label={copy.stay.person.left[stay.unit]} onChange={(e) => setLeft(e.target.value)} />
        </label>
        {ok ? null : <p className="hint">{copy.stay.badRange}</p>}
      </div>
      <div className="drow">
        <button type="button" className="btn btn-s" onClick={() => onSet(setStayAll(stay, id, true))}>
          {copy.stay.person.whole}
        </button>
        <button type="button" className="btn btn-p" onClick={set} disabled={!ok}>{copy.stay.person.set}</button>
      </div>
    </Dialog>
  );
}
