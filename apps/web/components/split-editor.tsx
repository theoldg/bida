"use client";

import {
  convertSplitMode, resolveSplit, splitParticipants, validateSplit,
  type Member, type SplitMode, type SplitSpec,
} from "@hajsik/core";
import { MinorAmountInput } from "./amount-input";
import { Avatar } from "./bits";
import { Icon } from "./icons";
import { bare, money, shortfallText } from "../lib/format";

/**
 * Who the money was spent on, and how much each of them owes for it.
 *
 * This used to be a screen of its own that you pushed onto the stack from the
 * expense form and popped back off with "Done". It isn't any more: an expense
 * is one thought — amount, what, who paid, who for — and pushing a route in
 * the middle of it meant a forward-and-back trip to answer a question the form
 * was already asking. It renders inline, on the form, and edits the same draft.
 *
 * Three modes, no more. "Percent" was the fourth and is gone from the UI —
 * nobody says "I'll take 33.33% of the taxi", they say "split it three ways"
 * or "I'll put in a tenner". `SplitSpec` still *has* a percent variant so that
 * expenses already recorded that way keep folding and keep rendering; nothing
 * new can be written in it, and switching mode converts one away for good.
 */

const MODES: { mode: SplitMode; label: string }[] = [
  { mode: "equal", label: "Evenly" },
  { mode: "shares", label: "As parts" },
  { mode: "exact", label: "As amounts" },
];

export function SplitEditor({ members, me, totalMinor, currency, spec, seed, onChange }: {
  members: Member[];
  me: string | undefined;
  /** The expense total in the group's base currency — what the split divides. */
  totalMinor: number;
  currency: string;
  spec: SplitSpec;
  seed: string;
  onChange: (next: SplitSpec) => void;
}) {
  const opts = { tiebreakSeed: seed };
  const included = new Set(splitParticipants(spec));
  const check = validateSplit(totalMinor, spec, opts);

  let shares: Record<string, number> = {};
  try { shares = resolveSplit(totalMinor, spec, opts).shares; } catch { /* incomplete */ }

  // A legacy percent split shows its rows and its numbers, but offers no mode
  // button of its own: touching any of the three converts it away.
  const legacy = spec.mode === "percent";

  function switchMode(mode: SplitMode) {
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
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Split</span>
        <span className="spacer" style={{ fontSize: 12, color: "var(--muted)" }}>
          {included.size} {included.size === 1 ? "person" : "people"}
        </span>
      </div>

      <div className="seg" style={{ marginBottom: 9 }}>
        {MODES.map((m) => (
          <button key={m.mode} type="button" className={!legacy && spec.mode === m.mode ? "on" : ""}
            onClick={() => switchMode(m.mode)}>{m.label}</button>
        ))}
      </div>

      <div className="card splitlist">
        {members.map((m) => {
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
                    {m.id === me ? "You" : m.name}
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
                <span style={{ color: on ? "var(--credit)" : "var(--muted)" }}>
                  <Icon name={on ? "check" : "plus"} size={16} />
                </span>
              )}
            </div>
          );
        })}

        <div className={`splitfoot ${check.ok ? "ok" : "bad"}`}>
          <Icon name={check.ok ? "check" : "off"} size={14} style={{ flex: "none" }} />
          <span>
            {check.ok
              ? `${money(check.allocatedMinor, currency)} of ${money(check.totalMinor, currency)} allocated`
              : shortfallText(check, currency, { under: "left to split", over: "too much" })}
          </span>
        </div>
      </div>
    </section>
  );
}
