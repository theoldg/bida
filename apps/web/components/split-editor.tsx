"use client";

import Link from "next/link";
import { useState } from "react";
import {
  resolveSplit, splitParticipants, validateSplit,
  type ArithmeticSplit, type Member, type SplitSpec,
} from "@bida/core";
import { MinorAmountInput } from "./amount-input";
import { Failure } from "./chrome";
import { ScanPair, type ReceiptScan } from "./receipt-scan";
import { BillTextDialog } from "./bill-text-dialog";
import { Icon } from "./icons";
import { keepsFocus } from "./bits";
import { copy } from "../lib/copy";
import { bare, money, plural, splitFooter } from "../lib/format";
import type { SplitTab } from "../lib/draft";

/**
 * Who the money was spent on, and how much each of them owes for it.
 *
 * This used to be a screen of its own that you pushed onto the stack from the
 * expense form and popped back off with "Done". It isn't any more: an expense
 * is one thought — amount, what, who paid, who for — and pushing a route in
 * the middle of it meant a forward-and-back trip to answer a question the form
 * was already asking. It renders inline, on the form, and edits the same draft.
 *
 * Three arithmetic modes, no more. "Percent" was a fourth and is gone from
 * the UI — nobody says "I'll take 33.33% of the taxi", they say "split it
 * three ways" or "I'll put in a tenner". `SplitSpec` still *has* a percent
 * variant so that expenses already recorded that way keep folding and keep
 * rendering; nothing new can be written in it, and switching mode converts
 * one away for good.
 *
 * A fourth tab, "Items", sits beside them — scanning a bill and assigning
 * who-had-what (`/g/expense/items`, ADR-0016). What that produces is a
 * `receipt` split, a mode of its own: it divides by weight the way As parts
 * does, and that is the whole of the resemblance. This editor never writes
 * one — the bill does, and it arrives here as `receiptSplit`.
 *
 * **Each tab holds its own answer.** This editor draws one of them and edits
 * only that one: the tab bar reports a tap and nothing else — the draft is
 * where a newly opened tab is handed a starting point (`openSplitTab`), once.
 * Receipt's split arrives separately, as `receiptSplit`, and never lands in
 * the arithmetic tabs' inputs.
 */

/** The three arithmetic tabs, in the owner's order. "Items" is the fourth. */
const MODES = ["equal", "shares", "exact"] as const;

interface ReceiptTabProps {
  items: { label: string; amount: string }[] | null;
  /**
   * The bill as text, when that is how it arrived — so "Type it in" reopens
   * holding what was typed rather than a blank box over a bill it can't explain
   * (`EntryDraft.receiptText`). Null on a photographed bill.
   */
  text: string | null;
  /** The scan, whole: its state, its clock and its two doors — `useReceiptScan`. */
  scan: ReceiptScan;
  /**
   * This tab hasn't produced a split yet — `checkEntry`'s `receiptMissing`.
   * Nothing is said about it in words: it suppresses the arithmetic verdict
   * underneath, which would be a verdict on a split nobody is saving, and a
   * refused Save blooms the control instead (`flash` below).
   */
  missing: boolean;
  /**
   * The refusal flash, from the form that owns it: the class that blooms
   * whichever control takes the step still outstanding — the scan pair where
   * there is no bill, the door to the grid where nobody has been assigned a
   * line of one. Empty while no flash is running.
   */
  flash: string;
  onFlashEnd: (e: React.AnimationEvent) => void;
  editItemsHref: string;
}

