"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  minorToDecimalString, receiptExtras, receiptOf, settleRest,
  type Group, type RateSource,
} from "@bida/core";
import { handOffReceiptTotal } from "@/lib/scan/items";
import { Card, Chip } from "@/components/bits";
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
  addExpense, editExpense, editSettlement, recordSettlement, setRate,
} from "@/lib/db/commands";
import { ENTRY_KINDS, type EntryKind } from "@/lib/entry-kind";
import { copy } from "@/lib/copy";
import { checkEntry, needsRate } from "@/lib/entry-check";
import { useRefusals } from "@/lib/refusal";
import { bare, dateInputValue, errorText, money, plural, withDate } from "@/lib/format";
import { formParent, parseEntrySource, route, type EntrySource } from "@/lib/group-link";
import { useClaimGate, useGroupData, type GroupData } from "@/lib/hooks";
import { markSaved } from "@/lib/ledger-motion";
import { goUp, goBack, sameScreen } from "@/lib/nav";
import {
  blankDraft, clearDraft, draftSeedKey, expenseDraft, getDraft, isDraftDirty, newEntryKey, openSplitTab,
  retimed, saveDraft, seedDraft, splitSeed, transferDraft, useDraft, withSplit,
  type EntryDraft, type SplitTab,
} from "@/lib/draft";

/**
 * One form for all three kinds of entry (ADR-0010): a kind chip rather than
 * three routes, so picking the wrong kind loses nothing. Switching keeps the
 * amount, currency, date and description; only the middle of the form swaps.
 */
export default function EditEntryPage() {
  return <QueryBoundary><EditEntryScreen /></QueryBoundary>;
}

/**
 * The route: reads the link, seeds the draft and owns its lifetime, and draws
 * a dead end where there is nothing to edit. `EntryForm` is the form.
 */
