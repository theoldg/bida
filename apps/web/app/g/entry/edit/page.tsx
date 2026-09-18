"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  isCurrencyCode, minorToDecimalString, receiptExtras,
  type RateSource,
} from "@bida/core";
import { handOffReceiptTotal } from "../../../../lib/scan/items";
import { Card, Chip, keepsFocus } from "../../../../components/bits";
import { AmountInput, clipAmountToCurrency } from "../../../../components/amount-input";
import { useReceiptScan } from "../../../../components/receipt-scan";
import { SplitEditor } from "../../../../components/split-editor";
import { BadLink, Blank, Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "../../../../components/chrome";
import { ChoiceDialog, ConfirmDialog, PromptDialog } from "../../../../components/dialog";
import { RateDialog } from "../../../../components/rate-dialog";
import { Icon } from "../../../../components/icons";
import { TransferSides } from "../../../../components/transfer-sides";
import { COMMON_CURRENCIES, currencyLabel, normalizeCurrencyCode, OTHER_CURRENCY } from "../../../../lib/currencies";
import {
  addExpense, editExpense, editSettlement, recordSettlement, setRate,
} from "../../../../lib/db/commands";
import { ENTRY_KINDS, kindOf, type EntryKind } from "../../../../lib/entry-kind";
import { copy } from "../../../../lib/copy";
import { checkEntry, needsRate } from "../../../../lib/entry-check";
import { flashClass, NOT_REFUSED, refused, staleFlashes, stillMissing, type Refusal } from "../../../../lib/refusal";
import { nearestOutOfView, scrollTarget } from "../../../../lib/reveal";
import { glide } from "../../../../lib/seek";
import { dateInputValue, errorText, money, plural, withDate } from "../../../../lib/format";
import { formParent, parseEntrySource, route } from "../../../../lib/group-link";
import { useClaimGate, useGroupData, useGroupSecret } from "../../../../lib/hooks";
import { goUp, goBack } from "../../../../lib/nav";
import {
  blankDraft, clearDraft, draftSeedKey, getDraft, isDraftDirty, newEntryKey, openSplitTab, retimed,
  saveDraft,
  seedDraft, splitSeed, useDraft, withSplit, type EntryDraft, type SplitTab,
} from "../../../../lib/draft";

/**
 * One form for all three kinds of entry.
 *
 * Expense, income and transfer are one thought with one shape — an amount, a
 * date, some words, and who it moves between — so they are one screen with a
 * kind chip at the top rather than three routes that lose what you typed when
 * you realise you picked the wrong one (ADR-0010). Switching kinds keeps the
 * amount, the currency, the date and the description; only the middle of the
 * form is swapped.
 */
export default function EditEntryPage() {
  return <QueryBoundary><EditEntryScreen /></QueryBoundary>;
}

/**
 * What a refused Save can bloom. Two fields, a step and a number that isn't
 * on this form: the Items tab is short of a photograph or of a who-had-what
 * grid, and the control that takes whichever it is flashes exactly as the
 * amount's underline does; a currency the group has no rate for blooms the
 * badge that opens where the rate is set, because that is the whole of the
 * fix and there is no field here to point at.
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
  // Settle-up hands a transfer its two sides, its amount in base units, and
  // its note — so a blank "+" is the only way to reach a transfer untitled.
  const prefill = {
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    amount: Number(params.get("amount") ?? "0"),
    title: params.get("title") ?? undefined,
  };

  const data = useGroupData(groupId);
  const unclaimed = useClaimGate(groupId, data);
  const draft = useDraft(groupId);
  const secret = useGroupSecret(groupId);
  const scan = useReceiptScan(groupId, secret);
  const [ask, setAsk] = useState<null | "discard" | "currency" | "currency-other" | "payer" | "kind">(null);
  /** Which currency's rate is being set, if any. See `pickCurrency`. */
  const [askRate, setAskRate] = useState<string | null>(null);
  const [failed, setFailed] = useState<string>();
  /**
   * A save in flight. Two taps on Save land before `router.replace` does, and
   * both passed `ready` — which is a question about the form, not about
   * whether one press is already spending it. That wrote a transfer twice,
   * for twice the money, and gave an expense a second create op saying
   * nothing. Every other button in the app that writes already holds this
   * (`ConfirmDialog`, `RateDialog`, `NameAdder`, `WhoPicker`); this one
   * didn't. Cleared only on failure — a save that worked is navigating away,
   * and the press that lands during that must still find the button spent.
   */
  const [saving, setSaving] = useState(false);
  // Save is always tappable; a tap while invalid flips this instead of doing
  // nothing. It is what puts the blocker sentence on screen — an untouched
  // form shows no errors just for being empty. What is *missing* rather than
  // wrong says so by blooming its own control instead, and needs no flag: the
  // flash is the event.
  const [attemptedSave, setAttemptedSave] = useState(false);
  /**
   * The refusal flash, per field (`lib/refusal.ts`). A refusal blooms the
   * field that caused it red and lets it settle back — the amount's
   * underline, the title's box, the placeholder in either (see "save refusal"
   * in globals.css). Per field rather than once for the form, so a field that
   * wasn't the problem this time stays quiet.
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
   * What is missing as of the latest render, written once `checkEntry` has
   * run below. A refusal that travels first reads it when the scroll lands,
   * not when Save was pressed: a field fixed mid-scroll has nothing left to
   * bloom, and a flash on it would lock Save for nothing.
   */
  const missingNow = useRef<Partial<Record<Refusable, boolean>>>({});
  /**
   * Scrolling to what a refusal points at. Save is spent for the travel as
   * well as the flash, the who-had-what grid's rule: a second press mid-scroll
   * would start a second journey over the first.
   */
  const [seeking, setSeeking] = useState(false);
  /**
   * A flash whose field stopped being missing ends here, by hand. The flash
   * can leave with its element — the Items tab switched away, a currency put
   * back to the group's own takes "set rate" off the form — and an animation
   * removed mid-flight never fires `animationend`, so Save would stay spent
   * for good (design-system.md's Gotchas). Every render, after `missingNow`
   * has caught up with it.
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
   * A refusal is still on screen. Save is spent for exactly as long: a press
   * that can't go through has to look like it landed, and a button that stays
   * live while the form is busy saying no invites the same press again. Read
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
   * The rate dialog opens for whatever currency the draft is *in*, not for the
   * act of picking one — because a scan picks one too, and `/g/scan` fills a
   * draft on a screen that is already navigating here. A photographed Moroccan
   * receipt used to arrive looking complete and wrong: it wrote MAD and kept
   * whatever rate the draft had.
   *
   * The ref is what keeps it to one ask: dismissing the dialog leaves the
   * currency exactly as it was, and without it the effect would reopen what
   * was just closed. `pickCurrency` sets it for the same reason, and clears
   * its own claim, so picking the same currency again does ask again.
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
  // the link asked for. Coming back from the payers editor or the who-had-what
  // grid re-mounts the form with the same key, so the draft survives; arriving
  // from a different link doesn't, so a leftover draft is replaced rather than
  // handed over (settle up used to land on whatever blank expense was left
  // behind by an abandoned "+").
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
      // A name and an amount are things any caller may know — settle-up knows
      // both, the tip screen knows only the name. The two sides are the
      // transfer's alone, because no other kind has them.
      ...(prefill.title ? { description: prefill.title } : {}),
      // The suggestion is already in the group's base currency, so it seeds
      // the amount directly rather than going back through a rate.
      ...(Number.isFinite(prefill.amount) && prefill.amount > 0
        ? { amountText: minorToDecimalString(prefill.amount, base) } : {}),
      ...(kind === "transfer" ? {
        ...(prefill.from ? { fromMember: prefill.from } : {}),
        ...(prefill.to ? { toMember: prefill.to } : {}),
      } : {}),
    }, seedKey);
    // `prefill` is rebuilt each render; the query params behind it are what
    // actually change, and the draft is only ever seeded once per entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, entryId, seedKey, wantedKind, prefill.from, prefill.to, prefill.amount, prefill.title,
    data.loading, data.group, data.members, data.me, data.expenses, data.settlements]);

  // Nothing is stored, so a reload or a closed tab loses what's typed. Let the
  // browser say so, the same way it does for any other half-filled form.
  useEffect(() => {
    if (!groupId) return;
    const warn = (e: BeforeUnloadEvent) => { if (isDraftDirty(groupId)) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [groupId]);

  const title = entryId ? copy.form.editTitle : copy.form.newTitle;
  // No members means the draft can't be seeded — no payer to name — and this
  // screen used to sit as a titled blank forever, with nothing saying that
  // People is where the fix is. It is reachable: a group pulled from the
  // server before its members arrive, or opened by its own link on a phone
  // that hasn't claimed anybody.
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
  // An `e` naming nothing in either table is the same dead end one step on: the
  // seeding effect has nothing to seed from and gives up, leaving a titled
  // blank forever. A link to a deleted entry is the ordinary way here, so it
  // gets the sentence the entry screen already says for one.
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

  // Merges against the latest saved draft, not the `draft` this render closed
  // over — some interactions (switching split tabs) call patch() twice in one
  // handler, and merging against a stale closure would let the first patch's
  // change be clobbered by the second.
  const patch = (change: Partial<EntryDraft>) =>
    saveDraft(groupId, clipAmountToCurrency({ ...(getDraft(groupId) ?? draft), ...change }));

  /**
   * Change the entry's currency, and ask for its rate when the group has none.
   *
   * This is the "introducing a new currency" moment: picking MAD in a EUR
   * group used to leave the rate at "1", pass validation, and bank a 500 MAD
   * dinner as €500. Now the dialog opens on the spot with today's rate ready,
   * and Save is held until the group has a number either way.
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
   * A refusal, once what it points at can be seen — the grid's `reveal`, on
   * the form's own scroll. With the keyboard up the form is a strip of a few
   * rows, and Save at its foot is a long way from an empty amount at its head:
   * a flash spent up there was a press that did nothing. So unless one of the
   * refused controls is wholly in view, the nearest is scrolled to and only
   * then does it bloom, off a fresh reading of what is still missing.
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
   * Switching tabs. Two handoffs, each made once and only into a tab that has
   * nothing of its own yet: `openSplitTab` gives a first-time tab a split to
   * start from, and `handOffReceiptTotal` gives the amount field back the
   * total Receipt was deriving — without which the amount has nowhere to go
   * and the expense silently becomes worth zero (ADR-0016). A tab already
   * holding an answer keeps it, whatever the others now say.
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
   * Change which of the three this is, keeping everything the new kind can
   * still use. Leaving Receipt behind takes the same handoff as an ordinary
   * tab switch does — an income's amount would otherwise be derived from a
   * bill it no longer shows.
   */
  const changeKind = (next: EntryKind) => {
    if (next === kind) return;
    const leavingReceipt = onReceiptTab && next !== "expense";
    const handoff = leavingReceipt
      ? handOffReceiptTotal(activeTab, "equal", draft.receiptItems, receiptExtras(draft), draft.currency)
      : null;
    // "Reimbursement" is only ever typed in by settle up's prefill, never by
    // switching kind here. Leaving a transfer that still carries it hands the
    // next kind an empty field rather than a word about a transfer it no
    // longer is.
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
    if (!groupId) return true;
    if (isDraftDirty(groupId)) { setAsk("discard"); return false; }
    clearDraft(groupId);
    return true;
  }

  function discard() {
    if (!groupId) return;
    clearDraft(groupId);
    goBack(() => router.back());
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
          // Written only when it is true (`only`/`wholeEntity`): a typed entry
          // is the absence of this field, like every entry before it existed.
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
      clearDraft(groupId);
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
   * different shape, and turning one into the other is a delete and an add,
   * not an edit. A control that can't do anything doesn't get drawn.
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
          /* The kind sits up here, on the row that already names what this
             screen is. Below the title it was a lone chip floating over the
             amount; the space it vacated is the amount's. */
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
            {/* Rows of a grid, not centred lines: the typed amount, its
                converted figure and the scan's badge share a right edge, and
                the currency chip and the rate control share a left edge
                between them. The refusal flash runs on `.amountfield`, which
                `AmountInput` renders itself, so the grid listens for it on the
                way up rather than the component growing a prop for one
                screen's animation. */}
            <div className="amtgrid" data-refuse="amount" onAnimationEnd={settled("amount")}>
              <AmountInput
                className="amount"
                fieldClassName={`big${flashClass(refusedFields.amount)}`}
                aria-label={copy.form.amount(draft.currency)}
                enterKeyHint="done"
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

              {/* The rate is no longer a field on this form, and no longer a
                  figure on it either: what this line is for is what the entry
                  is worth in the group's currency. The number belongs to the
                  group, and both controls on this row open the registry's own
                  dialog to change it — where changing it also says how much
                  of the ledger moves. */}
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

              {/* Where the amount came from, when it did: the scan that typed
                  it. A row of this grid rather than a line under it, so it
                  ends on the amount's last digit — the grid's odd children are
                  the right-hand column, and this is one. */}
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
              <input id="what" value={draft.description}
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
                    // The same refusal, asked for by a door rather than by
                    // Save: the payers screen divides the amount between
                    // people, so opening it with no amount hands it a zero to
                    // split. The tap doesn't travel — it flashes the amount
                    // field, which is where the fix is.
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

          {/* One button, the width of the form, as its last row rather than a
              bar pinned to the bottom: pinned, it fought the phone keyboard,
              which overlays the shell instead of shortening it. Scrolling with
              the fields costs a swipe on a long form and nothing else — it
              stays pressable when the entry isn't ready, because `save`
              answers with the refusal flash on whichever field is missing,
              which is more use than a dead button saying nothing. */}
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
            ...[...new Set([base, draft.currency, ...COMMON_CURRENCIES])].map((c) => ({
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
