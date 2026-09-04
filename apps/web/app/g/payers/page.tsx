"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { validatePayers } from "@hajsik/core";
import { MinorAmountInput } from "../../../components/amount-input";
import { BadLink, Blank, Body, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { ConfirmDialog } from "../../../components/dialog";
import { Icon } from "../../../components/icons";
import { copy } from "../../../lib/copy";
import { bare, money, payerProblemText } from "../../../lib/format";
import { useGroupData } from "../../../lib/hooks";
import { draftAmountMinor, saveDraft, useDraft } from "../../../lib/draft";

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
  const [asking, setAsking] = useState(false);
  // What the payer side looked like when this screen opened, so leaving can
  // put it back. Only the payer side: the rest of the draft isn't this
  // screen's to throw away.
  const opened = useRef<{ payers: Record<string, number> | null; paidBy: string } | null>(null);
  if (draft && !opened.current) opened.current = { payers: draft.payers, paidBy: draft.paidBy };

  if (!groupId) return <BadLink />;
  if (!data.loading && !data.group) return <BadLink />;
  if (!data.group || !draft) return <Blank title={copy.payers.whoPaid} />;
  const gid = groupId, current = draft;
  const currency = draft.currency;

  // What the form says this entry is worth, from the same function the form
  // asks — a scanned bill is worth what its lines add up to, and reading
  // `amountText` alone had this screen calling that expense €0.00.
  const amountMinor = draftAmountMinor(draft);

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
    const removing = memberId in next;
    // The last person can't be taken off. An expense nobody paid for isn't a
    // half-finished edit, it's a nonsense one — and an empty map stranded the
    // form, which reads it as the *single-payer* case and had nowhere to put
    // the reason Save was grey. Swapping payers still works: add the new one,
    // then remove the old. The row is `disabled` so the refusal is visible
    // rather than a tap that does nothing.
    if (removing && Object.keys(next).length <= 1) return;
    if (removing) delete next[memberId];
    else next[memberId] = 0;
    setSpec(next);
  }

  /** Leaving throws this screen's edits away, so ask first — as the form does. */
  function goBack() {
    const was = opened.current;
    const changed = was !== null && (JSON.stringify(was.payers) !== JSON.stringify(current.payers)
      || was.paidBy !== current.paidBy);
    if (changed) { setAsking(true); return; }
    router.back();
  }

  function discard() {
    const was = opened.current;
    if (was) saveDraft(gid, { ...current, payers: was.payers, paidBy: was.paidBy });
    router.back();
  }

  function setAmount(memberId: string, minor: number) {
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
    saveDraft(gid, { ...current, payers: null });
    router.back();
  }

  return (
    <Screen>
      <Body>
        <TopBar title={draft.kind === "income" ? copy.payers.whoReceived : copy.payers.whoPaid}
          sub={money(amountMinor, currency)} back={goBack}
          right={<button className="action" onClick={() => router.back()} disabled={!check.ok}>
            {copy.act.done}
          </button>} />

        <Scroll>
          <div className="rows">
            {data.members.map((m) => {
              const on = m.id in spec;
              const last = on && Object.keys(spec).length <= 1;
              return (
                <div key={m.id} className={`row${m.id === data.me ? " mine" : ""}`}>
                  <button onClick={() => toggle(m.id)} disabled={last}
                    aria-label={last ? copy.payers.onlyPayer(m.name)
                      : on ? copy.payers.leaveOut(m.name) : copy.payers.alsoPaid(m.name)}
                    style={{ display: "flex", gap: 12, alignItems: "center", flex: 1, minWidth: 0,
                      opacity: on ? 1 : .45 }}>
                    <span className="rmain">
                      <span className="rtitle" style={{ display: "block" }}>
                        {m.name}
                      </span>
                      <span className="rmeta" style={{ display: "block" }}>
                        {on ? copy.payers.putIn : copy.payers.didnt}
                      </span>
                    </span>
                  </button>

                  {on ? (
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button onClick={() => giveRest(m.id)} className="chip"
                        aria-label={copy.payers.giveRest(m.name)}>{copy.payers.rest}</button>
                      <MinorAmountInput className="bignum splitin" aria-label={copy.payers.contribution(m.name)}
                        currency={currency}
                        valueMinor={spec[m.id] ?? 0}
                        placeholder={bare(0, currency)}
                        onChangeMinor={(minor) => setAmount(m.id, minor)} />
                    </span>
                  ) : (
                    <span style={{ color: "var(--muted)" }}><Icon name="plus" size={16} /></span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="pad">
            {/* Tick when it adds up, words alone when it doesn't — same as the
                split footer, and for the same reason. */}
            <div className={`splitfoot alone ${check.ok ? "ok" : "bad"}`}>
              {check.ok ? <Icon name="check" size={14} style={{ flex: "none" }} /> : null}
              <span>
                {check.ok
                  ? copy.payers.accountedFor(
                      money(check.allocatedMinor, currency), money(amountMinor, currency))
                  : payerProblemText(check, currency)}
              </span>
            </div>

            {contributors.length > 1 ? (
              <button className="btn btn-s" style={{ marginTop: 10 }} onClick={onePayer}>
                {copy.payers.onePayer}
              </button>
            ) : null}
          </div>
          <div style={{ height: 24 }} />
        </Scroll>
      </Body>

      {asking ? (
        <ConfirmDialog title={copy.payers.discardTitle} confirm={copy.act.discard}
          danger={true} onConfirm={discard} onClose={() => setAsking(false)}>
          <p>{copy.payers.discardBody}</p>
        </ConfirmDialog>
      ) : null}
    </Screen>
  );
}
