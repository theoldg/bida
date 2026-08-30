"use client";

import Link from "next/link";
import {
  convertSplitMode, resolveSplit, splitParticipants, validateSplit,
  type Member, type SplitSpec,
} from "@hajsik/core";
import { MinorAmountInput } from "./amount-input";
import { Avatar } from "./bits";
import { Failure } from "./chrome";
import { Icon } from "./icons";
import { bare, money, splitFooter, SPLIT_MODE_LABEL } from "../lib/format";
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
 * A fourth tab, "Receipt", sits beside them — scanning a bill and assigning
 * who-had-what (`/g/expense/items`, ADR-0016) reduces to an ordinary `shares`
 * spec, so it isn't a fifth `SplitMode`. It's tracked as its own tab
 * (`SplitTab`, `lib/draft.ts`) precisely so the UI can still say "Receipt"
 * once that reduction has happened, instead of falling back to "As parts".
 */

/** The three arithmetic tabs, in the owner's order. "Receipt" is the fourth. */
const MODES = ["equal", "shares", "exact"] as const;

/** Where a scan is: idle, in flight, or refused. Owned by the expense form. */
export type ScanState = "idle" | "scanning" | "error";
/** Which button started the scan in flight — only that one shows the spinner. */
export type ScanSource = "camera" | "library" | null;

export interface ReceiptTabProps {
  items: { label: string; amount: string }[] | null;
  scanDisabled: boolean;
  scanState: ScanState;
  scanSource: ScanSource;
  /** Set when the model read the photo but declined it (not a receipt, too blurry) — shown verbatim instead of the generic message. */
  scanError: string | null;
  onScanCamera: () => void;
  onScanLibrary: () => void;
  editItemsHref: string;
}