export function SplitEditor({ members, me, title, totalMinor, totalUnknown, currency, spec, receiptSplit, seed, onChange, tab, onTabChange, receipt }: {
  members: Member[];
  me: string | undefined;
  /** "Split" on an expense, "Shared with" on an income — `copy.entryKind.split`. */
  title: string;
  /** The expense total in the group's base currency — what the split divides. */
  totalMinor: number;
  /**
   * The total isn't zero, it's unknowable: a foreign amount the group has no
   * rate for arrives here as 0. Each member's share reads "—" rather than a
   * confident €0.00, and the footer stays out of it — what is missing is a
   * rate, and the form above says so.
   */
  totalUnknown?: boolean;
  currency: string;
  /** What the arithmetic tab now showing holds — this editor edits only it. */
  spec: SplitSpec;
  /**
   * What the receipt reads off its own bill, or null while its grid is
   * unfilled. It is drawn, never edited: Receipt is a fourth answer beside
   * the three, not a fourth way of writing one of them.
   */
  receiptSplit: SplitSpec | null;
  seed: string;
  onChange: (next: ArithmeticSplit) => void;
  tab: SplitTab;
  onTabChange: (next: SplitTab) => void;
  /**
   * The Items tab, or null where scanning a bill makes no sense — an income
   * has no receipt to read a total off, and offering the tab there would put
   * a dead end in the middle of the form.
   */
  receipt: ReceiptTabProps | null;
}) {
  const opts = { tiebreakSeed: seed };
  // A legacy percent split shows its rows and its numbers, but offers no mode
  // button of its own: touching any of the three arithmetic tabs converts it away.
  const legacy = spec.mode === "percent";
  const showReceipt = tab === "receipt" && receipt !== null;
  // The split on screen. Receipt draws its own, and draws none at all until
  // its grid has been filled in: what the arithmetic tabs hold is theirs, and
  // showing one of them here would be a verdict on a tab nobody is looking at.
  const shown: SplitSpec | null = showReceipt ? receiptSplit : spec;
  const included = new Set(shown ? splitParticipants(shown) : []);
  const check = shown ? validateSplit(totalMinor, shown, opts) : null;

  let shares: Record<string, number> = {};
  if (shown) {
    try { shares = resolveSplit(totalMinor, shown, opts).shares; } catch { /* incomplete */ }
  }

  // "N of total allocated" only means something where you're typing amounts
  // yourself — Evenly and As parts always land exactly on the total by
  // construction, and Receipt's total is derived from the bill, not typed.
  // All three would otherwise show that line trivially satisfied. Every mode
  // still surfaces a real problem (nobody included, over-allocated, no total
  // to divide) when there is one.
  const isExactTab = !showReceipt && !legacy && spec.mode === "exact";
  // Receipt's own shortfall outranks the arithmetic: while the tab has no
  // split of its own, whatever spec is underneath (often "equal") is not what
  // is being judged, so its verdict would be a verdict on nothing.
  const receiptMissing = showReceipt && (receipt?.missing ?? false);
  // `splitFooter` — not `check` — decides the wording, the verdict and whether
  // there is a footer at all: a zero total is arithmetically a satisfied split
  // and must never be shown as one, so "ok" here means "ok to show a tick",
  // not `check.ok`, and a split with no amount behind it says nothing.
  //
  // A Items tab still short of its own split says nothing here either. The
  // step left — a bill to photograph, or a bill to assign — used to be a red
  // sentence in this footer, and it was a sentence for a state that is true of
  // every untouched scan; a refused Save now blooms the control that takes the
  // step, the way a missing amount blooms the amount. What the footer must
  // still not do is fall through to the arithmetic underneath: the spec behind
  // the tab (often "equal") is not what a save would write, so its verdict
  // would be a verdict on nothing.
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
   * The figure *is* the statement in "as amounts": whoever has one is in the
   * split, and clearing it takes them out. There is no tick to hunt for first
   * — a field you had to unlock on another tab is what made this mode only
   * usable for whoever Evenly happened to have ticked.
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
          ) : members.map((m) => {
            const on = included.has(m.id);
            // Where the right-hand side is only a read-out — the tick/plus of
            // "evenly", a legacy percentage — the toggle button swallows it, so
            // the whole row answers to a tap. A row that looks like one target
            // and responds on its left half only reads as broken, and the plus
            // is the very thing you aim at to put someone back in. "As parts"
            // and "as amounts" put their own controls there and keep them.
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
                <MinorAmountInput id={fieldId} className="bignum splitin"
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
                  {/* In "as amounts" the field beside this line already *is* the
                      figure, and while the split is short it can't be resolved
                      anyway — a stray "€0.00" under a row saying 40.00 is worse
                      than nothing. */}
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
 * The fourth tab's content: the one control that reads a bill before there's
 * one, "edit who-had-what" plus that same control at chip scale once there is —
 * always available, including on an already-saved expense (ADR-0016,
 * superseding ADR-0016's new-expense-only restriction). A fresh reading replaces
 * the old items/tip and resets the who-had-what grid, same as the first one.
 *
 * The control's third door, and the only place in the app that offers it, is
 * typing the bill instead of photographing it — which is a dialog rather than a
 * screen, because what it fills is the draft this form is already editing.
 */
function ReceiptPanel(props: ReceiptTabProps & {
  members: Member[];
  me: string | undefined;
  currency: string;
  shares: Record<string, number>;
  included: Set<string>;
}) {
  // This tab's own dialog, opened by the door beside the scan pair. It is state
  // and not a route: typing a bill in fills the draft the form is already
  // editing, so there is nowhere to go and nothing to come back from.
  //
  // **It is a sibling of the panel and not inside it.** The panel has two shapes
  // — a bill, or the control that gets one — and the reading this dialog starts
  // is exactly what moves it from the second to the first. Rendered within
  // either shape, the dialog changed position in the tree the moment its own
  // answer landed, and React unmounted it and mounted a fresh one: a box that
  // reopened holding what had just been read, over a bill that had just arrived.
  const [typing, setTyping] = useState(false);
  return (
    <>
      <ReceiptBody {...props} onType={() => setTyping(true)} />
      {typing ? (
        <BillTextDialog scan={props.scan} initial={props.text ?? ""}
          onClose={() => setTyping(false)} />
      ) : null}
    </>
  );
}

/** The panel's two shapes: a bill that has arrived, or the control that gets one. */
function ReceiptBody({
  items, scan, flash, onFlashEnd, editItemsHref,
  members, me, currency, shares, included, onType,
}: ReceiptTabProps & {
  members: Member[];
  me: string | undefined;
  currency: string;
  /** Each involved member's share of the receipt, in the group's base currency. */
  shares: Record<string, number>;
  included: Set<string>;
  /** Open the dialog, which is the panel's sibling — see `ReceiptPanel`. */
  onType: () => void;
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
            {/* Nobody on the bill yet means the work has not been done once,
                and "Edit" invites you to correct something that isn't there.
                `included` is empty exactly then: it is read off the receipt
                split, which does not exist until the grid is filled. */}
            {included.size === 0 ? copy.scan.assignWhoHadWhat : copy.scan.editWhoHadWhat}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontWeight: 500, opacity: .85 }}>
            {plural(items.length, copy.noun.item)}
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
          <ScanPair scan={scan} register="xs" onType={onType} />
          {scan.live?.state === "error" ? (
            <Failure>{scan.live.error ?? copy.scan.failed} {copy.scan.keptOld}</Failure>
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
        <ScanPair scan={scan} register="s" flash={flash} onFlashEnd={onFlashEnd}
          onType={onType} />
      </div>
      {scan.live?.state === "error" ? (
        /* No "try again" beside the message: the control is right above it,
           still enabled, and it is the retry. */
        <Failure>{scan.live.error ?? copy.scan.failed}</Failure>
      ) : (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 7 }}>
          {copy.scan.terms}
        </div>
      )}
    </div>
  );
}
