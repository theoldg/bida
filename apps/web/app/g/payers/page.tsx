"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { goBack } from "@/lib/nav";
import { useEffect, useRef, useState } from "react";
import { primaryPayer, validatePayers } from "@bida/core";
import { MinorAmountInput } from "@/components/amount-input";
import { BadLink, Blank, Body, QueryBoundary, Screen, Scroll, TopBar } from "@/components/chrome";
import { ConfirmDialog } from "@/components/dialog";
import { Icon, TapMark } from "@/components/icons";
import { SoloName } from "@/components/bits";
import { copy } from "@/lib/copy";
import { bare, money, payerProblemText } from "@/lib/format";
import { route } from "@/lib/group-link";
import { useClaimGate, useGroupData } from "@/lib/hooks";
import { draftAmountMinor, saveDraft, useDraft } from "@/lib/draft";
import { tapAmount, tapLabel } from "@/lib/tap-amount";

/**
 * Who put the money in. The mirror of the split editor's "as amounts" tab,
 * with no other modes — nobody pays "30% of the bill". Amounts are in the
 * expense's own currency (ADR-0010).
 *
 * Every field is open from the start; a zero or blank drops that person. With
 * nobody typed in, the draft collapses to a single payer (`payers: null`), so
 * clearing the fields is "back to one payer" without a button. A tap on a name
 * clears that figure or hands it the rest (`tapAmount`), as in "as amounts".
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

  // No draft (a reload, a bookmark, a forward press onto a saved entry): the
  // draft lives in memory (lib/draft.ts), so there is nothing to show. Without
  // this the screen is blank forever. The grid and app/quick/result do the same.
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
   * The figure *is* the statement: a positive amount puts someone in, clearing
   * it takes them out. Nobody left is the single-payer case this screen started
   * from, `paidBy` unchanged — never an all-zero map.
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

  /**
   * A tap on the name: clear it, fill it with the rest, or type (`tapAmount`).
   * Clearing the last payer leaves **nobody**, not the collapse typing gets:
   * collapsing would hand `paidBy` the whole amount straight back, and the tap
   * would look like it did nothing. Done stays shut until someone is tapped in.
   */
  function tapRow(memberId: string, fieldId: string) {
    const tap = tapAmount(spec, memberId, amountMinor);
    if (tap === "edit") { document.getElementById(fieldId)?.focus(); return; }
    const others = Object.keys(spec).some((id) => id !== memberId && (spec[id] ?? 0) > 0);
    if (tap.set === 0 && !others) { saveDraft(gid, { ...current, payers: {} }); return; }
    setAmount(memberId, tap.set);
  }

  return (
    <Screen>
      <Body>
        <TopBar title={copy.payers.title[voice]}
          sub={money(amountMinor, currency)} back={{ ask: mayLeave }} />

        <Scroll>
          <div className="rows">
            {data.members.map((m, i) => {
              const on = (spec[m.id] ?? 0) > 0;
              const fieldId = `payer-${m.id}`;
              const tap = tapAmount(spec, m.id, amountMinor);
              // A column of figures is what a confirm key is for: it walks to
              // the next person rather than closing the keyboard between each
              // one. The last row has nowhere to go, and says so.
              const last = i === data.members.length - 1;
              return (
                <div key={m.id} className={`row${m.id === data.me ? " mine" : ""}`}>
                  <button type="button" onClick={() => tapRow(m.id, fieldId)}
                    aria-label={tapLabel(tap, m.name, {
                      clear: copy.payers.clear, giveRest: copy.payers.giveRest,
                      edit: copy.payers.edit,
                    })}
                    style={{ display: "flex", gap: 12, alignItems: "center", flex: 1, minWidth: 0,
                      opacity: on ? 1 : .45 }}>
                    {/* No line under the name: the field beside it already is
                        the figure, and an empty one already says "didn't pay" —
                        same as the split editor's "as amounts". */}
                    <SoloName name={m.name} />
                  </button>

                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <TapMark tap={tap} />
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

          {/* The verdict and the way out travel together, sticky as on "Which
              one are you?": on a long list they wait at the foot with names
              passing under, on a short one they sit right below the rows. */}
          <div className="pad whodock" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
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
            <button type="button" className="btn btn-p btn-lg" disabled={!check.ok}
              style={{ marginTop: 10 }}
              onClick={() => goBack(() => router.back(), (to) => router.replace(to))}>
              {copy.act.done}
            </button>
          </div>
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
