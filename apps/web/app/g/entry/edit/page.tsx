"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  latestRate, minorToDecimalString, receiptOf, settleRest,
  type ArithmeticSplit, type Group, type RateSource,
} from "@bida/core";
import { You } from "@/components/bits";
import { AmountInput, clipAmountToCurrency } from "@/components/amount-input";
import { useReceiptScan } from "@/components/receipt-scan";
import { useScanAs } from "@/lib/scan/credential";
import { SplitEditor } from "@/components/split-editor";
import { BadLink, Blank, Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "@/components/chrome";
import { ChoiceDialog, ConfirmDialog } from "@/components/dialog";
import { CurrencyPicker } from "@/components/currency-picker";
import { RateChip, RateDialog } from "@/components/rate-dialog";
import { Icon } from "@/components/icons";
import { TransferSides } from "@/components/transfer-sides";
import {
  addExpense, editExpense, editSettlement, recordSettlement,
} from "@/lib/db/commands";
import { ENTRY_KINDS, type EntryKind } from "@/lib/entry-kind";
import { copy } from "@/lib/copy";
import { checkEntry, dockLine } from "@/lib/entry-check";
import { rateDayOf, useEntryRate } from "@/lib/entry-rate";
import { useRefusals } from "@/lib/refusal";
import { bare, dateInputValue, errorText, money, withDate } from "@/lib/format";
import { formParent, parseEntrySource, route, type EntrySource } from "@/lib/group-link";
import { useClaimGate, useGroupData, type GroupData } from "@/lib/hooks";
import { markSaved } from "@/lib/ledger-motion";
import { goUp, goBack, sameScreen } from "@/lib/nav";
import {
  arithmeticSplit, blankDraft, changeSplitTab, clearDraft, draftSeedKey, expenseDraft, getDraft, isDraftDirty, newEntryKey,
  retimed, saveDraft, seedDraft, splitSeed, transferDraft, useDraft, withSplit,
  type EntryDraft, type SplitTab,
} from "@/lib/draft";
import { usePrefetch } from "@/lib/prefetch";

/**
 * One form for all three kinds of entry (ADR-0010): switching kind keeps the
 * amount, currency, date and description; only the middle swaps.
 */
export default function EditEntryPage() {
  return <QueryBoundary><EditEntryScreen /></QueryBoundary>;
}

function EditEntryScreen() {
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const entryId = params.get("e") ?? undefined;
  const wantedKind = params.get("kind") as EntryKind | null;
  // Only a name is seeded from a link: a figure arriving by link is a figure
  // nobody typed.
  const prefillTitle = params.get("title") ?? undefined;

  const data = useGroupData(groupId);
  const unclaimed = useClaimGate(groupId, data);
  const draft = useDraft(groupId);

  // Returning from the payers editor or the grid re-mounts with the same key, so
  // the draft survives; a different link replaces a leftover draft.
  const seedKey = entryId ?? newEntryKey(wantedKind, { title: prefillTitle });

  useEffect(() => {
    if (!groupId || data.loading || !data.group) return;
    if (draftSeedKey(groupId) === seedKey) return;
    const me = data.me ?? data.members[0]?.id;
    if (!me) return;
    const members = data.members.map((m) => m.id);

    if (entryId) {
      const e = data.expenses.find((x) => x.id === entryId);
      const s = e ? undefined : data.settlements.find((x) => x.id === entryId);
      const seeded = e ? expenseDraft(e, me, members) : s ? transferDraft(s, me, members) : undefined;
      if (seeded) seedDraft(groupId, seeded, seedKey);
      return;
    }
    const kind: EntryKind = wantedKind && ENTRY_KINDS.includes(wantedKind) ? wantedKind : "expense";
    seedDraft(groupId, {
      ...blankDraft(kind, me, data.group.baseCurrency, members),
      ...(prefillTitle ? { description: prefillTitle } : {}),
    }, seedKey);
  }, [groupId, entryId, seedKey, wantedKind, prefillTitle, data.loading, data.group, data.members, data.me, data.expenses, data.settlements]);

  const leaving = useRef(false);

  // Nothing is stored, so let the browser warn as for any half-filled form —
  // but not once Discard has answered: going back may leave the page.
  useEffect(() => {
    if (!groupId) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (!leaving.current && isDraftDirty(groupId)) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [groupId]);

  /**
   * **The draft goes when the screen does, not before**: a swallowed traversal is
   * repaired a breath later, and a cleared draft in that gap reads as a fresh
   * blank entry (docs/navigation.md#keeping-the-devices-back-honest). Guarded,
   * because the payers editor and the grid unmount this screen too.
   */
  useEffect(() => () => { if (leaving.current && groupId) clearDraft(groupId); }, [groupId]);

  const title = entryId ? copy.form.editTitle : copy.form.newTitle;
  // Reachable: a group pulled before its members arrive, or a phone that hasn't
  // claimed anybody.
  if (groupId && !data.loading && data.group && data.members.length === 0) {
    return (
      <Screen><Body>
        <TopBar title={title} back={route.group(groupId)} />
        <Empty title={copy.form.nobodyTitle}>
          <p>{copy.form.nobodyBody}</p>
          <Link className="btn btn-p" style={{ marginTop: 14 }} href={route.members(groupId)}>
            {copy.members.title}
          </Link>
        </Empty>
      </Body></Screen>
    );
  }
  if (groupId && entryId && !data.loading && data.group
    && !data.expenses.some((e) => e.id === entryId)
    && !data.settlements.some((s) => s.id === entryId)) {
    return (
      <Screen><Body>
        <TopBar title={copy.entry.gone.title} back={route.group(groupId)} />
        <Empty title={copy.entry.gone.body} />
      </Body></Screen>
    );
  }
  if (!groupId) return <BadLink />;
  if (!data.loading && !data.group) return <BadLink />;
  if (unclaimed || !data.group || !draft) return <Blank title={title} />;
  return (
    <EntryForm groupId={groupId} group={data.group} data={data} draft={draft}
      via={parseEntrySource(params.get("via"))} leaving={leaving} />
  );
}

function EntryForm({ groupId, group, data, draft, via, leaving }: {
  groupId: string;
  group: Group;
  data: GroupData;
  draft: EntryDraft;
  /** Saving goes back there (lib/group-link.ts). */
  via: EntrySource | undefined;
  leaving: RefObject<boolean>;
}) {
  const router = useRouter();
  usePrefetch([route.payers(groupId), route.bill(groupId, via)]);
  const scan = useReceiptScan(groupId, useScanAs(groupId), undefined, route.bill(groupId, via));
  const saveTo = formParent(groupId, draft.entryId, via);
  const base = group.baseCurrency;
  const kind = draft.kind;
  const transfer = kind === "transfer";

  const [ask, setAsk] = useState<null | "discard" | "currency" | "payer" | "kind">(null);
  const { looking: rateLooking, ask: askRate, setAsk: setAskRate } = useEntryRate(groupId, draft, base,
    (currency) => latestRate([...data.expenses, ...data.settlements], data.rates, base, currency, draft.entryId));
  const [failed, setFailed] = useState<string>();
  /**
   * **Every button that writes needs one**: two taps on Save land before
   * `router.replace` does — a transfer written twice. Cleared only on failure.
   */
  const [saving, setSaving] = useState(false);
  // One function, so the arithmetic behind Save has a test suite
  // (lib/entry-check.ts).
  const {
    activeTab, canScan, receiptSplit, effectiveSplit, receiptTotal, receiptLocksAmount,
    amountMinor, baseMinor, foreign, rate, rateOk, blocker, payersOff, splitProblem,
    receiptMissing, ready,
    amountMissing, titleMissing,
  } = checkEntry({
    draft, base,
    liveMembers: data.members.map((m) => m.id),
    nameOf: data.nameOf,
  });

  const missing = {
    amount: amountMissing, title: titleMissing, receipt: receiptMissing,
    // `rateOk`, not just a rate held: one that overflows the amount is no rate
    // either.
    rate: !rateOk, blocker: blocker !== null, split: splitProblem !== null, payers: payersOff,
  };
  /** Off again once nothing is missing, so the words don't come back unasked. */
  const [told, setTold] = useState(false);
  const fieldMissing = missing.rate || missing.receipt || missing.amount || missing.title;
  useEffect(() => {
    if (told && !fieldMissing) setTold(false);
  }, [told, fieldMissing]);
  const said = dockLine(missing, told);
  const saidText = said === "rate"
    ? (rateLooking ? copy.form.rateLooking(draft.currency) : copy.form.noRate(draft.currency))
    : said === "blocker" ? blocker
    : said === "split" ? splitProblem
    : said === "receipt" ? ((draft.receiptItems?.length ?? 0) > 0 ? copy.form.noItemsGiven : copy.form.noScan)
    : said === "amount" ? copy.form.noAmount
    : said === "title" ? copy.form.noTitle
    : null;
  const docked = said !== null;
  const refusals = useRefusals(missing, (aimed) => !!aimed.rate || !!aimed.amount || !!aimed.title || !!aimed.payers);

  // Merges against the latest saved draft: some handlers patch twice, and a stale
  // closure would let the second clobber the first.
  const patch = (change: Partial<EntryDraft>) =>
    saveDraft(groupId, clipAmountToCurrency({ ...(getDraft(groupId) ?? draft), ...change }));

  /**
   * Until the new currency's rate arrives Save is held, rather than banking 500
   * MAD as €500.
   */
  function pickCurrency(currency: string) {
    patch({ currency });
  }

  function changeTab(splitTab: SplitTab) {
    patch(changeSplitTab(getDraft(groupId) ?? draft, splitTab));
  }

  function changeSplit(split: ArithmeticSplit) {
    patch({ splits: withSplit((getDraft(groupId) ?? draft).splits, split) });
  }

  /** Only an expense has Items: any other kind leaves it for Evenly. */
  function changeKind(next: EntryKind) {
    if (next === kind) return;
    patch({
      kind: next,
      ...(activeTab === "receipt" && next !== "expense" ? changeSplitTab(draft, "equal") : {}),
    });
  }

  // Largest first, ties by id so the order doesn't shuffle as amounts are
  // retyped.
  const coPayers = Object.entries(draft.payers ?? {})
    .filter(([, v]) => v > 0)
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));

  function mayLeave() {
    if (leaving.current) return true;
    if (isDraftDirty(groupId)) { setAsk("discard"); return false; }
    clearDraft(groupId);
    return true;
  }

  function discard() {
    // Once: each press would schedule its own traversal and repair.
    if (leaving.current) return;
    leaving.current = true;
    goBack(() => router.back(), (to) => router.replace(to));
  }

  async function save() {
    // `useClaimGate` already sent a phone with no claim away; this shows the
    // compiler.
    const actor = data.me;
    if (!ready) {
      // A flash on the sentence not drawn would never end, and Save would stay
      // spent.
      const line = dockLine(missing, true);
      refusals.refuse({ ...missing, blocker: line === "blocker", split: line === "split" });
      setTold(true);
      return;
    }
    if (saving || !actor) return;
    setSaving(true);
    setFailed(undefined);
    const rateToBase = foreign ? rate ?? "1" : "1";
    const rateSource = foreign ? draft.rateSource ?? null : null;
    try {
      let wrote = draft.entryId;
      if (transfer) {
        const input = {
          fromMember: draft.fromMember,
          toMember: draft.toMember,
          amountMinor,
          currency: draft.currency,
          rateToBase,
          rateSource,
          occurredAt: draft.occurredAt,
          dateOnly: draft.dateOnly ? true : null,
          note: draft.description.trim() || null,
        };
        if (draft.entryId) await editSettlement(groupId, actor, draft.entryId, input);
        else wrote = await recordSettlement(groupId, actor, input);
      } else {
        const input = {
          kind,
          description: draft.description.trim(),
          occurredAt: draft.occurredAt,
          dateOnly: draft.dateOnly ? true : null,
          amountMinor,
          currency: draft.currency,
          rateToBase,
          rateSource,
          paidBy: draft.paidBy,
          payers: draft.payers,
          // So a phone that predates `rest` reads a split that adds up.
          split: settleRest(amountMinor, effectiveSplit, { tiebreakSeed: splitSeed(draft) }),
          categoryId: draft.categoryId,
          // An income has no bill, so turning an expense into one clears the
          // scan.
          ...receiptOf(canScan ? draft : {}),
        };
        if (draft.entryId) await editExpense(groupId, actor, draft.entryId, input);
        // The id the split was quoted with, so the cent shown is the cent kept.
        else wrote = await addExpense(groupId, actor, input, Date.now(), draft.newEntryId);
      }
      if (wrote && sameScreen(saveTo, route.group(groupId))) markSaved(groupId, wrote);
      leaving.current = true;
      // `goUp`, not a replace: the screen behind would be on the stack twice.
      goUp(saveTo, (to) => router.replace(to));
    } catch (err) {
      setSaving(false);
      setFailed(errorText(err));
    }
  }

  /**
   * A transfer is a different entity, and an edit never crosses to or from one
   * (ADR-0010).
   */
  const reachable: EntryKind[] = !draft.entryId ? [...ENTRY_KINDS]
    : transfer ? ["transfer"] : ["expense", "income"];

  return (
    <Screen>
      <Body>
        <TopBar
          title={draft.entryId
            ? (reachable.length > 1 ? copy.form.editTitle : copy.form.editKind(copy.entryKind.label[kind].toLowerCase()))
            : copy.form.newTitle}
          sub={group.name}
          back={{ ask: mayLeave }}
          right={reachable.length > 1 ? (
            <button type="button" className="chip kindchip" aria-label={copy.form.kindTitle}
              onClick={() => setAsk("kind")}>
              {copy.entryKind.label[kind]}<Icon name="updown" size={11} className="pickmark" />
            </button>
          ) : undefined}
        />

        <Scroll>
          {scan.inputs}

          {/* An expense's head is one card, the form as the summary left open. A
              transfer keeps its loose fields, so both wrappers dissolve
              (`display: contents`). */}
          <div className={transfer ? undefined : "pad"}
            style={transfer ? { display: "contents" } : { paddingTop: 2, paddingBottom: 0 }}>
          <div className={transfer ? undefined : "card formhead"}
            style={transfer ? { display: "contents" } : undefined}>
          <div className={`pad amtpad${receiptLocksAmount ? " noted" : ""}${foreign ? " foreign" : ""}`}>
            {/* `.amountfield` is `AmountInput`'s, so the refusal's `animationend`
                is caught here. */}
            <div className="amtgrid" data-refuse="amount" onAnimationEnd={refusals.onFlashEnd("amount")}>
              {/* The figure's cell gives up exactly the badge's height, so the
                  form never moves under a thumb. */}
              <div className="amtstack">
              <AmountInput
                className="amount"
                fieldClassName={`big${refusals.flash("amount")}`}
                aria-label={copy.form.amount(draft.currency)}
                enterKeyHint="next"
                placeholder={bare(0, draft.currency)}
                currency={draft.currency}
                value={receiptTotal !== null
                  ? minorToDecimalString(receiptTotal, draft.currency) : draft.amountText}
                onChange={(amountText) => patch({ amountText })}
                autoSize={true}
                disabled={receiptLocksAmount}
              />
              </div>
              <button type="button" className="chip" aria-label={copy.form.currency}
                onClick={() => setAsk("currency")}>
                {draft.currency}<Icon name="updown" size={11} className="pickmark" />
              </button>

              {foreign ? (
                <>
                  <button type="button" className="ratelink"
                    aria-label={copy.rates.openFor(draft.currency)}
                    onClick={() => setAskRate(draft.currency)}>
                    ={" "}
                    <span className={rateOk ? undefined : "bad"}>
                      {rateOk ? money(baseMinor, base) : copy.none}
                    </span>
                  </button>
                  <RateChip data-refuse="rate" className={refusals.flash("rate")}
                    onAnimationEnd={refusals.onFlashEnd("rate")}
                    rate={rate} looking={rateLooking}
                    aria-label={copy.rates.editTitle(draft.currency)}
                    onClick={() => setAskRate(draft.currency)} />
                </>
              ) : null}

              {/* Always rendered, folded shut, so it grows in as the figure's cell shrinks. */}
              <div className={receiptLocksAmount ? "amtnotes open" : "amtnotes"}
                aria-hidden={!receiptLocksAmount}>
                <div className="amtnote">{copy.form.fromReceipt}</div>
              </div>
            </div>
          </div>

          <div className="pad" style={transfer ? { paddingTop: 4, paddingBottom: docked ? 0 : undefined,
            display: "flex", flexDirection: "column", gap: 9 } : { padding: 0 }}>
            {transfer ? (
              <TransferSides
                members={data.members}
                me={data.me}
                from={draft.fromMember}
                to={draft.toMember}
                onChange={(sides) => patch(sides)}
              />
            ) : null}

            <div className={`field${refusals.flash("title")}`} data-refuse="title" onAnimationEnd={refusals.onFlashEnd("title")}>
              {transfer ? null : <label htmlFor="what">{copy.form.what}</label>}
              {/* The end of the field chain: a press here folds the keyboard. */}
              <input id="what" value={draft.description}
                enterKeyHint="done"
                aria-label={transfer ? copy.form.note : copy.form.what}
                placeholder={transfer ? copy.form.note : copy.form.whatPlaceholder}
                onChange={(e) => patch({ description: e.target.value })} />
            </div>

            {transfer ? null : coPayers.length > 1 ? (
              <Link href={route.payers(groupId)} data-refuse="payers"
                className={`field payersfield${refusals.flash("payers")}`} onAnimationEnd={refusals.onFlashEnd("payers")}>
                <span className="fieldlabel">{copy.entryKind.payer[kind]}</span>
                <span className="payerlines">
                  {coPayers.map(([id, amount]) => (
                    <span key={id} className="payerline">
                      <span>{data.memberById.get(id)?.name ?? copy.unknown}{id === data.me ? <You /> : null}</span>
                      <span className="bignum">{money(amount, draft.currency)}</span>
                    </span>
                  ))}
                </span>
                <Icon name="chev" size={18} className="pchev" />
              </Link>
            ) : (
              <div className="field">
                <span className="fieldlabel">{copy.entryKind.payer[kind]}</span>
                <button type="button" id="paidby" className="pick"
                  aria-label={copy.entryKind.payer[kind]} onClick={() => setAsk("payer")}>
                  <span className="ptext">{data.memberById.get(draft.paidBy)?.name ?? copy.none}
                    {draft.paidBy === data.me ? <You /> : null}</span>
                  <Icon name="updown" size={18} className="spacer pchev" />
                </button>
              </div>
            )}

            <div className="field">
              <label htmlFor="when">{copy.form.when}</label>
              <input id="when" type="date" value={dateInputValue(draft.occurredAt)}
                onChange={(e) => patch(retimed(draft, withDate(draft.occurredAt, e.target.value)))} />
            </div>
          </div>
          </div>
          </div>

          {transfer ? null : (
            <div className="pad" style={{ paddingTop: 9, paddingBottom: docked ? 0 : undefined }}>
              <SplitEditor
                members={data.members}
                me={data.me}
                title={copy.entryKind.split[kind]}
                amountMinor={amountMinor}
                amountCurrency={draft.currency}
                spec={arithmeticSplit(draft)}
                receiptSplit={receiptSplit}
                seed={splitSeed(draft)}
                onChange={changeSplit}
                tab={activeTab}
                onTabChange={changeTab}
                receipt={canScan ? {
                  items: draft.receiptItems ?? null,
                  scan,
                  flash: refusals.flash("receipt"),
                  onFlashEnd: refusals.onFlashEnd("receipt"),
                  editItemsHref: route.items(groupId, via),
                } : null}
              />
            </div>
          )}
        </Scroll>
        {/* The form's last row, docked (`.whodock`), with its own padding. Always
            pressable: `save` answers with the refusal flash. One wrong thing is
            said over Save, where scrolling can't hide it. */}
        <div className="pad whodock" style={{ paddingTop: docked ? 9 : 18 }}>
          {said ? (
            <div role="status" data-refuse={said} style={{ marginBottom: 9 }}
              className={`splitfoot bad alone${refusals.flash(said)}`}
              onAnimationEnd={refusals.onFlashEnd(said)}>
              <span>{saidText}</span>
            </div>
          ) : null}
          {failed ? (
            <p className="failure" role="alert" style={{ margin: "0 2px 9px" }}>
              {copy.form.saveFailed(failed)}
            </p>
          ) : null}
          <button type="button" className="btn btn-p btn-lg" onClick={save}
            disabled={saving || refusals.spent}>
            {saving ? <span className="spinner" /> : null}{copy.act.save}
          </button>
        </div>
      </Body>

      {ask === "discard" ? (
        <ConfirmDialog
          title={draft.entryId ? copy.form.discardTitleEdits : copy.form.discardTitle(copy.entryKind.label[kind].toLowerCase())}
          confirm={copy.act.discard}
          danger={true} onConfirm={discard} onClose={() => setAsk(null)}>
          <p>{copy.form.discardBody}</p>
        </ConfirmDialog>
      ) : null}

      {ask === "currency" ? (
        <CurrencyPicker value={draft.currency} first={[base, draft.currency]}
          used={data.currencies.map((c) => c.currency)}
          note={(c) => (c === base ? copy.currency.isBase : undefined)}
          onPick={pickCurrency} onClose={() => setAsk((a) => (a === "currency" ? null : a))} />
      ) : null}

      {ask === "payer" ? (
        <ChoiceDialog
          title={copy.entryKind.payer[kind]}
          value={draft.paidBy}
          options={data.members.map((m) => ({
            value: m.id,
            label: m.name,
            you: m.id === data.me,
          }))}
          onPick={(paidBy) => patch({ paidBy, payers: null })}
          onClose={() => setAsk(null)}
          lead={{
            label: copy.form.multiPayer,
            // With no amount the payers screen would split a zero.
            disabled: amountMissing,
            note: amountMissing ? copy.form.multiPayerNeedsAmount : undefined,
            onPick: () => router.push(route.payers(groupId)),
          }}
        />
      ) : null}

      {ask === "kind" ? (
        <ChoiceDialog
          title={copy.form.kindTitle}
          value={kind}
          options={reachable.map((k) => ({
            value: k, label: copy.entryKind.label[k], note: copy.entryKind.blurb[k],
          }))}
          onPick={changeKind}
          onClose={() => setAsk(null)}
        />
      ) : null}

      {askRate !== null ? (
        <RateDialog
          currency={askRate}
          base={base}
          day={rateDayOf(draft.occurredAt)}
          current={askRate === draft.currency && rate !== undefined
            ? { rate, source: draft.rateSource ?? "group" } : undefined}
          onSave={(typed: string, source: RateSource) => {
            const latest = getDraft(groupId) ?? draft;
            patch({ rate: typed, rateSource: source, rateCurrency: askRate, rateDay: rateDayOf(latest.occurredAt) });
          }}
          onClose={() => setAskRate(null)}
        />
      ) : null}
    </Screen>
  );
}
