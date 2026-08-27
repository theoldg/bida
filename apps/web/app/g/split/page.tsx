"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  convertMinor, convertSplitMode, isValidRate, parseMinor, resolveSplit, splitParticipants,
  validateSplit, type SplitMode, type SplitSpec,
} from "@hajsik/core";
import { Avatar, Card } from "../../../components/bits";
import { Body, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { Icon } from "../../../components/icons";
import { bare, money } from "../../../lib/format";
import { useGroupData } from "../../../lib/hooks";
import { saveDraft, useDraft } from "../../../lib/draft";

const MODES: { mode: SplitMode; label: string }[] = [
  { mode: "equal", label: "Equally" },
  { mode: "exact", label: "Exact" },
  { mode: "shares", label: "Shares" },
  { mode: "percent", label: "%" },
];

export default function SplitPage() {
  return <QueryBoundary><SplitScreen /></QueryBoundary>;
}

function SplitScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const draft = useDraft(groupId);

  if (!groupId || !data.group || !draft) {
    return <Screen><Body><TopBar title="How to split" back={true} /></Body></Screen>;
  }
  const base = data.group.baseCurrency;

  let amountMinor = 0;
  try { amountMinor = draft.amountText ? parseMinor(draft.amountText, draft.currency) : 0; } catch { /* mid-type */ }
  const totalMinor = draft.currency === base || !isValidRate(draft.rateToBase)
    ? amountMinor
    : convertMinor(amountMinor, draft.currency, base, draft.rateToBase);

  const spec = draft.split;
  const seed = { tiebreakSeed: draft.expenseId ?? "new" };
  const included = new Set(splitParticipants(spec));
  const check = validateSplit(totalMinor, spec, seed);

  let shares: Record<string, number> = {};
  try { shares = resolveSplit(totalMinor, spec, seed).shares; } catch { /* incomplete */ }

  const setSpec = (next: SplitSpec) => saveDraft(groupId, { ...draft, split: next });

  function switchMode(mode: SplitMode) {
    // Switching keeps everyone's current amounts rather than resetting them,
    // so you can start equal and nudge one person without losing the rest.
    setSpec(convertSplitMode(totalMinor, spec, mode, seed));
  }

  function toggle(memberId: string) {
    const next = new Set(included);
    if (next.has(memberId)) next.delete(memberId); else next.add(memberId);
    const ids = [...next];
    switch (spec.mode) {
      case "equal": return setSpec({ mode: "equal", members: ids });
      case "shares": {
        const weights = { ...spec.weights };
        if (next.has(memberId)) weights[memberId] = 1; else delete weights[memberId];
        return setSpec({ mode: "shares", weights });
      }
      case "exact": {
        const amounts = { ...spec.amounts };
        if (next.has(memberId)) amounts[memberId] = 0; else delete amounts[memberId];
        return setSpec({ mode: "exact", amounts });
      }
      case "percent": {
        const bps = { ...spec.bps };
        if (next.has(memberId)) bps[memberId] = 0; else delete bps[memberId];
        return setSpec({ mode: "percent", bps });
      }
    }
  }

  function setWeight(memberId: string, delta: number) {
    if (spec.mode !== "shares") return;
    const weights = { ...spec.weights };
    const next = Math.max(0, (weights[memberId] ?? 0) + delta);
    if (next === 0) delete weights[memberId]; else weights[memberId] = next;
    setSpec({ mode: "shares", weights });
  }

  function setExact(memberId: string, text: string) {
    if (spec.mode !== "exact") return;
    let minor = 0;
    try { minor = text ? parseMinor(text, base) : 0; } catch { return; }
    setSpec({ mode: "exact", amounts: { ...spec.amounts, [memberId]: minor } });
  }

  function setPercent(memberId: string, text: string) {
    if (spec.mode !== "percent") return;
    const pct = Number(text.replace(",", "."));
    if (!Number.isFinite(pct) || pct < 0) return;
    setSpec({ mode: "percent", bps: { ...spec.bps, [memberId]: Math.round(pct * 100) } });
  }

  return (
    <Screen>
      <Body>
        <TopBar title="How to split" sub={money(totalMinor, base)} back={true}
          right={<button className="action" onClick={() => router.back()} disabled={!check.ok}>Done</button>} />

        <div className="pad" style={{ paddingBottom: 10 }}>
          <div className="seg">
            {MODES.map((m) => (
              <button key={m.mode} className={spec.mode === m.mode ? "on" : ""}
                onClick={() => switchMode(m.mode)}>{m.label}</button>
            ))}
          </div>
        </div>

        <Scroll>
          <div className="rows">
            {data.members.map((m) => {
              const on = included.has(m.id);
              return (
                <div key={m.id} className={`row${m.id === data.me ? " mine" : ""}`}>
                  <button onClick={() => toggle(m.id)} aria-label={on ? `Remove ${m.name}` : `Include ${m.name}`}
                    style={{ display: "flex", gap: 12, alignItems: "center", flex: 1, minWidth: 0,
                      opacity: on ? 1 : .45 }}>
                    <Avatar member={m} />
                    <span className="rmain">
                      <span className="rtitle" style={{ display: "block" }}>
                        {m.id === data.me ? "You" : m.name}
                      </span>
                      <span className="rmeta" style={{ display: "block" }}>
                        {on ? money(shares[m.id] ?? 0, base) : "not involved"}
                      </span>
                    </span>
                  </button>

                  {spec.mode === "shares" ? (
                    <span style={{ display: "flex", alignItems: "center", gap: 11 }}>
                      <button onClick={() => setWeight(m.id, -1)} aria-label="Fewer shares"
                        style={{ fontSize: 17, color: on ? "var(--ink)" : "var(--muted)" }}>−</button>
                      <span className="bignum" style={{ fontSize: 15, width: 14, textAlign: "center",
                        color: on ? "var(--ink)" : "var(--muted)" }}>
                        {spec.weights[m.id] ?? 0}
                      </span>
                      <button onClick={() => setWeight(m.id, 1)} aria-label="More shares"
                        style={{ fontSize: 17 }}>+</button>
                    </span>
                  ) : spec.mode === "exact" ? (
                    <input className="bignum" inputMode="decimal" aria-label={`${m.name}'s amount`}
                      value={on ? bare(spec.amounts[m.id] ?? 0, base) : ""}
                      disabled={!on}
                      onChange={(e) => setExact(m.id, e.target.value)}
                      style={{ width: 78, textAlign: "right", background: "transparent", border: 0,
                        borderBottom: "1px solid var(--rule)", font: "inherit", color: "var(--ink)",
                        outline: "none", fontSize: 14 }} />
                  ) : spec.mode === "percent" ? (
                    <span style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                      <input className="bignum" inputMode="decimal" aria-label={`${m.name}'s percentage`}
                        value={on ? String((spec.bps[m.id] ?? 0) / 100) : ""}
                        disabled={!on}
                        onChange={(e) => setPercent(m.id, e.target.value)}
                        style={{ width: 54, textAlign: "right", background: "transparent", border: 0,
                          borderBottom: "1px solid var(--rule)", font: "inherit", color: "var(--ink)",
                          outline: "none", fontSize: 14 }} />
                      <span style={{ fontSize: 13, color: "var(--muted)" }}>%</span>
                    </span>
                  ) : (
                    <span style={{ color: on ? "var(--credit)" : "var(--muted)" }}>
                      <Icon name={on ? "check" : "plus"} size={16} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="pad">
            <Card style={{
              background: check.ok ? "var(--credit-bg)" : "var(--debit-bg)", borderColor: "transparent",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <Icon name={check.ok ? "check" : "off"} size={16}
                style={{ color: check.ok ? "var(--credit)" : "var(--debit)", flex: "none" }} />
              <span style={{ fontSize: 12.5, fontWeight: 600,
                color: check.ok ? "var(--credit)" : "var(--debit)" }}>
                {check.ok
                  ? `${money(check.allocatedMinor, base)} of ${money(check.totalMinor, base)} allocated`
                  : check.message ?? `${money(check.allocatedMinor, base)} of ${money(check.totalMinor, base)}`}
              </span>
            </Card>
            <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "9px 0 0", lineHeight: 1.45 }}>
              Switching mode keeps everyone's current amounts, so you can start equal
              and nudge one person without losing the rest.
            </p>
          </div>
          <div style={{ height: 24 }} />
        </Scroll>
      </Body>
    </Screen>
  );
}
