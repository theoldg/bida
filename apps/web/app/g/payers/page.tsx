"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { goBack } from "@/lib/nav";
import { useEffect, useRef, useState } from "react";
import { primaryPayer, validatePayers } from "@bida/core";
import { MinorAmountInput } from "@/components/amount-input";
import { keepsFocus } from "@/components/bits";
import { BadLink, Blank, Body, QueryBoundary, Screen, Scroll, TopBar } from "@/components/chrome";
import { ConfirmDialog } from "@/components/dialog";
import { Icon } from "@/components/icons";
import { copy } from "@/lib/copy";
import { bare, money, payerProblemText } from "@/lib/format";
import { route } from "@/lib/group-link";
import { useClaimGate, useGroupData } from "@/lib/hooks";
import { draftAmountMinor, saveDraft, useDraft } from "@/lib/draft";

/**
 * Who put the money in. The mirror of the split editor's "as amounts" tab,
 * and deliberately simpler than the editor as a whole: there are no other
 * modes here, because nobody pays "30% of the bill" — they hand over a number
 * the receipt knows. Amounts are in the expense's own currency for the same
 * reason (ADR-0010).
 *
 * Every row's field is open from the start and a typed zero or blank drops
 * that person, rather than a tap toggling them out — the field *is* the
 * statement, as in `SplitEditor`'s exact mode. Nobody typed in at all collapses
 * the draft to a plain single payer (`payers: null`) rather than sitting on a
 * degenerate all-zero map, so clearing the fields is "back to one payer" and
 * no button has to be.
 */
export default function PayersPage() {
  return <QueryBoundary><PayersScreen /></QueryBoundary>;
}

function PayersScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const unclaimed = useClaimGate(groupId, data);
  const draft = useDraft(groupId);
  const [asking, setAsking] = useState(false);
  // What the payer side looked like when this screen opened, so leaving can
  // put it back. Only the payer side: the rest of the draft isn't this
  // screen's to throw away.
  const opened = useRef<{ payers: Record<string, number> | null; paidBy: string } | null>(null);
  if (draft && !opened.current) opened.current = { payers: draft.payers, paidBy: draft.paidBy };

  // No draft at all: a reload, a bookmark, or a forward press onto an entry
  // that has since been saved. The draft this screen edits one side of lives in
  // memory (lib/draft.ts), so there is nothing to put back and nothing for the
  // arrow to return to — without this the screen is a titled blank forever. The
  // grid one route over does the same, and so does app/quick/result.
  useEffect(() => {
    if (groupId && !data.loading && data.group && !unclaimed && !draft) {
      router.replace(route.group(groupId));
    }
  }, [groupId, data.loading, data.group, unclaimed, draft, router]);

  if (!groupId) return <BadLink />;
  if (!data.loading && !data.group) return <BadLink />;
  if (unclaimed || !data.group || !draft) {
    return <Blank title={copy.payers.title.expense} back={route.group(groupId)} />;
  }
  const gid = groupId, current = draft;
  // Which way the entry runs is which way this screen speaks: money going out
  // is paid, money coming in is received. A transfer never reaches this screen.
  const voice = draft.kind === "income" ? "income" : "expense";
  const currency = draft.currency;

  // What the form says this entry is worth, from the same function the form
  // asks: a scanned bill is worth what its lines add up to, so reading
  // `amountText` alone calls that expense €0.00.
  const amountMinor = draftAmountMinor(draft);

  // A draft with no `payers` yet means the ordinary one-payer expense; show it
  // as that person holding the whole amount rather than as an empty table.
  const spec: Record<string, number> = draft.payers ?? { [draft.paidBy]: amountMinor };
  const check = validatePayers(amountMinor, spec);

  /**
   * The figure *is* the statement, same as the split editor's "as amounts"
   * tab: typing a positive amount puts someone in, clearing it to nothing
   * takes them out. Nobody left with anything typed in is not a payers list
   * of zero people, it's the single-payer case this screen started from —
   * so that's where it goes back to, `paidBy` unchanged, rather than stranding
   * the form on a map every entry with money has to have at least one of.
   */
  function setAmount(memberId: string, minor: number) {
    const next = { ...spec };
    if (minor > 0) next[memberId] = minor; else delete next[memberId];
    if (Object.values(next).every((v) => (v ?? 0) === 0)) {
      saveDraft(gid, { ...current, payers: null });
      return;
    }
    // Same rule the fold keeps `paidBy` by (core/payers.ts): the largest
    // contributor is who the entry names outside this screen — the picker,
    // the row's avatar, history's summary line.
    saveDraft(gid, { ...current, payers: next, paidBy: primaryPayer(next, current.paidBy) });
  }

  /** Leaving throws this screen's edits away, so ask first — as the form does. */
  function mayLeave() {
    const was = opened.current;
    const changed = was !== null && (JSON.stringify(was.payers) !== JSON.stringify(current.payers)
      || was.paidBy !== current.paidBy);
    if (changed) { setAsking(true); return false; }
    return true;
  }

  function discard() {
    const was = opened.current;
    if (was) saveDraft(gid, { ...current, payers: was.payers, paidBy: was.paidBy });
    goBack(() => router.back(), (to) => router.replace(to));
  }

  /** Hand the unallocated remainder to one person — the usual last step. */
  function giveRest(memberId: string) {
    const others = Object.entries(spec)
      .filter(([id]) => id !== memberId)
      .reduce((a, [, v]) => a + (v ?? 0), 0);
    setAmount(memberId, Math.max(0, amountMinor - others));
  }

  return (
    <Screen>
      <Body>
        <TopBar title={copy.payers.title[voice]}
          sub={money(amountMinor, currency)} back={{ ask: mayLeave }}
          right={<button className="action" disabled={!check.ok} {...keepsFocus}
            onClick={() => goBack(() => router.back(), (to) => router.replace(to))}>
            {copy.act.done}
          </button>} />

        <Scroll>
          <div className="rows">
            {data.members.map((m, i) => {
              const on = (spec[m.id] ?? 0) > 0;
              const fieldId = `payer-${m.id}`;
              // A column of figures is what a confirm key is for: it walks to
              // the next person rather than closing the keyboard between each
              // one. The last row has nowhere to go, and says so.
              const last = i === data.members.length - 1;
              return (
                <div key={m.id} className={`row${m.id === data.me ? " mine" : ""}`}>
                  <label htmlFor={fieldId}
                    style={{ display: "flex", gap: 12, alignItems: "center", flex: 1, minWidth: 0,
                      opacity: on ? 1 : .45 }}>
                    <span className="rmain">
                      <span className="rtitle" style={{ display: "block" }}>
                        {m.name}
                      </span>
                      <span className="rmeta" style={{ display: "block" }}>
                        {/* The field beside this line already is the figure —
                            a stray "€0.00" under it would say the same thing
                            twice, same as the split editor's exact mode. */}
                        {on ? "" : copy.payers.didnt[voice]}
                      </span>
                    </span>
                  </label>

                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* Offered on a row with nothing in it too: somebody who
                        hasn't typed an amount yet is exactly who you hand the
                        shortfall to. */}
                    {!check.ok ? (
                      <button onClick={() => giveRest(m.id)} className="chip" {...keepsFocus}
                        aria-label={copy.payers.giveRest(m.name)}>{copy.payers.rest}</button>
                    ) : null}
                    <MinorAmountInput id={fieldId} className="bignum splitin"
                      enterKeyHint={last ? "done" : "next"}
                      aria-label={copy.payers.contribution[voice](m.name)}
                      currency={currency}
                      valueMinor={spec[m.id] ?? 0}
                      placeholder={bare(0, currency)}
                      onChangeMinor={(minor) => setAmount(m.id, minor)} />
                  </span>
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
                  : payerProblemText(check, currency, voice)}
              </span>
            </div>
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
