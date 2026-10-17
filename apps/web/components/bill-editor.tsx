"use client";
// Doc: docs/receipt-scanning.md#typing-a-bill-in

import { useEffect, useRef, useState } from "react";
import { minorToDecimalString, receiptExtras } from "@bida/core";
import { AmountInput } from "./amount-input";
import { Body, Screen, Scroll, TopBar } from "./chrome";
import { ConfirmDialog } from "./dialog";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { money } from "../lib/format";
import { useRefusal } from "../lib/refusal";
import { seekTarget } from "../lib/reveal";
import { glide } from "../lib/seek";
import { getDraft, saveDraft, tabAfterScan, type EntryDraft } from "../lib/draft";
import { MAX_PORTIONS, receiptTotalMinor } from "../lib/scan/items";
import {
  billFromRows, blankRow, rowIsBad, rowIsEmpty, rowMinor, rowsFromBill, setCount, setTotal, setUnit,
  type ItemRow,
} from "../lib/scan/manual";

/**
 * What a row is missing, one field at a time, so the refusal blooms only that
 * field. An empty card is refused like any other: it is on screen, so it is
 * something the person meant to fill.
 */
function missingOf(row: ItemRow, currency: string): { name: boolean; price: boolean } {
  if (rowIsEmpty(row)) return { name: true, price: true };
  if (!rowIsBad(row, currency)) return { name: false, price: false };
  const minor = rowMinor(row, currency);
  return { name: row.label.trim() === "", price: minor === null || minor <= 0 };
}

/** The rows as they would be saved, so leaving untouched never asks. */
function shapeOf(rows: readonly ItemRow[], currency: string): string {
  return JSON.stringify(rows.filter((r) => !rowIsEmpty(r))
    .map((r) => [r.label.trim(), r.count, rowMinor(r, currency)]));
}

/**
 * The bill's lines typed by hand: a name, a count and a price per line, no
 * model in between. With a count above one either price can be typed — the
 * one typed holds and the other follows.
 *
 * The rows are this screen's own until Save: the draft gets the bill only
 * whole, and Back with changes asks first, as the form does. Save is never
 * disabled; a press it can't take scrolls to what is missing and blooms it.
 */
