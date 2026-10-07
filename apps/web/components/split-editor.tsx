"use client";

import Link from "next/link";
import {
  exactFigures, resolveSplit, restOf, splitParticipants, toggleEveryone,
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
 * Inline on the form, never a route: an expense is one thought. Nothing new is
 * written as `percent`; touching any tab converts one away. The receipt split
 * is never written here: it arrives as `receiptSplit` (ADR-0016). The tab bar
 * only reports a tap; the draft hands a new tab its start (`openSplitTab`).
 */

const MODES = ["equal", "shares", "exact"] as const;

/**
 * An "as amounts" row: a figure somebody typed, in with none (sharing what the
 * typed ones leave), or out. A tap goes typed → out → rest → out → rest…;
 * typing makes any row typed, and clearing a typed one leaves it sharing.
 */
type AmountRow = "typed" | "rest" | "out";

/** The exact spec, with no `rest` key when nobody floats (as `canonicalSplit` writes it). */
function exactSpec(amounts: Record<Id, number>, rest: Id[]): ArithmeticSplit {
  return rest.length > 0
    ? { mode: "exact", amounts, rest: [...new Set(rest)].sort() }
    : { mode: "exact", amounts };
}

interface ReceiptTabProps {
  items: { label: string; amount: string }[] | null;
  scan: ReceiptScan;
  /** For whichever control takes the outstanding step. Empty while no flash runs. */
  flash: string;
  onFlashEnd: (e: React.AnimationEvent) => void;
  editItemsHref: string;
}

export function SplitEditor({ members, me, title, amountMinor, amountCurrency, spec, receiptSplit, seed, onChange, tab, onTabChange, receipt }: {
  members: Member[];
  me: string | undefined;
  title: string;
  /** In the entry's own currency, as the payers are: the figures on the bill need no rate. */
  amountMinor: number;
  amountCurrency: string;
  /** The arithmetic tab now showing — the only thing this edits. */
  spec: SplitSpec;
  /** Null while the grid is unfilled. */
  receiptSplit: SplitSpec | null;
  seed: string;
  onChange: (next: ArithmeticSplit) => void;
  tab: SplitTab;
  onTabChange: (next: SplitTab) => void;
  /** Null on an income, which has no receipt. */
  receipt: ReceiptTabProps | null;
}) {
  const opts = { tiebreakSeed: seed };
  // Shows its numbers but has no tab: touching any tab converts it away.
  const legacy = spec.mode === "percent";
  const showReceipt = tab === "receipt" && receipt !== null;
  // Receipt draws none until its grid is filled: the spec underneath isn't what a save would write.
  const shown: SplitSpec | null = showReceipt ? receiptSplit : spec;
  const included = new Set(shown ? splitParticipants(shown) : []);

  let shares: Record<string, number> = {};
  if (shown) {
    try { shares = resolveSplit(amountMinor, shown, opts).shares; } catch { /* incomplete */ }
  }

  // As amounts: who shares the rest, what each gets, and whether there is any
  // to get. Over the total, or with less than a cent each, a share would be a
  // lie, so the rows say "?" — but never before there is an amount at all.
  const rest = new Set(restOf(spec));
  const figures = spec.mode === "exact" ? exactFigures(amountMinor, spec, opts) : {};
  const typedSum = spec.mode === "exact"
    ? Object.entries(spec.amounts).reduce((a, [id, v]) => a + (rest.has(id) ? 0 : v), 0) : 0;
  const restShort = amountMinor > 0 && rest.size > 0 && typedSum + rest.size > amountMinor;
  const rowOf = (id: Id): AmountRow =>
    rest.has(id) ? "rest" : spec.mode === "exact" && (spec.amounts[id] ?? 0) > 0 ? "typed" : "out";

  // What the split adds up to, right or wrong, is said in the Save dock
  // (`checkEntry`'s `splitProblem` and `splitTick`), where no scroll hides it.

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
      case "percent": {
        const bps = { ...spec.bps };
        if (next.has(memberId)) bps[memberId] = 0; else delete bps[memberId];
        return onChange({ mode: "percent", bps });
      }
    }
  }

  // The head box: one tap for the whole list, the same verb in every tab.
  // Three people at least: with two, the other row is the same one tap.
  const head = !showReceipt && (spec.mode === "equal" || spec.mode === "shares" || spec.mode === "exact")
    && members.length >= 3 ? spec : null;
  const inCount = members.filter((m) => included.has(m.id)).length;
  const headState = inCount === 0 ? "none" : inCount === members.length ? "all" : "some";

  function toggleAll() {
    if (head) onChange(toggleEveryone(head, members.map((m) => m.id)));
  }

  /** What the head box's tap would do, said the way the rows say theirs. */
  function headLabel(): string {
    return headState === "all" ? copy.split.everyone.out : copy.split.everyone.in;
  }

  /** As with amounts: having parts puts you in, none takes you out. */
  function setParts(memberId: string, parts: number) {
    if (spec.mode !== "shares") return;
    const weights = { ...spec.weights };
    const next = Math.min(MAX_PARTS, Math.max(0, parts));
    if (next === 0) delete weights[memberId]; else weights[memberId] = next;
    onChange({ mode: "shares", weights });
  }

  /** A figure makes the row typed; clearing one leaves it in, sharing the rest. */
  function setExact(memberId: string, minor: number) {
    if (spec.mode !== "exact") return;
    const amounts = { ...spec.amounts };
    const others = restOf(spec).filter((id) => id !== memberId);
    if (minor > 0) amounts[memberId] = minor;
    else delete amounts[memberId];
    onChange(exactSpec(amounts, minor > 0 ? others : [...others, memberId]));
  }

  /** A tap on the name: typed and rest go out, out joins the rest. It never types. */
  function tapRow(memberId: string) {
    if (spec.mode !== "exact") return;
    const amounts = { ...spec.amounts };
    // A rest row's figure is only a filled-in copy; out holds none.
    delete amounts[memberId];
    const others = restOf(spec).filter((id) => id !== memberId);
    onChange(exactSpec(amounts, rowOf(memberId) === "out" ? [...others, memberId] : others));
  }

  return (
    // No heading drawn: the tabs say what the box is. A lone ÷ parts
    // it from the fields above, which it otherwise reads as one more of. The
    // title is still its name to a reader; the mark is only for the eye.
    <section aria-label={title}>
      <div className="splitrule" aria-hidden="true"><span /></div>

      <div className="splitbox">
        <div className="seg">
          {/* `aria-pressed`: painting it says so only to an eye. */}
          {MODES.map((mode) => {
            const on = !showReceipt && !legacy && spec.mode === mode;
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
            // Where the right side is only a read-out, the toggle takes the whole
            // row: one that answers on its left half only reads as broken.
            const wholeRow = spec.mode === "equal" || spec.mode === "percent";
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
                {/* Typed like the amounts beside it: same caret, same walk down on Enter. */}
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
                {/* Never disabled: typing is how somebody joins. Enter walks down (`walkFields`).
                    A rest row's share is the placeholder, so the first digit replaces it. */}
                <MinorAmountInput id={fieldId} className="bignum splitin"
                  enterKeyHint={i === members.length - 1 ? "done" : "next"}
                  aria-label={copy.split.amountFor(m.name)}
                  currency={amountCurrency}
                  valueMinor={row === "typed" ? spec.amounts[m.id] ?? 0 : 0}
                  placeholder={row !== "rest" ? bare(0, amountCurrency)
                    : restShort ? "?" : bare(figures[m.id] ?? 0, amountCurrency)}
                  onChangeMinor={(minor) => setExact(m.id, minor)} />
              </span>
            ) : spec.mode === "percent" ? (
              <span className="bignum" style={{ fontSize: 14, color: on ? "var(--ink)" : "var(--muted)" }}>
                {(spec.bps[m.id] ?? 0) / 100}%
              </span>
            ) : (
              // Ink, not green: being in the split is not a credit.
              <span style={{ color: on ? "var(--ink)" : "var(--muted)" }}>
                <Icon name={on ? "check" : "plus"} size={16} />
              </span>
            );
            // The dimming rides on the name, so the plus stays legible. When typing,
            // the field is the figure, so no line under the name (`SoloName`).
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
                    {/* Inside the button, so the row is a target up to the field. */}
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
          // Right-aligned, so the box foots the column of ticks, plus signs
          // and figures above it, and the row never reads as a person. Only the
          // box is the control: a whole-row toggle read as one more row.
          // Sticky to the foot of `.scroll`, so a long list keeps it in reach,
          // and under the last row whenever that row is on screen.
          <div className="splithead">
            <span className="splitcount" aria-hidden="true"><b>{inCount}</b> {copy.split.everyone.of(members.length)}</span>
            <button type="button" className="allmark" onClick={toggleAll}
              role="checkbox" aria-checked={headState === "all" ? true : headState === "some" ? "mixed" : false}
              aria-label={`${copy.split.everyone.count(inCount, members.length)}. ${headLabel()}`}>
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

/**
 * An "as amounts" row's mark, in the column the payers' `TapMark` uses: × and +
 * say what a tap does, grey; the rest's tick says what the row is, in ink, as
 * Evenly's does — it is an even part of what is left.
 */
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
 * The typing door's dialog is rendered by `useReceiptScan`, never here: the
 * reading reshapes this panel, which would unmount it.
 */
function ReceiptPanel({
  items, scan, flash, onFlashEnd, editItemsHref,
  members, me, currency, shares, included,
}: ReceiptTabProps & {
  members: Member[];
  me: string | undefined;
  currency: string;
  /** In the bill's own currency. */
  shares: Record<string, number>;
  included: Set<string>;
}) {
  if (items && items.length > 0) {
    const involved = members.filter((m) => included.has(m.id));
    return (
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* What a refused Save blooms, as a fill rather than a border. */}
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
            <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>{m.name}</span>
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
        /* No "try again": the control right above is the retry. */
        <Failure>{scan.refusal}</Failure>
      ) : (
        <p className="scanterms" style={{ marginTop: 7 }}>{copy.scan.terms}</p>
      )}
    </div>
  );
}
