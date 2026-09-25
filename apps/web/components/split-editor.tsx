"use client";

import Link from "next/link";
import {
  resolveSplit, splitParticipants, validateSplit,
  type ArithmeticSplit, type Member, type SplitSpec,
} from "@bida/core";
import { MinorAmountInput } from "./amount-input";
import { Failure } from "./chrome";
import { ScanPair, type ReceiptScan } from "./receipt-scan";
import { Icon } from "./icons";
import { keepsFocus } from "./bits";
import { copy } from "../lib/copy";
import { printedCount } from "../lib/scan/items";
import { bare, money, plural, splitFooter } from "../lib/format";
import type { SplitTab } from "../lib/draft";

/**
 * Who the money was spent on, and how much each of them owes for it.
 *
 * **Inline on the expense form, never a route of its own**: an expense is one
 * thought, and a round trip answers a question the form was already asking.
 *
 * Three arithmetic modes. `SplitSpec`'s `percent` variant still folds and
 * renders for old expenses, but **nothing new is written in it** — touching
 * any tab converts one away for good.
 *
 * A fourth tab, "Items", assigns a scanned bill (`/g/entry/items`, ADR-0016)
 * and produces a `receipt` split, a mode of its own. **This editor never
 * writes one** — it arrives as `receiptSplit`.
 *
 * **Each tab holds its own answer.** The tab bar only reports a tap; the draft
 * hands a newly opened tab its starting point (`openSplitTab`), once.
 */

/** The three arithmetic tabs, in display order. "Items" is the fourth. */
const MODES = ["equal", "shares", "exact"] as const;

interface ReceiptTabProps {
  items: { label: string; amount: string }[] | null;
  /** The scan, whole: its state, its clock and its two doors — `useReceiptScan`. */
  scan: ReceiptScan;
  /**
   * This tab hasn't produced a split yet (`checkEntry`'s `receiptMissing`). It
   * suppresses the arithmetic verdict underneath, and a refused Save blooms the
   * control instead (`flash`).
   */
  missing: boolean;
  /**
   * The refusal flash's class, for whichever control takes the outstanding step
   * — the scan pair with no bill, the grid's door with nobody assigned. Empty
   * while no flash runs.
   */
  flash: string;
  onFlashEnd: (e: React.AnimationEvent) => void;
  editItemsHref: string;
}

