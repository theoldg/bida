"use client";
// Doc: docs/entry.md#the-split-editor

import Link from "next/link";
import {
  exactFigures, resolveSplit, restOf, splitParticipants, toggleEveryone, validateSplit,
  type ArithmeticSplit, type Id, type Member, type SplitSpec,
} from "@bida/core";
import { MAX_PARTS, MinorAmountInput, PartsInput } from "./amount-input";
import { Failure } from "./chrome";
import { ScanPair, type ReceiptScan } from "./receipt-scan";
import { Icon } from "./icons";
import { SoloName, You } from "./bits";
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
  onChange: (next: ArithmeticSplit) => void;
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

  const rest = new Set(restOf(spec));
  const figures = spec.mode === "exact" ? exactFigures(amountMinor, spec, opts) : {};
  const restShort = amountMinor > 0 && rest.size > 0 && !validateSplit(amountMinor, spec, opts).ok;
  const rowOf = (id: Id): AmountRow =>
    rest.has(id) ? "rest" : spec.mode === "exact" && (spec.amounts[id] ?? 0) > 0 ? "typed" : "out";

  function toggle(memberId: string) {
    const next = new Set(included);
    if (next.has(memberId)) next.delete(memberId); else next.add(memberId);
    const ids = [...next];
    switch (spec.mode) {
      case "equal": return onChange({ mode: "equal", members: ids });
      case "shares": {
        const weights = { ...spec.weights };
        if (next.has(memberId)) weights[memberId] = 1; else delete weights[memberId];
        return onChange({ mode: "shares", weights });
      }
      case "exact": return;
    }
  }

  const head = !showReceipt && members.length >= 3 ? spec : null;
  const inCount = members.filter((m) => included.has(m.id)).length;
  const headState = inCount === 0 ? "none" : inCount === members.length ? "all" : "some";
  // The denominator a share is a fraction of, which no row says.
  const partCount = head?.mode === "shares" ? Object.values(head.weights).reduce((a, b) => a + b, 0) : null;

  function toggleAll() {
    if (head) onChange(toggleEveryone(head, members.map((m) => m.id)));
  }

  function headLabel(): string {
    return headState === "all" ? copy.split.everyone.out : copy.split.everyone.in;
  }

  function setParts(memberId: string, parts: number) {
    if (spec.mode !== "shares") return;
    const weights = { ...spec.weights };
    const next = Math.min(MAX_PARTS, Math.max(0, parts));
    if (next === 0) delete weights[memberId]; else weights[memberId] = next;
    onChange({ mode: "shares", weights });
  }

  function setExact(memberId: string, minor: number) {
    if (spec.mode !== "exact") return;
    const amounts = { ...spec.amounts };
    const others = restOf(spec).filter((id) => id !== memberId);
    if (minor > 0) amounts[memberId] = minor;
    else delete amounts[memberId];
    onChange(exactSpec(amounts, minor > 0 ? others : [...others, memberId]));
  }

  function tapRow(memberId: string) {
    if (spec.mode !== "exact") return;
    const amounts = { ...spec.amounts };
    delete amounts[memberId];
    const others = restOf(spec).filter((id) => id !== memberId);
    onChange(exactSpec(amounts, rowOf(memberId) === "out" ? [...others, memberId] : others));
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
                <button type="button" className="partsstep" onClick={() => setParts(m.id, parts - 1)}
                  disabled={parts === 0} aria-label={copy.split.fewerParts(m.name)}>
                  <Icon name="minus" size={9} />
                </button>
                <PartsInput id={fieldId} className="bignum partsin"
                  enterKeyHint={i === members.length - 1 ? "done" : "next"}
                  aria-label={copy.split.partsFor(m.name)}
                  value={parts} placeholder="0"
                  onChangeValue={(n) => setParts(m.id, n)} />
                <button type="button" className="partsstep" onClick={() => setParts(m.id, parts + 1)}
                  disabled={parts >= MAX_PARTS} aria-label={copy.split.moreParts(m.name)}>
                  <Icon name="plus" size={9} />
                </button>
              </span>
            ) : spec.mode === "exact" ? (
              <span style={{ display: "flex", alignItems: "center" }}>
                <MinorAmountInput id={fieldId} className="bignum splitin"
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
            const name = typing ? (
              <SoloName name={m.name} you={m.id === me} style={{ opacity: on ? 1 : .45 }} />
            ) : (
              <span className="rmain" style={{ opacity: on ? 1 : .45 }}>
                <span className="rtitle" style={{ display: "block", fontSize: 13.5 }}>
                  {m.name}{m.id === me ? <You /> : null}
                </span>
                <span className="rmeta" style={{ display: "block" }}>
                  {!on ? copy.split.notInvolved : money(shares[m.id] ?? 0, amountCurrency)}
                </span>
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
              {partCount === null ? null : <><b>{partCount}</b> {partCount === 1 ? copy.noun.part.one : copy.noun.part.many} · </>}
              <b>{inCount}</b> {copy.split.everyone.of(members.length)}
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
  if (items && items.length > 0) {
    const involved = members.filter((m) => included.has(m.id));
    return (
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <Link href={editItemsHref} data-refuse="receipt" className={`btn btn-p${flash}`} onAnimationEnd={onFlashEnd}
          style={{ textDecoration: "none", justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="users" size={16} />
            {included.size === 0 ? copy.scan.assignWhoHadWhat : copy.scan.editWhoHadWhat}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontWeight: 500, opacity: .85 }}>
            {plural(printedCount(items), copy.noun.item)}
            <Icon name="chev" size={14} />
          </span>
        </Link>
        {involved.length > 0 ? (
          <div className="hairline" style={{ margin: "0 0 -3px" }} />
        ) : null}
        {involved.map((m) => (
          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>{m.name}{m.id === me ? <You /> : null}</span>
            <span className="bignum" style={{ fontSize: 13.5 }}>{money(shares[m.id] ?? 0, currency)}</span>
          </div>
        ))}
        <div>
          <ScanPair scan={scan} register="xs" />
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
