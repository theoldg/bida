"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { parseMinor, validatePayers } from "@hajsik/core";
import { Avatar, Card } from "../../../components/bits";
import { Body, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { Icon } from "../../../components/icons";
import { bare, money } from "../../../lib/format";
import { useGroupData } from "../../../lib/hooks";
import { saveDraft, useDraft } from "../../../lib/draft";

/**
 * Who put the money in. The mirror of the split editor, and deliberately
 * simpler than it: there are no modes here, because nobody pays "30% of the
 * bill" — they hand over a number the receipt knows. Amounts are in the
 * expense's own currency for the same reason (ADR-0010).
 */
export default function PayersPage() {
  return <QueryBoundary><PayersScreen /></QueryBoundary>;
}

function PayersScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const draft = useDraft(groupId);

  if (!groupId || !data.group || !draft) {
    return <Screen><Body><TopBar title="Who paid" back={true} /></Body></Screen>;
  }
  const currency = draft.currency;

  let amountMinor = 0;
  try { amountMinor = draft.amountText ? parseMinor(draft.amountText, currency) : 0; } catch { /* mid-type */ }

  // A draft with no `payers` yet means the ordinary one-payer expense; show it
  // as that person holding the whole amount rather than as an empty table.
  const spec: Record<string, number> = draft.payers ?? { [draft.paidBy]: amountMinor };
  const contributors = Object.keys(spec).filter((id) => (spec[id] ?? 0) > 0);
  const check = validatePayers(amountMinor, spec);

  const setSpec = (next: Record<string, number>) => saveDraft(groupId, {
    ...draft,
    payers: next,
    // Keep paidBy pointing at somebody who is actually in the map, so the row
    // in the list and the avatar never name a non-payer.
    paidBy: Object.keys(next).find((id) => (next[id] ?? 0) > 0) ?? draft.paidBy,
  });

  function toggle(memberId: string) {
    const next = { ...spec };
    if ((next[memberId] ?? 0) > 0 || memberId in next) delete next[memberId];
    else next[memberId] = 0;
    setSpec(next);
  }

  function setAmount(memberId: string, text: string) {
    let minor = 0;
    try { minor = text ? parseMinor(text, currency) : 0; } catch { return; }
    setSpec({ ...spec, [memberId]: minor });
  }

  /** Hand the unallocated remainder to one person — the usual last step. */
  function giveRest(memberId: string) {
    const others = Object.entries(spec)
      .filter(([id]) => id !== memberId)
      .reduce((a, [, v]) => a + (v ?? 0), 0);
    setSpec({ ...spec, [memberId]: Math.max(0, amountMinor - others) });
  }

  /** Back to a single payer: the whole amount to whoever is largest now. */
  function onePayer() {
    saveDraft(groupId!, { ...draft!, payers: null });
    router.back();
  }

  const allocated = check.allocatedMinor;

  return (
    <Screen>
      <Body>
        <TopBar title="Who paid" sub={money(amountMinor, currency)} back={true}
          right={<button className="action" onClick={() => router.back()} disabled={!check.ok}>Done</button>} />

        <Scroll>
          <div className="rows">
            {data.members.map((m) => {
              const on = m.id in spec;
              return (
                <div key={m.id} className={`row${m.id === data.me ? " mine" : ""}`}>
                  <button onClick={() => toggle(m.id)}
                    aria-label={on ? `${m.name} didn't pay` : `${m.name} paid too`}
                    style={{ display: "flex", gap: 12, alignItems: "center", flex: 1, minWidth: 0,
                      opacity: on ? 1 : .45 }}>
                    <Avatar member={m} />
                    <span className="rmain">
                      <span className="rtitle" style={{ display: "block" }}>
                        {m.id === data.me ? "You" : m.name}
                      </span>
                      <span className="rmeta" style={{ display: "block" }}>
                        {on ? "put money in" : "didn't pay"}
                      </span>
                    </span>
                  </button>

                  {on ? (
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button onClick={() => giveRest(m.id)} className="chip"
                        aria-label={`Give ${m.name} the rest`}>rest</button>
                      <input className="bignum" inputMode="decimal" aria-label={`${m.name}'s contribution`}
                        value={bare(spec[m.id] ?? 0, currency)}
                        onChange={(e) => setAmount(m.id, e.target.value)}
                        style={{ width: 84, textAlign: "right", background: "transparent", border: 0,
                          borderBottom: "1px solid var(--rule)", font: "inherit", color: "var(--ink)",
                          outline: "none", fontSize: 14 }} />
                    </span>
                  ) : (
                    <span style={{ color: "var(--muted)" }}><Icon name="plus" size={16} /></span>
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
                  ? `${money(allocated, currency)} of ${money(amountMinor, currency)} accounted for`
                  : check.message}
              </span>
            </Card>

            {contributors.length > 1 ? (
              <button className="btn btn-s" style={{ marginTop: 10 }} onClick={onePayer}>
                Back to one payer
              </button>
            ) : null}

            <p className="hint">
              Amounts are in {currency}, the currency of the expense — what people actually
              handed over. Who the money was spent <i>on</i> is the split, and is set separately.
            </p>
          </div>
          <div style={{ height: 24 }} />
        </Scroll>
      </Body>
    </Screen>
  );
}
