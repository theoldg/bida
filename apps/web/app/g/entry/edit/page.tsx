"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  isCurrencyCode, minorToDecimalString, receiptExtras,
  type RateSource,
} from "@bida/core";
import { handOffReceiptTotal } from "@/lib/scan/items";
import { Card, Chip, keepsFocus } from "@/components/bits";
import { AmountInput, clipAmountToCurrency } from "@/components/amount-input";
import { useReceiptScan } from "@/components/receipt-scan";
import { useScanAs } from "@/lib/quick";
import { SplitEditor } from "@/components/split-editor";
import { BadLink, Blank, Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "@/components/chrome";
import { ChoiceDialog, ConfirmDialog, PromptDialog } from "@/components/dialog";
import { RateDialog } from "@/components/rate-dialog";
import { Icon } from "@/components/icons";
import { TransferSides } from "@/components/transfer-sides";
import { currencyChoices, currencyLabel, normalizeCurrencyCode, OTHER_CURRENCY } from "@/lib/currencies";
import {
  addExpense, editExpense, editSettlement, recordSettlement, setRate,
} from "@/lib/db/commands";
import { ENTRY_KINDS, kindOf, type EntryKind } from "@/lib/entry-kind";
import { copy } from "@/lib/copy";
import { checkEntry, needsRate } from "@/lib/entry-check";
import { flashClass, NOT_REFUSED, refused, staleFlashes, stillMissing, type Refusal } from "@/lib/refusal";
import { nearestOutOfView, scrollTarget } from "@/lib/reveal";
import { glide } from "@/lib/seek";
import { dateInputValue, errorText, money, plural, withDate } from "@/lib/format";
import { formParent, parseEntrySource, route } from "@/lib/group-link";
import { useClaimGate, useGroupData } from "@/lib/hooks";
import { goUp, goBack } from "@/lib/nav";
import {
  blankDraft, clearDraft, draftSeedKey, getDraft, isDraftDirty, newEntryKey, openSplitTab, retimed,
  saveDraft,
  seedDraft, splitSeed, useDraft, withSplit, type EntryDraft, type SplitTab,
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
 * What a refused Save can bloom: two fields, the Items tab's step (a photo or
 * the who-had-what grid), and the rate badge when the group has no rate for
 * the currency — that badge is the whole fix, with no field here to point at.
 */
const REFUSABLE = ["amount", "title", "receipt", "rate"] as const;
type Refusable = typeof REFUSABLE[number];

function EditEntryScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const entryId = params.get("e") ?? undefined;
  const wantedKind = params.get("kind") as EntryKind | null;
  // Which screen sent us here, when it wasn't the ledger's "+" — the balances
  // tab's settle-up row, or an entry reached from the history feed or a
  // "can't remove this yet" list. Saving goes back there (lib/group-link.ts).
  const via = parseEntrySource(params.get("via"));
  const saveTo = groupId ? formParent(groupId, entryId, via) : "/";
  // A link may hand a new entry its name (the tip screen does). Nothing else is
  // seeded from a query: a figure arriving by link is a figure nobody typed.
  const prefill = { title: params.get("title") ?? undefined };

  const data = useGroupData(groupId);
  const unclaimed = useClaimGate(groupId, data);
  const draft = useDraft(groupId);
  const scan = useReceiptScan(groupId, useScanAs(groupId));
  const [ask, setAsk] = useState<null | "discard" | "currency" | "currency-other" | "payer" | "kind">(null);
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
  // Save is always tappable; a tap while invalid flips this, which puts the
  // blocker sentence on screen — an untouched form shows no errors. What is
  // *missing* rather than wrong blooms its own control instead, with no flag.
  const [attemptedSave, setAttemptedSave] = useState(false);
  /**
   * The refusal flash, per field (`lib/refusal.ts`), so a field that wasn't the
   * problem this time stays quiet.
   */
  const [refusedFields, setRefused] = useState<Record<Refusable, Refusal>>({
    amount: NOT_REFUSED, title: NOT_REFUSED, receipt: NOT_REFUSED, rate: NOT_REFUSED,
  });
  const refuse = (fields: Partial<Record<Refusable, boolean>>) =>
    setRefused((r) => {
      const next = { ...r };
      for (const f of REFUSABLE) if (fields[f]) next[f] = refused(r[f]);
      return next;
    });
  /**
   * What is missing as of the latest render. A refusal that scrolls first reads
   * it when the scroll lands: a field fixed mid-scroll has nothing to bloom, and
   * a flash on it would lock Save for nothing.
   */
  const missingNow = useRef<Partial<Record<Refusable, boolean>>>({});
  /**
   * Scrolling to what a refusal points at. Save is spent for the travel as well
   * as the flash, or a second press would start a second journey.
   */
  const [seeking, setSeeking] = useState(false);
  /**
   * A flash whose field stopped being missing ends here, by hand. The flash can
   * leave with its element (the Items tab switched away, "set rate" gone), and
   * an animation removed mid-flight never fires `animationend`, so Save would
   * stay spent for good (design-system.md's Gotchas).
   */
  useEffect(() => {
    const stale = staleFlashes(refusedFields, missingNow.current);
    if (stale.length === 0) return;
    setRefused((r) => {
      const next = { ...r };
      for (const f of stale) next[f] = { ...r[f], live: false };
      return next;
    });
  });
  /**
   * A refusal is still on screen, and Save is spent for exactly as long. Read
   * off the flash rather than a timer of its own, so the two can't drift.
   */
  const refusing = REFUSABLE.some((f) => refusedFields[f].live);
  /**
   * The flash is over. Only the field's own animation counts — the placeholder
   * is a pseudo-element on the same clock, and `pseudoElement` is how an
   * animation event says which of the two it is.
   */
  const settled = (field: Refusable) => (e: React.AnimationEvent) => {
    if (e.pseudoElement) return;
    setRefused((r) => ({ ...r, [field]: { ...r[field], live: false } }));
  };

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
    if (!draft || !data.group) return;
    if (rateAsked.current === draft.currency) return;
    if (!needsRate(data.rates, data.group.baseCurrency, draft.currency)) return;
    rateAsked.current = draft.currency;
    setAskRate(draft.currency);
  }, [draft, data.group, data.rates]);

  // What this screen was opened *on*: an entry's id, or — creating — everything
  // the link asked for. Returning from the payers editor or the grid re-mounts
  // with the same key, so the draft survives; a different link replaces a
  // leftover draft rather than inheriting it.
  const seedKey = entryId ?? newEntryKey(wantedKind, prefill);

  // Seed the draft once the group is loaded: from the entry being edited —
  // which is looked up in both tables, since one id parameter covers all three
  // kinds — or blank, in the kind the caller asked for.
  useEffect(() => {
    if (!groupId || data.loading || !data.group) return;
    if (draftSeedKey(groupId) === seedKey) return;
    const me = data.me ?? data.members[0]?.id;
    if (!me) return;
    const base = data.group.baseCurrency;

    if (entryId) {
      const e = data.expenses.find((x) => x.id === entryId);
      if (e) {
        seedDraft(groupId, {
          ...blankDraft(kindOf(e), me, base, data.members.map((m) => m.id)),
          entryId,
          // `minorToDecimalString`, never `bare`: this is the canonical text
          // `parseMinor` reads back, and `bare` groups thousands. "1,234.50"
          // fails to parse (amount silently 0) and "25,000" JPY parses as 25.
          amountText: minorToDecimalString(e.amountMinor, e.currency),
          currency: e.currency,
          description: e.description,
          paidBy: e.paidBy,
          payers: e.payers ?? null,
          // A receipt's weights are the bill's, so they are not handed to the
          // arithmetic tabs: those start where a fresh entry's do (`blankDraft`
          // above), even over everyone. The bill itself is reopened from the
          // receipt fields below, and Receipt recomputes its split from them
          // (ADR-0016).
          ...(e.split.mode === "receipt" ? {} : { splits: withSplit({}, e.split) }),
          fromMember: me,
          toMember: data.members.find((m) => m.id !== me)?.id ?? me,
          occurredAt: e.occurredAt,
          dateOnly: e.dateOnly === true,
          recordedAt: e.createdAt ?? e.occurredAt,
          categoryId: e.categoryId ?? null,
          receiptItems: e.receiptItems ?? null,
          receiptText: e.receiptText ?? null,
          receiptTip: e.receiptTip ?? null,
          receiptTax: e.receiptTax ?? null,
          receiptDiscounts: e.receiptDiscounts ?? null,
          receiptInvolved: e.receiptInvolved ?? null,
          receiptAssignments: e.receiptAssignments ?? null,
          // The tab *is* the mode — a receipt included. The exception is a
          // percent split, which has no tab of its own: `legacyPercent` draws
          // it, and the first tap converts it away.
          splitTab: e.split.mode === "percent" ? undefined : e.split.mode,
        }, seedKey);
        return;
      }
      const s = data.settlements.find((x) => x.id === entryId);
      if (!s) return;
      seedDraft(groupId, {
        ...blankDraft("transfer", me, base, data.members.map((m) => m.id)),
        entryId,
        amountText: minorToDecimalString(s.amountMinor, s.currency),
        currency: s.currency,
        description: s.note ?? "",
        fromMember: s.fromMember,
        toMember: s.toMember,
        occurredAt: s.occurredAt,
        dateOnly: s.dateOnly === true,
        recordedAt: s.createdAt ?? s.occurredAt,
      }, seedKey);
      return;
    }

    const kind: EntryKind = wantedKind && ENTRY_KINDS.includes(wantedKind) ? wantedKind : "expense";
    const blank = blankDraft(kind, me, base, data.members.map((m) => m.id));
    seedDraft(groupId, {
      ...blank,
      ...(prefill.title ? { description: prefill.title } : {}),
    }, seedKey);
    // `prefill` is rebuilt each render; the query params behind it are what
    // actually change, and the draft is only ever seeded once per entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, entryId, seedKey, wantedKind, prefill.title, data.loading, data.group, data.members, data.me, data.expenses, data.settlements]);

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
   * blank entry (docs/frontend.md#gotchas).
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
  const group = data.group;
  const base = group.baseCurrency;
  const kind = draft.kind;
  const transfer = kind === "transfer";

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
    if (needsRate(data.rates, data.group?.baseCurrency, currency)) setAskRate(currency);
  }

  // What the entry is worth and whether Save may light — one function, so the
  // arithmetic behind that button has a test suite rather than a screen to
  // mount (lib/entry-check.ts). The form reads its answers; it writes nothing.
  const check = checkEntry({
    draft, base, rates: data.rates,
    liveMembers: data.members.map((m) => m.id),
    nameOf: data.nameOf,
  });
  const {
    activeTab, canScan, activeSplit, receiptSplit, effectiveSplit, receiptTotal, receiptLocksAmount,
    onReceiptTab, amountMinor, baseMinor, foreign, groupRate, rateOk, blocker, receiptMissing, ready,
    amountMissing, titleMissing,
  } = check;
  missingNow.current = {
    amount: amountMissing, title: titleMissing, receipt: receiptMissing,
    rate: foreign && groupRate === undefined,
  };

  /**
   * A refusal, once what it points at can be seen. With the keyboard up the form
   * is a strip of a few rows, and a flash out of view is a press that did
   * nothing: unless a refused control is wholly in view, the nearest is scrolled
   * to, and then it blooms off a fresh reading of what is still missing.
   */
  const refuseInView = (fields: Partial<Record<Refusable, boolean>>) => {
    const box = document.querySelector<HTMLElement>(".scroll");
    const seen = REFUSABLE.flatMap((f) => {
      const el = fields[f] ? box?.querySelector(`[data-refuse="${f}"]`) : null;
      if (!el) return [];
      const { top, bottom } = el.getBoundingClientRect();
      return [{ top, bottom }];
    });
    if (!box || seen.length === 0) { refuse(fields); return; }
    // The band a control can be read in: the scroller less its scroll padding,
    // which at the bottom is the keyboard it is drawn over (`--kb`).
    const view = box.getBoundingClientRect();
    const pad = getComputedStyle(box);
    const reach = nearestOutOfView(seen, {
      top: view.top + (parseFloat(pad.scrollPaddingTop) || 0),
      bottom: view.bottom - (parseFloat(pad.scrollPaddingBottom) || 0),
    });
    if (reach === null) { refuse(fields); return; }
    const target = scrollTarget(box, reach);
    if (target === box.scrollTop) { refuse(fields); return; }
    setSeeking(true);
    glide(box, target, () => {
      setSeeking(false);
      refuse(stillMissing(fields, missingNow.current));
    });
  };

  /**
   * Switching tabs. Two handoffs, each only into a tab with nothing of its own
   * yet: `openSplitTab` gives it a split to start from, and `handOffReceiptTotal`
   * gives the amount field Receipt's derived total — without it the expense
   * silently becomes worth zero (ADR-0016). A tab holding an answer keeps it.
   */
  const changeTab = (splitTab: SplitTab) => {
    const handoff = handOffReceiptTotal(
      activeTab, splitTab, draft.receiptItems, receiptExtras(draft), draft.currency,
    );
    patch({
      splitTab,
      splits: openSplitTab(draft, splitTab, baseMinor),
      ...(handoff !== null ? { amountText: handoff } : {}),
    });
  };

  /**
   * Change which of the three this is, keeping what the new kind can use.
   * Leaving Receipt takes the same handoff as a tab switch.
   */
  const changeKind = (next: EntryKind) => {
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
  };

  const coPayers = Object.entries(draft.payers ?? {}).filter(([, v]) => v > 0);

  // Leaving throws the draft away — there is nowhere for it to be kept — so ask
  // first, but only once something has actually been typed.
  /** May we leave? Not with a typed draft — ask, and stay put. */
  function mayLeave() {
    if (leaving.current) return true;
    if (!groupId) return true;
    if (isDraftDirty(groupId)) { setAsk("discard"); return false; }
    clearDraft(groupId);
    return true;
  }

  function discard() {
    // Once, however many presses land in the window the repair above needs:
    // each would ask for its own traversal and schedule its own repair.
    if (!groupId || leaving.current) return;
    leaving.current = true;
    goBack(() => router.back(), (to) => router.replace(to));
  }

  // An arrow, not a hoisted `function`: a declaration is created before the
  // guard above runs, so TypeScript wouldn't carry "draft exists" into it and
  // every read had to assert it back.
  const save = async () => {
    // Every write below is signed by whoever this phone said it was. It has
    // said — `useClaimGate` sends a phone that hasn't to the screen that asks
    // — so this is the compiler being shown that, not a fallback.
    const actor = data.me;
    if (!ready) {
      setAttemptedSave(true);
      if (seeking) return;
      refuseInView({
        amount: amountMissing, title: titleMissing, receipt: receiptMissing,
        rate: foreign && groupRate === undefined,
      });
      return;
    }
    if (saving || !groupId || !actor) return;
    setSaving(true);
    setFailed(undefined);
    const rate = foreign ? groupRate ?? "1" : "1";
    try {
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
        else await recordSettlement(groupId, actor, input);
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
          split: effectiveSplit,
          categoryId: draft.categoryId,
          // An income has no bill. Turning an expense into one clears the scan
          // rather than leaving a receipt hanging off an entry that can never
          // show it again.
          receiptItems: canScan ? draft.receiptItems ?? null : null,
          receiptText: canScan ? draft.receiptText ?? null : null,
          receiptTip: canScan ? draft.receiptTip ?? null : null,
          receiptTax: canScan ? draft.receiptTax ?? null : null,
          receiptDiscounts: canScan ? draft.receiptDiscounts ?? null : null,
          receiptInvolved: canScan ? draft.receiptInvolved ?? null : null,
          receiptAssignments: canScan ? draft.receiptAssignments ?? null : null,
        };
        if (draft.entryId) await editExpense(groupId, actor, draft.entryId, input);
        // Written under the id the form has been quoting its split with, so
        // the cent it showed on somebody's row is the cent the ledger keeps.
        else await addExpense(groupId, actor, input, Date.now(), draft.newEntryId);
      }
      leaving.current = true;
      // `goUp`, not a replace: the screen we are going back to is already
      // behind us, and replacing would leave it on the stack twice.
      goUp(saveTo, (to) => router.replace(to));
    } catch (err) {
      setSaving(false);
      setFailed(errorText(err));
    }
  };

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
            <button type="button" className="chip" aria-label={copy.form.kindTitle}
              onClick={() => setAsk("kind")} {...keepsFocus}>
              {copy.entryKind.label[kind]} <Icon name="chev" size={10} />
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
            <div className="amtgrid" data-refuse="amount" onAnimationEnd={settled("amount")}>
              <AmountInput
                className="amount"
                fieldClassName={`big${flashClass(refusedFields.amount)}`}
                aria-label={copy.form.amount(draft.currency)}
                enterKeyHint="next"
                placeholder="0"
                currency={draft.currency}
                value={receiptTotal !== null
                  ? minorToDecimalString(receiptTotal, draft.currency) : draft.amountText}
                onChange={(amountText) => patch({ amountText })}
                autoSize={true}
                disabled={receiptLocksAmount}
              />
              <button type="button" className="chip" aria-label={copy.form.currency}
                onClick={() => setAsk("currency")} {...keepsFocus}>
                {draft.currency} <Icon name="chev" size={10} />
              </button>

              {/* What the entry is worth in the group's currency. The rate belongs to
                  the group: both controls open the registry's dialog, which also says
                  how much of the ledger moves. */}
              {foreign ? (
                <>
                  <button type="button" className="ratelink"
                    aria-label={copy.rates.openFor(draft.currency)}
                    onClick={() => setAskRate(draft.currency)} {...keepsFocus}>
                    ={" "}
                    <span className={rateOk ? undefined : "bad"}>
                      {rateOk ? money(baseMinor, base) : copy.none}
                    </span>
                  </button>
                  <button type="button" data-refuse="rate" className={`amtnote${flashClass(refusedFields.rate)}`}
                    onAnimationEnd={settled("rate")} {...keepsFocus}
                    onClick={() => setAskRate(draft.currency)}>
                    {copy.rates.setRate()}
                  </button>
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

          <div className="pad" style={{ paddingTop: 4, display: "flex", flexDirection: "column", gap: 9 }}>
            {transfer ? (
              <TransferSides
                members={data.members}
                from={draft.fromMember}
                to={draft.toMember}
                onChange={(sides) => patch(sides)}
              />
            ) : null}

            <div className={`field${flashClass(refusedFields.title)}`} data-refuse="title" onAnimationEnd={settled("title")}>
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
                <Link href={route.payers(groupId)} {...keepsFocus} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="fieldlabel">{copy.entryKind.payer[kind]}</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>
                    {plural(coPayers.length, copy.noun.person)}
                  </span>
                  <Icon name="chev" size={14} className="spacer" style={{ color: "var(--muted)" }} />
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
              <div className="field field-row">
                {/* The heading is inside the button, not beside it: the button
                    is the row up to the quieter door beside it, so that much
                    lights on a press. */}
                <button type="button" id="paidby" className="pick"
                  aria-label={copy.entryKind.payer[kind]} onClick={() => setAsk("payer")} {...keepsFocus}>
                  <span className="fieldlabel">{copy.entryKind.payer[kind]}</span>
                  <span className="ptext">{data.memberById.get(draft.paidBy)?.name ?? copy.none}</span>
                  <Icon name="chev" size={13} className="pchev" />
                </button>
                {/* A second, quieter door onto the same field, on the same row:
                    one payer is the common case and costs one row. */}
                <button type="button" className="pick-sub" {...keepsFocus}
                  onClick={() => {
                    // The payers screen divides the amount, so with none it would split a
                    // zero. The tap doesn't travel — it flashes the amount field.
                    if (amountMissing) { if (!seeking) refuseInView({ amount: true }); return; }
                    router.push(route.payers(groupId));
                  }}>
                  <span>{copy.form.multiPayer[kind === "income" ? "income" : "expense"]}</span>
                  <Icon name="chev" size={11} />
                </button>
              </div>
            )}

            {attemptedSave && blocker ? <div className="failure">{blocker}</div> : null}

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
                totalMinor={baseMinor}
                totalUnknown={foreign && groupRate === undefined}
                currency={base}
                spec={activeSplit}
                receiptSplit={receiptSplit}
                seed={splitSeed(draft)}
                onChange={(split) => patch({ splits: withSplit(draft.splits, split) })}
                tab={activeTab}
                onTabChange={changeTab}
                receipt={canScan ? {
                  items: draft.receiptItems ?? null,
                  scan,
                  missing: receiptMissing,
                  flash: flashClass(refusedFields.receipt),
                  onFlashEnd: settled("receipt"),
                  editItemsHref: route.items(groupId, via),
                } : null}
              />
            )}

          </div>

          {/* The form's last row, not a bar pinned to the bottom, which fights the
              keyboard (it overlays the shell). Always pressable: `save` answers
              with the refusal flash on whatever is missing. */}
          <div className="pad" style={{ paddingTop: 18, paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
            {failed ? (
              <p className="failure" role="alert" style={{ margin: "0 2px 9px" }}>
                {copy.form.saveFailed(failed)}
              </p>
            ) : null}
            <button type="button" className="btn btn-p btn-lg" onClick={save}
              disabled={saving || refusing || seeking} {...keepsFocus}>
              {saving ? <span className="spinner" /> : null}{copy.act.save}
            </button>
          </div>
        </Scroll>
      </Body>

      {ask === "discard" ? (
        <ConfirmDialog
          title={entryId ? copy.form.discardTitleEdits : copy.form.discardTitle(copy.entryKind.label[kind].toLowerCase())}
          confirm={copy.act.discard}
          danger={true} onConfirm={discard} onClose={() => setAsk(null)}>
          <p>{copy.form.discardBody}</p>
        </ConfirmDialog>
      ) : null}

      {ask === "currency" ? (
        <ChoiceDialog
          title={copy.currency.title}
          value={draft.currency}
          options={[
            ...currencyChoices(
              [base, draft.currency], data.currencies.map((c) => c.currency),
            ).map((c) => ({
              value: c,
              label: currencyLabel(c),
              note: c === base ? copy.currency.isBase : undefined,
            })),
            { value: OTHER_CURRENCY, label: copy.currency.other, note: copy.currency.otherNote },
          ]}
          onPick={(currency) => {
            if (currency === OTHER_CURRENCY) { setAsk("currency-other"); return; }
            pickCurrency(currency);
          }}
          // "Other…" hands over to the prompt, so that pick must not close it.
          onClose={() => setAsk((a) => (a === "currency-other" ? a : null))}
        />
      ) : null}

      {ask === "payer" ? (
        <ChoiceDialog
          title={copy.entryKind.payer[kind]}
          value={draft.paidBy}
          options={data.members.map((m) => ({
            value: m.id,
            label: m.name,
            note: m.id === data.me ? copy.form.you : undefined,
          }))}
          onPick={(paidBy) => patch({ paidBy, payers: null })}
          onClose={() => setAsk(null)}
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
      {askRate !== null && groupId ? (
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

      {ask === "currency-other" ? (
        <PromptDialog title={copy.currency.title} placeholder={copy.currency.otherPlaceholder}
          confirm={copy.act.useIt} maxLength={3}
          autoCapitalize="characters"
          clean={normalizeCurrencyCode} valid={isCurrencyCode}
          onSubmit={(currency) => {
            pickCurrency(currency);
            setAsk(null);
          }}
          onClose={() => setAsk(null)} />
      ) : null}
    </Screen>
  );
}