export function BillEditor({ draftKey, draft, onSaved, onBack }: {
  /** The group's id, or a quick split's credential. */
  draftKey: string;
  draft: EntryDraft;
  /** After the draft holds the bill. */
  onSaved: () => void;
  onBack: () => void;
}) {
  const currency = draft.currency;
  const before = draft.receiptItems ?? [];
  const [rows, setRows] = useState<ItemRow[]>(() => {
    const opened = rowsFromBill(before, currency);
    return opened.length > 0 ? opened : [blankRow()];
  });
  const opened = useRef(shapeOf(rows, currency));
  const [asking, setAsking] = useState(false);
  const [told, setTold] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const refusal = useRefusal();
  const scroll = useRef<HTMLDivElement>(null);
  const fresh = useRef<string | null>(null);
  // Which count was just stepped, so only it bumps — not every row on arrival,
  // and not one being typed.
  const [stepped, setStepped] = useState<{ key: string; n: number } | null>(null);
  const step = (key: string, by: number) => {
    setStepped((was) => ({ key, n: (was?.n ?? 0) + 1 }));
    change(key, (r) => setCount(r, r.count + by, currency));
  };

  // A row added is a row to type into, whole in view above the dock.
  useEffect(() => {
    const key = fresh.current;
    if (!key) return;
    fresh.current = null;
    const field = scroll.current?.querySelector<HTMLInputElement>(`[data-row="${key}"]`);
    field?.focus();
    field?.closest(".birow")?.scrollIntoView({ block: "nearest" });
  }, [rows.length]);

  const missing = new Map(rows.map((row) => [row.key, missingOf(row, currency)]));
  // No cards is no bill, and a bill is not cleared from here: another split
  // tab is how an expense stops being split by items.
  const empty = rows.length === 0;
  const firstBad = rows.findIndex((row) => missing.get(row.key)!.name || missing.get(row.key)!.price);
  const blooms = firstBad !== -1 || empty;
  const stillBlooms = useRef(blooms);
  stillBlooms.current = blooms;

  // Fixed mid-flash: the class goes, `animationend` never fires, and Save
  // would stay spent for good.
  useEffect(() => {
    if (refusal.live && !blooms) refusal.onFlashEnd();
  }, [refusal, blooms]);
  useEffect(() => { if (told && !blooms) setTold(false); }, [told, blooms]);

  const total = rows.reduce((sum, row) => sum + (rowIsBad(row, currency) ? 0 : rowMinor(row, currency) ?? 0), 0);
  const changed = shapeOf(rows, currency) !== opened.current;

  const change = (key: string, edit: (row: ItemRow) => ItemRow) =>
    setRows((all) => all.map((row) => (row.key === key ? edit(row) : row)));
  function add() {
    const row = blankRow();
    fresh.current = row.key;
    setRows((all) => [...all, row]);
  }
  const remove = (key: string) => setRows((all) => all.filter((row) => row.key !== key));

  /** What is refused: the missing fields; with no cards at all, "Add an item". */
  const aimedAt = (row: ItemRow, field: "name" | "price") => !!missing.get(row.key)?.[field];
  const flashOn = (row: ItemRow, field: "name" | "price") => (aimedAt(row, field) ? refusal.flash : "");

  /** One off screen is scrolled to first: a flash nobody sees is a press that did nothing. */
  function reveal() {
    const box = scroll.current;
    const aimed = [...(box?.querySelectorAll("[data-aimed]") ?? [])];
    if (!box || aimed.length === 0) { refusal.refuse(); return; }
    const view = box.getBoundingClientRect();
    const pad = getComputedStyle(box);
    const target = seekTarget(box, aimed, {
      top: view.top + (parseFloat(pad.scrollPaddingTop) || 0),
      bottom: view.bottom - (parseFloat(pad.scrollPaddingBottom) || 0),
    });
    if (target === null) { refusal.refuse(); return; }
    setSeeking(true);
    glide(box, target, () => {
      setSeeking(false);
      if (stillBlooms.current) refusal.refuse();
    });
  }

  function save() {
    if (blooms) {
      setTold(true);
      if (!refusal.live && !seeking) reveal();
      return;
    }
    const latest = getDraft(draftKey) ?? draft;
    const { items, assignments } = billFromRows(rows, {
      items: latest.receiptItems ?? [], assignments: latest.receiptAssignments ?? null,
    }, latest.currency);
    const sum = receiptTotalMinor(items, receiptExtras(latest), latest.currency);
    const tab = tabAfterScan(latest, latest.splitTab, true);
    // Whoever had a line keeps it (`billFromRows`); the bill's extras stay.
    saveDraft(draftKey, {
      ...latest,
      ...(sum !== null && sum > 0 ? { amountText: minorToDecimalString(sum, latest.currency) } : {}),
      receiptItems: items,
      receiptAssignments: assignments,
      ...(tab !== undefined ? { splitTab: tab } : {}),
    });
    onSaved();
  }

  function mayLeave() {
    if (changed) { setAsking(true); return false; }
    return true;
  }

  const said = !told || !blooms ? null
    : empty ? copy.scan.byHand.none
    : rowIsEmpty(rows[firstBad]!) ? copy.scan.byHand.blank
    : missing.get(rows[firstBad]!.key)!.name ? copy.scan.byHand.noName
    : copy.scan.byHand.noPrice(rows[firstBad]!.label.trim());

  return (
    <Screen>
      <Body>
        <TopBar title={copy.scan.byHand.title} sub={money(total, currency)} back={{ ask: mayLeave }} />
        <Scroll ref={scroll}>
          <div className="pad birows">
            {rows.map((row, i) => {
              const many = row.count > 1;
              const n = i + 1;
              const nameAimed = aimedAt(row, "name");
              const priceAimed = aimedAt(row, "price");
              // With two prices, the refusal blooms the one that was typed.
              const unitAimed = priceAimed && many && row.by === "unit";
              const totalAimed = priceAimed && !unitAimed;
              const last = i === rows.length - 1;
              // Shown only while the name is the one it translates: retyped, the
              // translation is dropped on save (`billFromRows`).
              const english = row.labelEn && row.label === row.labelWas && row.labelEn !== row.label
                ? row.labelEn : null;
              return (
                <div key={row.key} className="card birow">
                  <div className="bihead">
                    <span className={`amountfield biname${flashOn(row, "name")}`}
                      {...(nameAimed ? { "data-aimed": "" } : {})}
                      onAnimationEnd={refusal.onFlashEnd}>
                      <input data-row={row.key} value={row.label}
                        autoFocus={i === 0 && before.length === 0}
                        placeholder={copy.scan.byHand.name} aria-label={copy.scan.byHand.nameOf(n)}
                        enterKeyHint="next" autoCapitalize="sentences" maxLength={80}
                        onChange={(e) => change(row.key, (r) => ({ ...r, label: e.target.value }))} />
                    </span>
                    <button type="button" className="bidrop" onClick={() => remove(row.key)}
                      aria-label={copy.scan.byHand.remove(row.label.trim() || String(n))}>
                      <Icon name="cross" size={12} />
                    </button>
                  </div>
                  {english ? <div className="bien">{english}</div> : null}
                  <div className="binums">
                    <span className="partsend bistep">
                      <button type="button" className="partsstep" disabled={row.count <= 1}
                        onClick={() => step(row.key, -1)}
                        aria-label={copy.scan.byHand.fewer(n)}>
                        <Icon name="minus" size={10} />
                      </button>
                      <CountInput count={row.count} bump={stepped?.key === row.key ? stepped.n : 0}
                        label={copy.scan.byHand.countOf(n)}
                        onCount={(c) => change(row.key, (r) => setCount(r, c, currency))} />
                      <button type="button" className="partsstep" disabled={row.count >= MAX_PORTIONS}
                        onClick={() => step(row.key, 1)}
                        aria-label={copy.scan.byHand.more(n)}>
                        <Icon name="plus" size={10} />
                      </button>
                    </span>
                    {many ? (
                      <label className="biprice"
                        {...(unitAimed ? { "data-aimed": "" } : {})}>
                        <span>{copy.scan.byHand.each}</span>
                        <AmountInput className="bignum splitin" currency={currency} value={row.unitText}
                          fieldClassName={unitAimed ? refusal.flash.trim() || undefined : undefined}
                          onAnimationEnd={refusal.onFlashEnd}
                          placeholder="0" enterKeyHint="next" aria-label={copy.scan.byHand.eachOf(n)}
                          onChange={(t) => change(row.key, (r) => setUnit(r, t, currency))} />
                      </label>
                    ) : null}
                    <label className="biprice"
                      {...(totalAimed ? { "data-aimed": "" } : {})}>
                      {many ? <span>{copy.scan.byHand.total}</span> : null}
                      <AmountInput className="bignum splitin" currency={currency} value={row.totalText}
                        fieldClassName={totalAimed ? refusal.flash.trim() || undefined : undefined}
                        onAnimationEnd={refusal.onFlashEnd}
                        placeholder="0" enterKeyHint="next" aria-label={copy.scan.byHand.priceOf(n)}
                        // The last price's confirm key is the next item: a bill
                        // is typed without lifting the thumb to "Add".
                        onKeyDown={last ? (e) => {
                          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                          e.preventDefault();
                          e.stopPropagation();
                          add();
                        } : undefined}
                        onChange={(t) => change(row.key, (r) => setTotal(r, t, currency))} />
                    </label>
                  </div>
                </div>
              );
            })}
            <button type="button" className={`card biadd${empty ? refusal.flash : ""}`} onClick={add}
              {...(empty ? { "data-aimed": "" } : {})} onAnimationEnd={refusal.onFlashEnd}>
              <Icon name="plus" size={14} />
              {copy.scan.byHand.add}
            </button>
          </div>
        </Scroll>

        <div className="pad whodock" style={{ paddingTop: said ? 9 : 18 }}>
          {said ? (
            <div role="status" style={{ marginBottom: 9 }}
              className={`splitfoot bad alone${refusal.flash}`} onAnimationEnd={refusal.onFlashEnd}>
              <span>{said}</span>
            </div>
          ) : null}
          <button type="button" className="btn btn-p btn-lg" onClick={save}
            disabled={refusal.live || seeking}>
            {copy.act.done}
          </button>
        </div>
      </Body>

      {asking ? (
        <ConfirmDialog title={copy.scan.byHand.discardTitle} confirm={copy.act.discard}
          danger={true} onConfirm={onBack} onClose={() => setAsking(false)}>
          <p>{copy.scan.byHand.discardBody}</p>
        </ConfirmDialog>
      ) : null}
    </Screen>
  );
}

/**
 * The count, typed or stepped. Its text is its own while typing: an emptied
 * field is a count about to be typed, not a 1 to snap back to. It settles on
 * the count when the caret leaves.
 */
function CountInput({ count, bump, label, onCount }: {
  count: number;
  /** Bumped on each step; parity alternates the animation so a second replays. */
  bump: number;
  label: string;
  onCount: (count: number) => void;
}) {
  const [text, setText] = useState(String(count));
  useEffect(() => {
    setText((t) => (Number(t) === count ? t : String(count)));
  }, [count]);
  return (
    <span className={`amountfield bicount${bump ? (bump % 2 ? " bump-a" : " bump-b") : ""}`}>
      <input inputMode="numeric" enterKeyHint="next" aria-label={label} value={text}
        onChange={(e) => {
          const next = e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 3);
          setText(next);
          if (next) onCount(Math.min(MAX_PORTIONS, Number(next)));
        }}
        onFocus={(e) => e.target.select()}
        onBlur={() => setText(String(count))} />
    </span>
  );
}
