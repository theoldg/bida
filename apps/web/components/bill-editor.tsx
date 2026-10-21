"use client";
// Doc: docs/receipt-scanning.md#typing-a-bill-in

import { useEffect, useRef, useState } from "react";
import { minorToDecimalString, receiptExtras } from "@bida/core";
import { AmountInput } from "./amount-input";
import { Body, Screen, Scroll, TopBar } from "./chrome";
import { ChoiceDialog, ConfirmDialog } from "./dialog";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { money } from "../lib/format";
import { useRefusal } from "../lib/refusal";
import { seekTarget } from "../lib/reveal";
import { glide } from "../lib/seek";
import { getDraft, saveDraft, tabAfterScan, type EntryDraft } from "../lib/draft";
import { MAX_PORTIONS, receiptTotalMinor } from "../lib/scan/items";
import {
  billFromRows, blankRow, otherName, rowIsBad, rowIsEmpty, rowMinor, rowsFromBill, rowsFromExtras, setCount, setTotal,
  setUnit, type ItemRow, type LineKind,
} from "../lib/scan/manual";

const KINDS: readonly LineKind[] = ["item", "discount", "charge"];

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

/** The bill as it would be saved, so leaving untouched never asks. */
function shapeOf(rows: readonly ItemRow[], tip: string, currency: string): string {
  return JSON.stringify([tip.trim(), ...rows.filter((r) => !rowIsEmpty(r))
    .map((r) => [r.kind, r.label.trim(), r.kind === "item" ? r.count : 1, rowMinor(r, currency)])]);
}

