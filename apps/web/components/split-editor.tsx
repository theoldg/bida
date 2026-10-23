"use client";
// Doc: docs/entry.md#the-split-editor

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  exactFigures, resolveSplit, restOf, splitParticipants, toggleEveryone, validateSplit,
  type ArithmeticSplit, type Id, type Member, type SplitSpec,
} from "@bida/core";
import { MAX_PARTS, MinorAmountInput, PartsInput } from "./amount-input";
import { Failure } from "./chrome";
import { ScanPair, type ReceiptScan } from "./receipt-scan";
import { Icon } from "./icons";
import { You } from "./bits";
import { copy } from "../lib/copy";
import { printedCount } from "../lib/scan/items";
import { bare, money, plural } from "../lib/format";
import type { SplitTab } from "../lib/draft";

/**
 * The receipt split is never written here: it arrives as `receiptSplit`
 * (ADR-0016).
 */

const MODES = ["equal", "shares", "exact"] as const;

/** A tap goes typed → out → rest → out → rest…; typing makes any row typed. */
type AmountRow = "typed" | "rest" | "out";

function exactSpec(amounts: Record<Id, number>, rest: Id[]): ArithmeticSplit {
  return rest.length > 0
    ? { mode: "exact", amounts, rest: [...new Set(rest)].sort() }
    : { mode: "exact", amounts };
}

interface ReceiptTabProps {
  items: { label: string; amount: string }[] | null;
  scan: ReceiptScan;
  flash: string;
  onFlashEnd: (e: React.AnimationEvent) => void;
  editItemsHref: string;
}