function EditEntryScreen() {
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const entryId = params.get("e") ?? undefined;
  const wantedKind = params.get("kind") as EntryKind | null;
  // A link may hand a new entry its name (the tip screen does). Nothing else is
  // seeded from a query: a figure arriving by link is a figure nobody typed.
  const prefillTitle = params.get("title") ?? undefined;

  const data = useGroupData(groupId);
  const unclaimed = useClaimGate(groupId, data);
  const draft = useDraft(groupId);

  // What this screen was opened *on*: an entry's id, or — creating — everything
  // the link asked for. Returning from the payers editor or the grid re-mounts
  // with the same key, so the draft survives; a different link replaces a
  // leftover draft rather than inheriting it.
  const seedKey = entryId ?? newEntryKey(wantedKind, { title: prefillTitle });

  // Seed the draft once the group is loaded: from the entry being edited —
  // looked up in both tables, since one id parameter covers all three kinds —
  // or blank, in the kind the caller asked for.
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

  // Nothing is stored, so a reload or a closed tab loses what's typed. Let the
  // browser say so, the same way it does for any other half-filled form.
  useEffect(() => {
    if (!groupId) return;
    const warn = (e: BeforeUnloadEvent) => { if (isDraftDirty(groupId)) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [groupId]);

  /**
   * This screen has answered for its draft and is leaving, so it has stopped
   * guarding the way — the same flag `/new` keeps (app/new/page.tsx).
   */
  const leaving = useRef(false);
  /**
   * **The draft goes when the screen does, not before.** Leaving isn't instant:
   * a traversal Android swallows is repaired a breath later (`SWALLOWED_MS`,
   * lib/nav.ts), and with the draft already cleared that gap draws
   * `<Blank title="New" />` — a screen that failed to leave reads as a fresh
   * blank entry (docs/navigation.md#gotchas).
   *
   * Guarded by the flag, because the payers editor and the grid unmount this
   * screen too and the draft is not theirs to throw away.
   */
  useEffect(() => () => { if (leaving.current && groupId) clearDraft(groupId); }, [groupId]);

  const title = entryId ? copy.form.editTitle : copy.form.newTitle;
  // No members means no payer to seed a draft with, and without this the screen
  // is a titled blank forever. Reachable: a group pulled before its members
  // arrive, or opened on a phone that hasn't claimed anybody.
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
  // An `e` naming nothing in either table is the same dead end; a link to a
  // deleted entry is the ordinary way here.
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
  /**
   * Which screen sent us here, when it wasn't the ledger's "+" — the balances
   * tab's settle-up row, or an entry reached from the history feed or a
   * "can't remove this yet" list. Saving goes back there (lib/group-link.ts).
   */
  via: EntrySource | undefined;
  /** Set once this form has answered for its draft and is on its way out. */
  leaving: RefObject<boolean>;
}) {
  const router = useRouter();
  const scan = useReceiptScan(groupId, useScanAs(groupId));
  const saveTo = formParent(groupId, draft.entryId, via);
  const base = group.baseCurrency;
  const kind = draft.kind;
  const transfer = kind === "transfer";

  const [ask, setAsk] = useState<null | "discard" | "currency" | "payer" | "kind">(null);
  /** Which currency's rate is being set, if any. See `pickCurrency`. */
  const [askRate, setAskRate] = useState<string | null>(null);
  const [failed, setFailed] = useState<string>();
  /**
   * A save in flight. **Every button that writes needs one** (`ConfirmDialog`,
   * `RateDialog`, `NameAdder`, `WhoPicker` all hold it): two taps on Save land
   * before `router.replace` does and both pass `ready` — a transfer written
   * twice, for twice the money.
   *
   * Cleared only on failure: a save that worked is navigating away, and a press
   * during that must still find the button spent.
   */
  const [saving, setSaving] = useState(false);
  // What the entry is worth and whether Save may light — one function, so the
  // arithmetic behind that button has a test suite rather than a screen to
  // mount (lib/entry-check.ts). The form reads its answers; it writes nothing.
  const {
    activeTab, canScan, activeSplit, receiptSplit, effectiveSplit, receiptTotal, receiptLocksAmount,
    onReceiptTab, amountMinor, baseMinor, foreign, groupRate, rateOk, blocker, splitProblem, splitTick,
    receiptMissing, ready,
    amountMissing, titleMissing,
  } = checkEntry({
    draft, base, rates: data.rates,
    liveMembers: data.members.map((m) => m.id),
    nameOf: data.nameOf,
  });

  /**
   * What a refused Save can bloom: two fields, the Items tab's step (a photo or
   * the who-had-what grid), the rate badge when the group has no rate for
   * the currency — that badge is the whole fix, with no field here to point at
   * — and the sentences in the Save dock: the payers', and the split's.
   */
  const missing = {
    amount: amountMissing, title: titleMissing, receipt: receiptMissing,
    rate: foreign && groupRate === undefined, blocker: blocker !== null, split: splitProblem !== null,
  };
  /** The dock's lines over Save: what is wrong, then the tick that nothing is. */
  const docked = blocker !== null || splitProblem !== null || splitTick !== null;
  // Both of the form's first fields empty: the top shows both, where the
  // nearest would leave the amount above the fold.
  const refusals = useRefusals(missing, (aimed) => !!aimed.amount && !!aimed.title);

  /**
   * **The rate dialog opens for whatever currency the draft is *in*, never for
   * the act of picking one** — a scan picks one too (`/g/scan` fills the draft
   * before navigating here), and a photographed MAD receipt would otherwise
   * arrive at the draft's old rate.
   *
   * The ref keeps it to one ask: dismissing leaves the currency as it was, and
   * the effect would reopen it. `pickCurrency` clears it, so picking the same
   * currency again does ask again.
   */
  const rateAsked = useRef<string | null>(null);
  useEffect(() => {
    if (rateAsked.current === draft.currency) return;
    if (!needsRate(data.rates, base, draft.currency)) return;
    rateAsked.current = draft.currency;
    setAskRate(draft.currency);
  }, [draft.currency, base, data.rates]);

  // Merges against the latest saved draft, not this render's `draft`: some
  // handlers (switching split tabs) call patch() twice, and a stale closure
  // would let the second clobber the first.
  const patch = (change: Partial<EntryDraft>) =>
    saveDraft(groupId, clipAmountToCurrency({ ...(getDraft(groupId) ?? draft), ...change }));

  /**
   * Change the entry's currency, and ask for its rate when the group has none.
   * Otherwise a MAD pick in a EUR group keeps rate "1", passes validation, and
   * banks a 500 MAD dinner as €500 — so the dialog opens on the spot, and Save
   * is held until the group has a number.
   */
  function pickCurrency(currency: string) {
    patch({ currency });
    rateAsked.current = currency;
    if (needsRate(data.rates, base, currency)) setAskRate(currency);
  }

  /**
   * Switching tabs. Two handoffs, each only into a tab with nothing of its own
   * yet: `openSplitTab` gives it a split to start from, and `handOffReceiptTotal`
   * gives the amount field Receipt's derived total — without it the expense
   * silently becomes worth zero (ADR-0016). A tab holding an answer keeps it.
   */
  function changeTab(splitTab: SplitTab) {
    const handoff = handOffReceiptTotal(
      activeTab, splitTab, draft.receiptItems, receiptExtras(draft), draft.currency,
    );
    patch({
      splitTab,
      splits: openSplitTab(draft, splitTab, baseMinor),
      ...(handoff !== null ? { amountText: handoff } : {}),
    });
  }

  /**
   * Change which of the three this is, keeping what the new kind can use.
   * Leaving Receipt takes the same handoff as a tab switch.
   */
  function changeKind(next: EntryKind) {
    if (next === kind) return;
    const leavingReceipt = onReceiptTab && next !== "expense";
    const handoff = leavingReceipt
      ? handOffReceiptTotal(activeTab, "equal", draft.receiptItems, receiptExtras(draft), draft.currency)
      : null;
    // "Reimbursement" is only written by settle up's card. A transfer leaving that
    // kind hands on an empty field rather than a word that no longer fits.
    const note = next !== "transfer" && draft.description === copy.form.reimbursement
      ? "" : draft.description;
    patch({
      kind: next,
      description: note,
      ...(leavingReceipt
        ? { splitTab: "equal" as SplitTab, splits: openSplitTab(draft, "equal", baseMinor) }
        : {}),
      ...(handoff !== null ? { amountText: handoff } : {}),
    });
  }

  // Largest share first, so the card reads as who carried the bill; ties by id
  // so the order doesn't shuffle as amounts are retyped.
  const coPayers = Object.entries(draft.payers ?? {})
    .filter(([, v]) => v > 0)
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));

  /**
   * May we leave? Leaving throws the draft away — there is nowhere for it to be
   * kept — so not with a typed draft: ask, and stay put.
   */
  function mayLeave() {
    if (leaving.current) return true;
    if (isDraftDirty(groupId)) { setAsk("discard"); return false; }
    clearDraft(groupId);
    return true;
  }

  function discard() {
    // Once, however many presses land in the window the repair above needs:
    // each would ask for its own traversal and schedule its own repair.
    if (leaving.current) return;
    leaving.current = true;
    goBack(() => router.back(), (to) => router.replace(to));
  }

  async function save() {
    // Every write below is signed by whoever this phone said it was. It has
    // said — `useClaimGate` sends a phone that hasn't to the screen that asks
    // — so this is the compiler being shown that, not a fallback.
    const actor = data.me;
    if (!ready) {
      refusals.refuse(missing);
      return;
    }
    if (saving || !actor) return;
    setSaving(true);
    setFailed(undefined);
    const rate = foreign ? groupRate ?? "1" : "1";
    try {
      let wrote = draft.entryId;
      if (transfer) {
        const input = {
          fromMember: draft.fromMember,
          toMember: draft.toMember,
          amountMinor,
          currency: draft.currency,
          rateToBase: rate,
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
          // Written only when true (`only`/`wholeEntity`): a timed entry is the absence
          // of this field.
          dateOnly: draft.dateOnly ? true : null,
          amountMinor,
          currency: draft.currency,
          rateToBase: rate,
          paidBy: draft.paidBy,
          payers: draft.payers,
          // The rest's figures written in, so a phone that predates `rest`
          // reads a split that adds up (core/split.ts).
          split: settleRest(amountMinor, effectiveSplit, { tiebreakSeed: splitSeed(draft) }),
          categoryId: draft.categoryId,
          // An income has no bill. Turning an expense into one clears the scan
          // rather than leaving a receipt hanging off an entry that can never
          // show it again.
          ...receiptOf(canScan ? draft : {}),
        };
        if (draft.entryId) await editExpense(groupId, actor, draft.entryId, input);
        // Written under the id the form has been quoting its split with, so
        // the cent it showed on somebody's row is the cent the ledger keeps.
        else wrote = await addExpense(groupId, actor, input, Date.now(), draft.newEntryId);
      }
      // Landing on the ledger, the row is shown where it went (components/ledger-rows.tsx).
      if (wrote && sameScreen(saveTo, route.group(groupId))) markSaved(groupId, wrote);
      leaving.current = true;
      // `goUp`, not a replace: the screen we are going back to is already
      // behind us, and replacing would leave it on the stack twice.
      goUp(saveTo, (to) => router.replace(to));
    } catch (err) {
      setSaving(false);
      setFailed(errorText(err));
    }
  }

  /**
   * Which kinds this screen can still become. Everything, on a new entry.
   * Editing an expense keeps the one field that separates it from an income,
   * so those two stay open — but a transfer is a different entity with a
   * different shape, and an edit never crosses between them (ADR-0010). A
   * control that can't do anything doesn't get drawn.
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
          /* The kind sits on the row that already names the screen. */
          right={reachable.length > 1 ? (
            <button type="button" className="chip kindchip" aria-label={copy.form.kindTitle}
              onClick={() => setAsk("kind")}>
              {copy.entryKind.label[kind]}<Icon name="updown" size={11} className="kindmark" />
            </button>
          ) : undefined}
        />

        <Scroll>
          {scan.inputs}

          <div className="pad" style={{ textAlign: "center", paddingTop: 16, paddingBottom: 10 }}>
            {/* Grid rows, not centred lines: the typed amount, its converted figure
                and the scan's badge share a right edge; the currency chip and rate
                control share a left one. `.amountfield` is rendered by `AmountInput`,
                so the refusal's `animationend` is caught here on the way up. */}
            <div className="amtgrid" data-refuse="amount" onAnimationEnd={refusals.onFlashEnd("amount")}>
              <AmountInput
                className="amount"
                fieldClassName={`big${refusals.flash("amount")}`}
                aria-label={copy.form.amount(draft.currency)}
                enterKeyHint="next"
                // "0.00", "0" for yen: the shape of what goes here, as every
                // other money field in the app shows it.
                placeholder={bare(0, draft.currency)}
                currency={draft.currency}
                value={receiptTotal !== null
                  ? minorToDecimalString(receiptTotal, draft.currency) : draft.amountText}
                onChange={(amountText) => patch({ amountText })}
                autoSize={true}
                disabled={receiptLocksAmount}
              />
              <button type="button" className="chip" aria-label={copy.form.currency}
                onClick={() => setAsk("currency")}>
                {draft.currency}
              </button>

              {/* What the entry is worth in the group's currency. The rate belongs to
                  the group: both controls open the registry's dialog, which also says
                  how much of the ledger moves. */}
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
                    rate={groupRate}
                    aria-label={copy.rates.editTitle(draft.currency)}
                    onClick={() => setAskRate(draft.currency)} />
                </>
              ) : null}

              {/* The scan that typed the amount — a grid row, so it ends on the
                  amount's last digit (odd children are the right-hand column). */}
              {receiptLocksAmount ? (
                <div className="amtnotes">
                  <div className="amtnote">{copy.form.fromReceipt}</div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="pad" style={{ paddingTop: 4, paddingBottom: docked ? 0 : undefined,
            display: "flex", flexDirection: "column", gap: 9 }}>
            {transfer ? (
              <TransferSides
                members={data.members}
                from={draft.fromMember}
                to={draft.toMember}
                onChange={(sides) => patch(sides)}
              />
            ) : null}

            <div className={`field${refusals.flash("title")}`} data-refuse="title" onAnimationEnd={refusals.onFlashEnd("title")}>
              {transfer ? null : <label htmlFor="what">{copy.form.what}</label>}
              {/* The end of the field chain: the split's figures are a chain of their
                  own, so a press here folds the keyboard (`walkFields`,
                  components/viewport.tsx). */}
              <input id="what" value={draft.description}
                enterKeyHint="done"
                aria-label={transfer ? copy.form.note : copy.form.what}
                placeholder={transfer ? copy.form.note : copy.form.whatPlaceholder}
                onChange={(e) => patch({ description: e.target.value })} />
            </div>

            {transfer ? null : coPayers.length > 1 ? (
              <Card style={{ padding: "10px 12px" }}>
                <Link href={route.payers(groupId)} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="fieldlabel">{copy.entryKind.payer[kind]}</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>
                    {plural(coPayers.length, copy.noun.person)}
                  </span>
                  <Icon name="chev" size={14} className="spacer muted" />
                </Link>
                <div className="hairline" />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {coPayers.map(([id, amount]) => (
                    <Chip key={id} variant={id === data.me ? "hl" : undefined}>
                      {(data.memberById.get(id)?.name ?? copy.unknown).split(" ")[0]} {money(amount, draft.currency)}
                    </Chip>
                  ))}
                </div>
              </Card>
            ) : (
              <div className="field">
                <span className="fieldlabel">{copy.entryKind.payer[kind]}</span>
                <button type="button" id="paidby" className="pick"
                  aria-label={copy.entryKind.payer[kind]} onClick={() => setAsk("payer")}>
                  <span className="ptext">{data.memberById.get(draft.paidBy)?.name ?? copy.none}</span>
                  <Icon name="updown" size={18} className="spacer pchev" />
                </button>
              </div>
            )}

            <div className="field">
              <label htmlFor="when">{copy.form.when}</label>
              <input id="when" type="date" value={dateInputValue(draft.occurredAt)}
                onChange={(e) => patch(retimed(draft, withDate(draft.occurredAt, e.target.value)))} />
            </div>

            {transfer ? null : (
              <SplitEditor
                members={data.members}
                me={data.me}
                title={copy.entryKind.split[kind]}
                amountMinor={amountMinor}
                amountCurrency={draft.currency}
                spec={activeSplit}
                receiptSplit={receiptSplit}
                seed={splitSeed(draft)}
                onChange={(split) => patch({ splits: withSplit(draft.splits, split) })}
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
            )}

          </div>
        </Scroll>
        {/* The form's last row, docked (`.whodock`): under the split while the
            form fits, at the foot of the screen once a long split scrolls above
            it, and above the keyboard while one is up. Always pressable: `save`
            answers with the refusal flash on whatever is missing. What is wrong
            with the payers or the split is said here, over Save, where scrolling
            can't hide it, and so is the tick that typed amounts add up. */}
        {/* 9px between the lines, Save and whatever the scroll has cut off
            above them: the dock's own padding, never the form's, which is only
            there once the form is scrolled to its end. */}
        <div className="pad whodock" style={{ paddingTop: docked ? 9 : 18 }}>
          {blocker ? (
            <div role="status" data-refuse="blocker" style={{ marginBottom: 9 }}
              className={`splitfoot bad alone${refusals.flash("blocker")}`}
              onAnimationEnd={refusals.onFlashEnd("blocker")}>
              <span>{blocker}</span>
            </div>
          ) : null}
          {splitProblem ? (
            <div role="status" data-refuse="split" style={{ marginBottom: 9 }}
              className={`splitfoot bad alone${refusals.flash("split")}`}
              onAnimationEnd={refusals.onFlashEnd("split")}>
              <span>{splitProblem}</span>
            </div>
          ) : null}
          {splitTick ? (
            <div role="status" className="splitfoot ok alone" style={{ marginBottom: 9 }}>
              <Icon name="check" size={14} style={{ flex: "none" }} />
              <span>{splitTick}</span>
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
            // The payers screen divides the amount, so with none it would split a
            // zero: the row stays, greyed, and says what comes first.
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

      {/* The same dialog the registry screen opens, so a rate set from here
          is the group's rate and not a number private to this entry. */}
      {askRate !== null ? (
        <RateDialog
          currency={askRate}
          base={base}
          current={data.rates[askRate]}
          entryCount={data.currencies.find((c) => c.currency === askRate)?.entryCount ?? 0}
          onSave={async (rate: string, source: RateSource, asOf: number) => {
            if (data.me) await setRate(groupId, data.me, askRate, rate, source, asOf);
          }}
          onClose={() => setAskRate(null)}
        />
      ) : null}
    </Screen>
  );
}