export function SplitEditor({ members, me, title, totalMinor, currency, spec, seed, onChange, tab, onTabChange, receipt }: {
  members: Member[];
  me: string | undefined;
  /** "Split" on an expense, "Shared with" on an income — `ENTRY_SPLIT_LABEL`. */
  title: string;
  /** The expense total in the group's base currency — what the split divides. */
  totalMinor: number;
  currency: string;
  spec: SplitSpec;
  seed: string;
  onChange: (next: SplitSpec) => void;
  tab: SplitTab;
  onTabChange: (next: SplitTab) => void;
  /**
   * The Receipt tab, or null where scanning a bill makes no sense — an income
   * has no receipt to read a total off, and offering the tab there would put
   * a dead end in the middle of the form.
   */
  receipt: ReceiptTabProps | null;
}) {
  const opts = { tiebreakSeed: seed };
  const included = new Set(splitParticipants(spec));
  const check = validateSplit(totalMinor, spec, opts);

  let shares: Record<string, number> = {};
  try { shares = resolveSplit(totalMinor, spec, opts).shares; } catch { /* incomplete */ }

  // A legacy percent split shows its rows and its numbers, but offers no mode
  // button of its own: touching any of the three arithmetic tabs converts it away.
  const legacy = spec.mode === "percent";
  const showReceipt = tab === "receipt" && receipt !== null;
  const hasReceiptItems = (receipt?.items?.length ?? 0) > 0;
  // "N of total allocated" only means something where you're typing amounts
  // yourself — Evenly and As parts always land exactly on the total by
  // construction, and Receipt's total is derived from the bill, not typed.
  // All three would otherwise show that line trivially satisfied. Every mode
  // still surfaces a real problem (nobody included, over-allocated, no total
  // to divide) when there is one.
  const isExactTab = !showReceipt && !legacy && spec.mode === "exact";
  // `splitFooter` — not `check` — decides both the wording and the verdict:
  // a zero total is arithmetically a satisfied split and must never be shown
  // as one, so "ok" here means "ok to show a tick", not `check.ok`.
  const foot = splitFooter(check, currency);
  // Nothing to check yet if the receipt tab hasn't produced a split — showing
  // whatever the underlying spec still is (often "equal") would read as a
  // verdict on a tab that has no opinion.
  const showFooter = showReceipt ? (hasReceiptItems && !foot.ok) : (isExactTab || !foot.ok);

  function switchMode(mode: "equal" | "shares" | "exact") {
    onTabChange(mode);
    // Switching keeps everyone's current amounts rather than resetting them,
    // so you can start even and nudge one person without losing the rest.
    onChange(convertSplitMode(totalMinor, spec, mode, opts));
  }

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
      case "exact": {
        const amounts = { ...spec.amounts };
        if (next.has(memberId)) amounts[memberId] = 0; else delete amounts[memberId];
        return onChange({ mode: "exact", amounts });
      }
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

  function setExact(memberId: string, minor: number) {
    if (spec.mode !== "exact") return;
    onChange({ mode: "exact", amounts: { ...spec.amounts, [memberId]: minor } });
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
          {included.size} {included.size === 1 ? "person" : "people"}
        </span>
      </div>

      <div className="seg" style={{ marginBottom: 9 }}>
        {MODES.map((mode) => (
          <button key={mode} type="button" className={!showReceipt && !legacy && spec.mode === mode ? "on" : ""}
            onClick={() => switchMode(mode)}>{SPLIT_MODE_LABEL[mode]}</button>
        ))}
        {receipt ? (
          <button type="button" className={showReceipt ? "on" : ""} onClick={() => onTabChange("receipt")}>
            Receipt
          </button>
        ) : null}
      </div>

      <div className="card splitlist">
        {showReceipt && receipt ? (
          <ReceiptPanel {...receipt} members={members} me={me} currency={currency}
            shares={shares} included={included} />
        ) : members.map((m) => {
          const on = included.has(m.id);
          return (
            <div key={m.id} className={`splitrow${m.id === me ? " mine" : ""}`}>
              <button type="button" onClick={() => toggle(m.id)}
                aria-label={on ? `Leave ${m.name} out` : `Include ${m.name}`}
                style={{ display: "flex", gap: 10, alignItems: "center", flex: 1, minWidth: 0,
                  opacity: on ? 1 : .45 }}>
                <Avatar member={m} size={28} />
                <span className="rmain">
                  <span className="rtitle" style={{ display: "block", fontSize: 13.5 }}>
                    {m.name}
                  </span>
                  <span className="rmeta" style={{ display: "block" }}>
                    {/* In "as amounts" the field beside this line already *is*
                        the figure, and while the split is short it can't be
                        resolved anyway — a stray "€0.00" under a row saying
                        40.00 is worse than nothing. */}
                    {!on ? "not involved" : spec.mode === "exact" ? "" : money(shares[m.id] ?? 0, currency)}
                  </span>
                </span>
              </button>

              {spec.mode === "shares" ? (
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button type="button" onClick={() => setWeight(m.id, -1)} aria-label={`Fewer parts for ${m.name}`}
                    style={{ fontSize: 18, color: on ? "var(--ink)" : "var(--muted)" }}>−</button>
                  <span className="bignum" style={{ fontSize: 15, width: 14, textAlign: "center",
                    color: on ? "var(--ink)" : "var(--muted)" }}>
                    {spec.weights[m.id] ?? 0}
                  </span>
                  <button type="button" onClick={() => setWeight(m.id, 1)} aria-label={`More parts for ${m.name}`}
                    style={{ fontSize: 18 }}>+</button>
                </span>
              ) : spec.mode === "exact" ? (
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  {on && !check.ok ? (
                    <button type="button" className="chip" onClick={() => giveRest(m.id)}
                      aria-label={`Give ${m.name} the rest`}>rest</button>
                  ) : null}
                  <MinorAmountInput className="bignum splitin" aria-label={`${m.name}'s amount`}
                    currency={currency}
                    valueMinor={on ? spec.amounts[m.id] ?? 0 : 0}
                    placeholder={bare(0, currency)}
                    disabled={!on}
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
              )}
            </div>
          );
        })}

        {showFooter ? (
          <div className={`splitfoot ${foot.ok ? "ok" : "bad"}`}>
            <Icon name={foot.ok ? "check" : "off"} size={14} style={{ flex: "none" }} />
            <span>{foot.text}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The fourth tab's content: scan/upload before there's a bill, "edit
 * who-had-what" plus a smaller rescan/upload pair once there is one — always
 * available, including on an already-saved expense (ADR-0019, superseding
 * ADR-0016's new-expense-only restriction). A fresh scan replaces the old
 * items/tip and resets the who-had-what grid, same as the first scan.
 */
function ScanButtons({ scanDisabled, scanState, scanSource, onScanCamera, onScanLibrary, size }: {
  scanDisabled: boolean;
  scanState: ScanState;
  scanSource: ScanSource;
  onScanCamera: () => void;
  onScanLibrary: () => void;
  /** "s" for the first-scan pair, "xs" for the smaller replace-receipt pair. */
  size: "s" | "xs";
}) {
  const busy = scanState === "scanning";
  const disabledOpacity = size === "xs" ? { opacity: scanDisabled || busy ? .5 : 1 } : undefined;
  return (
    <div style={{ display: "flex", gap: 7 }}>
      <button type="button" className={size === "s" ? "btn btn-s" : "chip"} disabled={scanDisabled || busy}
        style={disabledOpacity} onClick={onScanCamera}>
        {busy && scanSource === "camera"
          ? <span className="spinner" aria-hidden="true" /> : <Icon name="cam" size={size === "s" ? 16 : 13} />}
        {busy && scanSource === "camera" ? "Reading…" : size === "s" ? "Scan a receipt" : "Rescan"}
      </button>
      <button type="button" className={size === "s" ? "btn btn-s" : "chip"} disabled={scanDisabled || busy}
        style={disabledOpacity} onClick={onScanLibrary}>
        {busy && scanSource === "library"
          ? <span className="spinner" aria-hidden="true" /> : <Icon name="image" size={size === "s" ? 16 : 13} />}
        {busy && scanSource === "library" ? "Reading…" : "Upload"}
      </button>
    </div>
  );
}

function ReceiptPanel({
  items, scanDisabled, scanState, scanSource, scanError, onScanCamera, onScanLibrary, editItemsHref,
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
        <Link href={editItemsHref} className="btn btn-p" style={{ textDecoration: "none", justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="users" size={16} />
            Edit who-had-what
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontWeight: 500, opacity: .85 }}>
            {items.length} item{items.length === 1 ? "" : "s"}
            <Icon name="chev" size={14} />
          </span>
        </Link>
        {involved.length > 0 ? (
          <div className="hairline" style={{ margin: "0 0 -3px" }} />
        ) : null}
        {involved.map((m) => (
          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar member={m} size={22} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>{m.name}</span>
            <span className="bignum" style={{ fontSize: 13.5 }}>{money(shares[m.id] ?? 0, currency)}</span>
          </div>
        ))}
        <div>
          <ScanButtons scanDisabled={scanDisabled} scanState={scanState} scanSource={scanSource}
            onScanCamera={onScanCamera} onScanLibrary={onScanLibrary} size="xs" />
          {scanState === "error" ? (
            <Failure>{scanError ?? "Couldn't read that receipt."} The old one is still assigned.</Failure>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      <ScanButtons scanDisabled={scanDisabled} scanState={scanState} scanSource={scanSource}
        onScanCamera={onScanCamera} onScanLibrary={onScanLibrary} size="s" />
      {scanState === "error" ? (
        <Failure>
          {scanError ?? "Couldn't read that receipt."}{" "}
          <button type="button" className="action" style={{ fontSize: "inherit" }} onClick={onScanCamera}>
            Try again
          </button>
        </Failure>
      ) : (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 7 }}>
          Runs on Google's free tier — the photo may be used to improve their models.
        </div>
      )}
    </div>
  );
}