export function SplitEditor({ members, me, title, amountMinor, amountCurrency, spec, receiptSplit, seed, onChange, tab, onTabChange, receipt }: {
  members: Member[];
  me: string | undefined;
  title: string;
  amountMinor: number;
  amountCurrency: string;
  spec: ArithmeticSplit;
  receiptSplit: SplitSpec | null;
  seed: string;
  /**
   * A change to the split as it now stands, never a finished one: two taps
   * inside one frame (an iPhone's, quick) would both start from this render's.
   */
  onChange: (change: (latest: ArithmeticSplit) => ArithmeticSplit) => void;
  tab: SplitTab;
  onTabChange: (next: SplitTab) => void;
  receipt: ReceiptTabProps | null;
}) {
  const opts = { tiebreakSeed: seed };
  const showReceipt = tab === "receipt" && receipt !== null;
  const shown: SplitSpec | null = showReceipt ? receiptSplit : spec;
  const included = new Set(shown ? splitParticipants(shown) : []);

  let shares: Record<string, number> = {};
  if (shown) {
    try { shares = resolveSplit(amountMinor, shown, opts).shares; } catch { /* incomplete */ }
  }

  const figures = spec.mode === "exact" ? exactFigures(amountMinor, spec, opts) : {};
  const restShort = amountMinor > 0 && restOf(spec).length > 0 && !validateSplit(amountMinor, spec, opts).ok;
  const rowIn = (s: ArithmeticSplit, id: Id): AmountRow =>
    restOf(s).includes(id) ? "rest" : s.mode === "exact" && (s.amounts[id] ?? 0) > 0 ? "typed" : "out";
  const rowOf = (id: Id) => rowIn(spec, id);

  function toggle(memberId: string) {
    onChange((s) => {
      const next = new Set(splitParticipants(s));
      if (next.has(memberId)) next.delete(memberId); else next.add(memberId);
      switch (s.mode) {
        case "equal": return { mode: "equal", members: [...next] };
        case "shares": {
          const weights = { ...s.weights };
          if (next.has(memberId)) weights[memberId] = 1; else delete weights[memberId];
          return { mode: "shares", weights };
        }
        case "exact": return s;
      }
    });
  }

  const head = !showReceipt && members.length >= 3 ? spec : null;
  const inCount = members.filter((m) => included.has(m.id)).length;
  const headState = inCount === 0 ? "none" : inCount === members.length ? "all" : "some";
  // The denominator a share is a fraction of, which no row says.
  const partCount = head?.mode === "shares" ? Object.values(head.weights).reduce((a, b) => a + b, 0) : null;

  function toggleAll() {
    if (head) onChange((s) => toggleEveryone(s, members.map((m) => m.id)));
  }

  function headLabel(): string {
    return headState === "all" ? copy.split.everyone.out : copy.split.everyone.in;
  }

  function setParts(memberId: string, parts: (was: number) => number) {
    onChange((s) => {
      if (s.mode !== "shares") return s;
      const weights = { ...s.weights };
      const next = Math.min(MAX_PARTS, Math.max(0, parts(weights[memberId] ?? 0)));
      if (next === 0) delete weights[memberId]; else weights[memberId] = next;
      return { mode: "shares", weights };
    });
  }

  function setExact(memberId: string, minor: number) {
    onChange((s) => {
      if (s.mode !== "exact") return s;
      const amounts = { ...s.amounts };
      const others = restOf(s).filter((id) => id !== memberId);
      if (minor > 0) amounts[memberId] = minor;
      else delete amounts[memberId];
      return exactSpec(amounts, minor > 0 ? others : [...others, memberId]);
    });
  }

  function tapRow(memberId: string) {
    onChange((s) => {
      if (s.mode !== "exact") return s;
      const amounts = { ...s.amounts };
      delete amounts[memberId];
      const others = restOf(s).filter((id) => id !== memberId);
      return exactSpec(amounts, rowIn(s, memberId) === "out" ? [...others, memberId] : others);
    });
  }

  return (
    <section aria-label={title}>
      <div className="splitrule" aria-hidden="true"><span /></div>

      <div className="splitbox">
        <div className="seg">
          {MODES.map((mode) => {
            const on = !showReceipt && tab === mode;
            return (
              <button key={mode} type="button" className={on ? "on" : ""} aria-pressed={on}
                onClick={() => onTabChange(mode)}>{copy.split.mode[mode]}</button>
            );
          })}
          {receipt ? (
            <button type="button" className={showReceipt ? "on" : ""} aria-pressed={showReceipt}
              onClick={() => onTabChange("receipt")}>
              {copy.split.receipt}
            </button>
          ) : null}
        </div>

        <div className="splitlist">
          {showReceipt && receipt ? (
            <ReceiptPanel {...receipt} members={members} me={me} currency={amountCurrency}
              shares={shares} included={included} />
          ) : members.map((m, i) => {
            const on = included.has(m.id);
            // A toggle answering on its left half only reads as broken.
            const wholeRow = spec.mode === "equal";
            const typing = spec.mode === "exact";
            const fieldId = `sp-${m.id}`;
            const row = rowOf(m.id);
            const parts = spec.mode === "shares" ? spec.weights[m.id] ?? 0 : 0;
            const end = spec.mode === "shares" ? (
              <span className="partsend">
                <button type="button" className="partsstep" onClick={() => setParts(m.id, (was) => was - 1)}
                  disabled={parts === 0} aria-label={copy.split.fewerParts(m.name)}>
                  <Icon name="minus" size={9} />
                </button>
                <PartsInput data-field={fieldId} className="bignum partsin" autoSize
                  enterKeyHint={i === members.length - 1 ? "done" : "next"}
                  aria-label={copy.split.partsFor(m.name)}
                  value={parts} placeholder="0"
                  onChangeValue={(n) => setParts(m.id, () => n)} />
                <button type="button" className="partsstep" onClick={() => setParts(m.id, (was) => was + 1)}
                  disabled={parts >= MAX_PARTS} aria-label={copy.split.moreParts(m.name)}>
                  <Icon name="plus" size={9} />
                </button>
              </span>
            ) : spec.mode === "exact" ? (
              <span style={{ display: "flex", alignItems: "center" }}>
                <MinorAmountInput data-field={fieldId} className="bignum splitin"
                  enterKeyHint={i === members.length - 1 ? "done" : "next"}
                  aria-label={copy.split.amountFor(m.name)}
                  currency={amountCurrency}
                  valueMinor={row === "typed" ? spec.amounts[m.id] ?? 0 : 0}
                  placeholder={row !== "rest" ? bare(0, amountCurrency)
                    : restShort ? "?" : bare(figures[m.id] ?? 0, amountCurrency)}
                  onChangeMinor={(minor) => setExact(m.id, minor)} />
              </span>
            ) : (
              // Ink, not green: being in the split is not a credit.
              <span style={{ color: on ? "var(--ink)" : "var(--muted)" }}>
                <Icon name={on ? "check" : "plus"} size={16} />
              </span>
            );
            // As amounts, the figure is already in the field: the line says what decides it.
            const meta = !on ? copy.split.notInvolved
              : !typing ? money(shares[m.id] ?? 0, amountCurrency)
              : row === "rest" ? copy.split.sharingRest : copy.split.fixedAmount;
            const name = (
              <span className="rmain" style={{ opacity: on ? 1 : .45 }}>
                <span className="rtitle" style={{ display: "block", fontSize: 13.5 }}>
                  {m.name}{m.id === me ? <You /> : null}
                </span>
                <span className="rmeta" style={{ display: "block" }}>{meta}</span>
              </span>
            );
            const lead = { display: "flex", gap: 10, alignItems: "center", flex: 1, minWidth: 0 } as const;
            return (
              <div key={m.id} className={`splitrow${on ? " inrow" : ""}${
                typing && row === "rest" ? ` rest${restShort ? " short" : ""}` : ""}`}>
                {typing ? (
                  <button type="button" onClick={() => tapRow(m.id)} style={lead}
                    aria-label={row === "typed" ? copy.split.clearOut(m.name)
                      : row === "rest" ? copy.split.leaveOut(m.name) : copy.split.joinRest(m.name)}>
                    {name}
                    <RowMark row={row} />
                  </button>
                ) : (
                  <button type="button" onClick={() => toggle(m.id)}
                    aria-label={on ? copy.split.leaveOut(m.name) : copy.split.include(m.name)}
                    style={lead}>
                    {name}
                    {wholeRow ? end : null}
                  </button>
                )}
                {wholeRow ? null : end}
              </div>
            );
          })}
        </div>
        {head ? (
          <div className="splithead">
            <span className="splitcount" aria-hidden="true">
              {partCount === null ? null : <>{plural(partCount, copy.noun.part)} · </>}
              <Icon name="users" size={12} /> {inCount}/{members.length}
            </span>
            <button type="button" className="allmark" onClick={toggleAll}
              role="checkbox" aria-checked={headState === "all" ? true : headState === "some" ? "mixed" : false}
              aria-label={`${partCount === null ? "" : `${plural(partCount, copy.noun.part)}, `}${
                copy.split.everyone.count(inCount, members.length)}. ${headLabel()}`}>
              <span className={`allbox ${headState}`}>
                {headState === "none" ? null : <Icon name={headState === "all" ? "check" : "minus"} size={11} />}
              </span>
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function RowMark({ row }: { row: AmountRow }) {
  return (
    <span style={{ width: 16, flex: "none", display: "flex", justifyContent: "center",
      color: row === "rest" ? "var(--ink)" : "var(--muted)" }}>
      {row === "rest" ? <Icon name="check" size={14} />
        : row === "out" ? <Icon name="plus" size={14} /> : <Icon name="cross" size={12} />}
    </span>
  );
}

/**
 * Its typing dialog is rendered by `useReceiptScan`: the reading reshapes this
 * panel, which would unmount it.
 */
function ReceiptPanel({
  items, scan, flash, onFlashEnd, editItemsHref,
  members, me, currency, shares, included,
}: ReceiptTabProps & {
  members: Member[];
  me: string | undefined;
  currency: string;
  shares: Record<string, number>;
  included: Set<string>;
}) {
  const held = !!items && items.length > 0;
  // A scan that brought lines back points at the next step, once, wherever it
  // started: one from `/g/scan` lands before this panel exists.
  const [hail, setHail] = useState(false);
  const landed = scan.live?.state === "landed";
  useEffect(() => {
    if (held && landed && scan.takeLanded()) setHail(true);
  }, [held, landed, scan]);

  if (items && held) {
    const involved = members.filter((m) => included.has(m.id));
    // What it came to first, then the way into the grid, then what replaces
    // the bill — the order `/quick` holds a read bill in.
    return (
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Set as the payers' lines above it are, one list rather than spaced
            rows; absent until someone is assigned, so its gap goes too. */}
        {involved.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "2px 0 2px" }}>
            {involved.map((m) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>{m.name}{m.id === me ? <You /> : null}</span>
                <span className="bignum" style={{ fontSize: 13.5 }}>{money(shares[m.id] ?? 0, currency)}</span>
              </div>
            ))}
          </div>
        ) : null}
        <Link href={editItemsHref} data-refuse="receipt" className={`btn btn-s gridway${flash}${hail ? " hail" : ""}`}
          onAnimationEnd={(e) => { if (e.animationName === "hail") setHail(false); else onFlashEnd(e); }}
          style={{ textDecoration: "none" }}>
          <Icon name="users" size={16} />
          <span className="wayname">{included.size === 0 ? copy.scan.assignWhoHadWhat : copy.scan.editWhoHadWhat}</span>
          <span className="waycount"><span>{plural(printedCount(items), copy.noun.item)}</span></span>
          <Icon name="chev" size={14} />
        </Link>
        <div>
          <ScanPair scan={scan} register="s" overBill={true} />
          {scan.refusal ? (
            <Failure>{scan.refusal} {copy.scan.keptOld}</Failure>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      <div data-refuse="receipt">
        <ScanPair scan={scan} register="s" flash={flash} onFlashEnd={onFlashEnd} />
      </div>
      {scan.refusal ? (
        <Failure>{scan.refusal}</Failure>
      ) : (
        <p className="scanterms" style={{ marginTop: 7 }}>{copy.scan.terms}</p>
      )}
    </div>
  );
}