export function SplitEditor({ members, me, title, totalMinor, totalUnknown, currency, spec, receiptSplit, seed, onChange, tab, onTabChange, receipt }: {
  members: Member[];
  me: string | undefined;
  /** "Split" for both an expense and an income, "To" for a transfer — `copy.entryKind.split`. */
  title: string;
  /** The expense total in the group's base currency — what the split divides. */
  totalMinor: number;
  /**
   * The total isn't zero, it's unknowable: a foreign amount with no rate arrives
   * as 0. Shares read "—", not €0.00, and the footer stays out of it — the form
   * above names the missing rate.
   */
  totalUnknown?: boolean;
  currency: string;
  /** What the arithmetic tab now showing holds — this editor edits only it. */
  spec: SplitSpec;
  /**
   * What the receipt reads off its bill, or null while the grid is unfilled.
   * Drawn, never edited here.
   */
  receiptSplit: SplitSpec | null;
  seed: string;
  onChange: (next: ArithmeticSplit) => void;
  tab: SplitTab;
  onTabChange: (next: SplitTab) => void;
  /**
   * The Items tab, or null where a bill makes no sense — an income has no
   * receipt.
   */
  receipt: ReceiptTabProps | null;
}) {
  const opts = { tiebreakSeed: seed };
  // A legacy percent split shows its rows and its numbers, but offers no mode
  // button of its own: touching any of the three arithmetic tabs converts it away.
  const legacy = spec.mode === "percent";
  const showReceipt = tab === "receipt" && receipt !== null;
  // Receipt draws its own split, and none until its grid is filled: an
  // arithmetic tab's split here would be a verdict on a tab nobody is using.
  const shown: SplitSpec | null = showReceipt ? receiptSplit : spec;
  const included = new Set(shown ? splitParticipants(shown) : []);
  const check = shown ? validateSplit(totalMinor, shown, opts) : null;

  let shares: Record<string, number> = {};
  if (shown) {
    try { shares = resolveSplit(totalMinor, shown, opts).shares; } catch { /* incomplete */ }
  }

  // "N of total allocated" only means something when typing amounts: Evenly
  // and As parts land on the total by construction, and Receipt's is derived.
  // Every mode still surfaces a real problem (nobody, over-allocated, no total).
  const isExactTab = !showReceipt && !legacy && spec.mode === "exact";
  // Receipt's own shortfall outranks the arithmetic: while the tab has no
  // split of its own, whatever spec is underneath (often "equal") is not what
  // is being judged, so its verdict would be a verdict on nothing.
  const receiptMissing = showReceipt && (receipt?.missing ?? false);
  // **`splitFooter`, not `check`, decides the wording and whether there is a
  // footer**: a zero total is arithmetically satisfied and must never show a
  // tick.
  //
  // An Items tab short of its split says nothing here — a refused Save blooms
  // the control. **It must never fall through to the arithmetic underneath**:
  // that spec is not what a save would write.
  const foot = receiptMissing ? null
    : check !== null ? splitFooter(check, currency) : null;
  const showFooter = !totalUnknown && foot !== null
    && (showReceipt ? !foot.ok : (isExactTab || !foot.ok));

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
      // "As amounts" has no toggle: `setExact` is the whole control.
      case "exact": return;
      case "percent": {
        const bps = { ...spec.bps };
        if (next.has(memberId)) bps[memberId] = 0; else delete bps[memberId];
        return onChange({ mode: "percent", bps });
      }
    }
  }

  function setWeight(memberId: string, delta: number) {
    if (spec.mode !== "shares") return;
    const weights = { ...spec.weights };
    const next = Math.max(0, (weights[memberId] ?? 0) + delta);
    if (next === 0) delete weights[memberId]; else weights[memberId] = next;
    onChange({ mode: "shares", weights });
  }

  /**
   * In "as amounts" the figure *is* the statement: having one puts you in the
   * split, clearing it takes you out. **No tick to set first.**
   */
  function setExact(memberId: string, minor: number) {
    if (spec.mode !== "exact") return;
    const amounts = { ...spec.amounts };
    if (minor > 0) amounts[memberId] = minor; else delete amounts[memberId];
    onChange({ mode: "exact", amounts });
  }

  /** Hand whatever is unallocated to one person — the usual last keystroke. */
  function giveRest(memberId: string) {
    if (spec.mode !== "exact") return;
    const others = Object.entries(spec.amounts)
      .filter(([id]) => id !== memberId)
      .reduce((a, [, v]) => a + (v ?? 0), 0);
    onChange({ mode: "exact", amounts: { ...spec.amounts, [memberId]: Math.max(0, totalMinor - others) } });
  }

  return (
    <section>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>{title}</span>
        <span className="spacer" style={{ fontSize: 12, color: "var(--muted)" }}>
          {plural(included.size, copy.noun.person)}
        </span>
      </div>

      {/* Tabs and the tab's contents are one box — `.splitbox`. */}
      <div className="splitbox">
        <div className="seg">
          {/* `aria-pressed`, not just the class: which mode is on is the whole
              state of this control, and painting it says so only to an eye. */}
          {MODES.map((mode) => {
            const on = !showReceipt && !legacy && spec.mode === mode;
            return (
              <button key={mode} type="button" className={on ? "on" : ""} aria-pressed={on}
                onClick={() => onTabChange(mode)} {...keepsFocus}>{copy.split.mode[mode]}</button>
            );
          })}
          {receipt ? (
            <button type="button" className={showReceipt ? "on" : ""} aria-pressed={showReceipt}
              onClick={() => onTabChange("receipt")} {...keepsFocus}>
              {copy.split.receipt}
            </button>
          ) : null}
        </div>

        <div className="splitlist">
          {showReceipt && receipt ? (
            <ReceiptPanel {...receipt} members={members} me={me} currency={currency}
              shares={shares} included={included} />
          ) : members.map((m, i) => {
            const on = included.has(m.id);
            // Where the right side is only a read-out (Evenly's tick/plus, a legacy
            // percentage), the toggle takes the whole row: a row that answers on its
            // left half only reads as broken. As parts and as amounts keep their controls.
            const wholeRow = spec.mode === "equal" || spec.mode === "percent";
            // "As amounts" has nothing to toggle, so its left half is a label
            // for the field rather than a button that would do nothing.
            const typing = spec.mode === "exact";
            const fieldId = `sp-${m.id}`;
            const end = spec.mode === "shares" ? (
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button type="button" onClick={() => setWeight(m.id, -1)} {...keepsFocus} aria-label={copy.split.fewerParts(m.name)}
                  style={{ fontSize: 18, color: on ? "var(--ink)" : "var(--muted)" }}>−</button>
                <span className="bignum" style={{ fontSize: 15, width: 14, textAlign: "center",
                  color: on ? "var(--ink)" : "var(--muted)" }}>
                  {spec.weights[m.id] ?? 0}
                </span>
                <button type="button" onClick={() => setWeight(m.id, 1)} {...keepsFocus} aria-label={copy.split.moreParts(m.name)}
                  style={{ fontSize: 18 }}>+</button>
              </span>
            ) : spec.mode === "exact" ? (
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                {/* Offered on a row with nothing in it too: somebody who has
                    typed no amount yet is exactly who you hand the rest to. */}
                {check && !check.ok ? (
                  <button type="button" className="chip" onClick={() => giveRest(m.id)} {...keepsFocus}
                    aria-label={copy.split.giveRest(m.name)}>{copy.split.rest}</button>
                ) : null}
                {/* Never disabled. Every row can be typed into, whoever any
                    other tab has ticked: typing is how somebody joins this one. */}
                {/* A column of figures is typed down: the confirm key moves to the
                    next person, and the last row says "done" (`walkFields`,
                    components/viewport.tsx). */}
                <MinorAmountInput id={fieldId} className="bignum splitin"
                  enterKeyHint={i === members.length - 1 ? "done" : "next"}
                  aria-label={copy.split.amountFor(m.name)}
                  currency={currency}
                  valueMinor={spec.amounts[m.id] ?? 0}
                  placeholder={bare(0, currency)}
                  onChangeMinor={(minor) => setExact(m.id, minor)} />
              </span>
            ) : spec.mode === "percent" ? (
              <span className="bignum" style={{ fontSize: 14, color: on ? "var(--ink)" : "var(--muted)" }}>
                {(spec.bps[m.id] ?? 0) / 100}%
              </span>
            ) : (
              <span style={{
                // Ink, not credit green: being in the split is not a credit,
                // and green is reserved for money.
                color: on ? "var(--ink)" : "var(--muted)",
              }}>
                <Icon name={on ? "check" : "plus"} size={16} />
              </span>
            );
            // The dimming rides on the name, not the button: the plus is the
            // affordance for putting someone back in and must stay legible on a
            // row that is otherwise faded out.
            const name = (
              <span className="rmain" style={{ opacity: on ? 1 : .45 }}>
                <span className="rtitle" style={{ display: "block", fontSize: 13.5 }}>
                  {m.name}
                </span>
                <span className="rmeta" style={{ display: "block" }}>
                  {/* In "as amounts" the field beside this line already is the figure,
                      and a stray "€0.00" under it would contradict it. */}
                  {!on ? copy.split.notInvolved
                    : typing ? ""
                    : totalUnknown ? copy.none
                    : money(shares[m.id] ?? 0, currency)}
                </span>
              </span>
            );
            const lead = { display: "flex", gap: 10, alignItems: "center", flex: 1, minWidth: 0 } as const;
            return (
              <div key={m.id} className={`splitrow${m.id === me ? " mine" : ""}`}>
                {typing ? (
                  <label htmlFor={fieldId} style={lead}>{name}</label>
                ) : (
                  <button type="button" onClick={() => toggle(m.id)} {...keepsFocus}
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

          {/* Only the satisfied verdict wears a glyph. The unsatisfied one used
              the offline icon, which says "no wifi" and nothing about a split. */}
          {showFooter && foot ? (
            <div className={`splitfoot ${foot.ok ? "ok" : "bad"}`}>
              {foot.ok ? <Icon name="check" size={14} style={{ flex: "none" }} /> : null}
              <span>{foot.text}</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/**
 * The fourth tab's content: the scan control before there's a bill, then
 * "edit who-had-what" plus that control at chip scale. Works on a saved
 * expense too (ADR-0016); a fresh reading replaces the items/tip and resets
 * the grid.
 *
 * **What the typing door opens is rendered by `useReceiptScan`, never here**:
 * the reading reshapes this panel, which would unmount a dialog inside it.
 */
function ReceiptPanel({
  items, scan, flash, onFlashEnd, editItemsHref,
  members, me, currency, shares, included,
}: ReceiptTabProps & {
  members: Member[];
  me: string | undefined;
  currency: string;
  /** Each involved member's share of the receipt, in the group's base currency. */
  shares: Record<string, number>;
  included: Set<string>;
}) {
  if (items && items.length > 0) {
    const involved = members.filter((m) => included.has(m.id));
    return (
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* The step outstanding on a scanned bill is assigning it, so this is
            the control a refused Save blooms — an ink block, which takes the
            flash as a fill rather than a border. */}
        <Link href={editItemsHref} data-refuse="receipt" className={`btn btn-p${flash}`} onAnimationEnd={onFlashEnd} {...keepsFocus}
          style={{ textDecoration: "none", justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="users" size={16} />
            {/* Nobody on the bill means it has never been assigned, so "Assign"
                rather than "Edit". `included` is read off the receipt split, which
                doesn't exist until the grid is filled. */}
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
          {/* Nothing to refuse here: with a bill on screen the outstanding
              step is the door above, not another photograph. */}
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
      {/* The halves name their two doors and not the job, which the line
          under them says: a photograph is what fills this tab. With no bill
          yet, this is the control a refused Save fills. */}
      <div data-refuse="receipt">
        <ScanPair scan={scan} register="s" flash={flash} onFlashEnd={onFlashEnd} />
      </div>
      {scan.refusal ? (
        /* No "try again" beside the message: the control is right above it,
           still enabled, and it is the retry. */
        <Failure>{scan.refusal}</Failure>
      ) : (
        /* The same disclosure, drawn the same way, as the scanning screens
           carry under their own control. */
        <p className="scanterms" style={{ marginTop: 7 }}>{copy.scan.terms}</p>
      )}
    </div>
  );
}