/**
 * The bill's lines typed by hand: a name, a count and a price per line, no
 * model in between. With a count above one either price can be typed — the
 * one typed holds and the other follows. A line's kind is picked on its chip:
 * a discount or a charge has no count, and is nobody's to tick. The tip is
 * the last card, the same figure the grid types.
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
    const english = draft.receiptEnglish === true;
    const opened = rowsFromBill(before, currency, english);
    return [
      ...opened.length > 0 ? opened : [blankRow()],
      ...rowsFromExtras(receiptExtras(draft), english, copy.items.extra.charge),
    ];
  });
  const [tip, setTip] = useState(draft.receiptTip ?? "");
  const opened = useRef(shapeOf(rows, tip, currency));
  const [asking, setAsking] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
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
  // No items is no bill, and a bill is not cleared from here: another split
  // tab is how an expense stops being split by items.
  const empty = !rows.some((row) => row.kind === "item");
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

  const bill = billFromRows(rows, { items: [], assignments: null }, currency);
  const total = receiptTotalMinor(
    bill.items, { tip: tip || null, charges: bill.charges, discounts: bill.discounts }, currency) ?? 0;
  const changed = shapeOf(rows, tip, currency) !== opened.current;

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
    const { items, assignments, discounts, charges } = billFromRows(rows, {
      items: latest.receiptItems ?? [], assignments: latest.receiptAssignments ?? null,
    }, latest.currency);
    const sum = receiptTotalMinor(items, { tip: tip || null, charges, discounts }, latest.currency);
    const tab = tabAfterScan(latest, latest.splitTab, true);
    // Whoever had a line keeps it (`billFromRows`).
    saveDraft(draftKey, {
      ...latest,
      ...(sum !== null && sum > 0 ? { amountText: minorToDecimalString(sum, latest.currency) } : {}),
      receiptItems: items,
      receiptAssignments: assignments,
      receiptTip: tip || null,
      // Written as a charge now, named or not (`rowsFromExtras`).
      receiptTax: null,
      receiptCharges: charges.length > 0 ? charges : null,
      receiptDiscounts: discounts.length > 0 ? discounts : null,
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
        <TopBar title={copy.scan.byHand.title} back={{ ask: mayLeave }} />
        <Scroll ref={scroll}>
          <div className="pad birows">
            {rows.map((row, i) => {
              const item = row.kind === "item";
              const many = item && row.count > 1;
              const n = i + 1;
              const nameAimed = aimedAt(row, "name");
              const priceAimed = aimedAt(row, "price");
              // With two prices, the refusal blooms the one that was typed.
              const unitAimed = priceAimed && many && row.by === "unit";
              const totalAimed = priceAimed && !unitAimed;
              const last = i === rows.length - 1;
              // Gone once the name is retyped, as it is on save (`billFromRows`).
              const other = otherName(row);
              return (
                <div key={row.key} className={`card birow${item ? "" : " biextra"}`}>
                  <div className="bihead">
                    <span className={`amountfield biname${flashOn(row, "name")}`}
                      {...(nameAimed ? { "data-aimed": "" } : {})}
                      onAnimationEnd={refusal.onFlashEnd}>
                      <input data-row={row.key} value={row.label}
                        autoFocus={i === 0 && before.length === 0}
                        placeholder={copy.scan.byHand.kind[row.kind]} aria-label={copy.scan.byHand.nameOf(n)}
                        enterKeyHint="next" autoCapitalize="sentences" maxLength={80}
                        onChange={(e) => change(row.key, (r) => ({ ...r, label: e.target.value }))} />
                    </span>
                    {/* An item, which most lines are, says nothing; the others wear their kind. */}
                    {item ? null : <span className="chip kindchip bikind">{copy.scan.byHand.kind[row.kind]}</span>}
                    <button type="button" className="bidrop bimore"
                      aria-label={copy.scan.byHand.kindOf(n, copy.scan.byHand.kind[row.kind])}
                      onClick={() => setPicking(row.key)}>
                      <Icon name="more" size={14} />
                    </button>
                    <button type="button" className="bidrop" onClick={() => remove(row.key)}
                      aria-label={copy.scan.byHand.remove(row.label.trim() || String(n))}>
                      <Icon name="cross" size={12} />
                    </button>
                  </div>
                  {other ? <div className="bien">{other}</div> : null}
                  <div className="binums">
                    {item ? <span className="partsend bistep">
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
                    </span> : null}
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
                      {/* Typed positive, as it is kept: the kind is the sign. */}
                      {item ? null : <span className="bisign">{row.kind === "discount" ? "−" : "+"}</span>}
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
            <div className="card birow bitip">
              <span className="bitipname">{copy.scan.byHand.tip}</span>
              <label className="biprice">
                <AmountInput className="bignum splitin" currency={currency} value={tip}
                  placeholder="0" enterKeyHint="done" aria-label={copy.items.tipLabel(null)}
                  onChange={setTip} />
              </label>
            </div>
          </div>
        </Scroll>

        <div className="pad whodock" style={{ paddingTop: 12 }}>
          <div className="bisum">
            <span>{copy.scan.byHand.sum}</span>
            <span className="num">{money(total, currency)}</span>
          </div>
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

      {picking ? (
        <ChoiceDialog title={copy.scan.byHand.kindTitle}
          value={rows.find((row) => row.key === picking)?.kind ?? "item"}
          options={KINDS.map((kind) => ({
            value: kind, label: copy.scan.byHand.kind[kind], note: copy.scan.byHand.kindNote[kind],
          }))}
          onPick={(kind) => change(picking, (row) => ({ ...row, kind }))}
          onClose={() => setPicking(null)} />
      ) : null}

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
    // A label, so a tap on the "×" lands in the field too. The input is as
    // wide as its digits, so the two sit together centred.
    <label className={`amountfield bicount${bump ? (bump % 2 ? " bump-a" : " bump-b") : ""}`}>
      <span aria-hidden="true">×</span>
      <input inputMode="numeric" enterKeyHint="next" aria-label={label} value={text}
        style={{ width: `${Math.max(1, text.length)}ch` }}
        onChange={(e) => {
          const next = e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 3);
          setText(next);
          if (next) onCount(Math.min(MAX_PORTIONS, Number(next)));
        }}
        onFocus={(e) => e.target.select()}
        onBlur={() => setText(String(count))} />
    </label>
  );
}
