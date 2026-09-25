"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clipAmountToCurrency } from "./amount-input";
import { copy } from "../lib/copy";
import { keepsFocus } from "./bits";
import { Icon } from "./icons";
import { activeSplitTab, getDraft, saveDraft, tabAfterScan } from "../lib/draft";
import { normalizeScan, readBill, scanCurrency, type ScanMedium, type ScanResult } from "@bida/core";
import {
  parseBillText, scanReceipt,
  ScanKeyError, ScanLimitError, ScanOfflineError, ScanRejectedError, ScanUnavailableError,
  ScanUnreliableError, TurnstileBlockedError,
} from "../lib/scan";
import { beginScan, clearScan, failScan, useLiveScan, type LiveScan } from "../lib/scan/live";
import { unfoldAll } from "../lib/scan/items";
import { BillTextDialog } from "./bill-text-dialog";
import { ScanBusy } from "./scan-bar";
import type { ScanAs } from "../lib/quick";
import { warmTurnstile } from "../lib/scan/turnstile";

export type { ScanState } from "../lib/scan/live";

/**
 * Why the scan failed, in words. Only the model's own refusal is quoted —
 * everything else is the phone's condition or the app's own arithmetic, and
 * the app says those in its voice.
 */
function scanErrorText(err: unknown, medium: ScanMedium = "photo"): string | null {
  if (err instanceof ScanOfflineError) return copy.scan.offline;
  if (err instanceof TurnstileBlockedError) return copy.scan.unverified[err.side];
  // Before the budget refusals, and it can never be confused with one: a phone
  // on its own key never reaches a bucket of ours (lib/scan/key.ts).
  if (err instanceof ScanKeyError) return copy.scan.key[err.why];
  if (err instanceof ScanLimitError) {
    return err.scope === "global" ? copy.scan.limit.global : copy.scan.limit.you;
  }
  if (err instanceof ScanUnavailableError) return copy.scan.busy;
  if (err instanceof ScanRejectedError) return err.message;
  // The only refusal whose words depend on how the bill arrived: two of the
  // three ask for a different photo, which is no help to somebody typing.
  if (err instanceof ScanUnreliableError) return copy.scan.problem[medium][err.problem];
  return null;
}

export interface ReceiptScan {
  /** The scan in flight or last refused, straight off the store. Undefined while idle. */
  live: LiveScan | undefined;
  /**
   * The refusal **this screen** says under its control, or null. Not
   * `live.error`: a typed bill's refusal is said only in the box it was typed
   * into. Every screen reads this, so there is one answer to *whose refusal*.
   */
  refusal: string | null;
  /** Nothing can be sent without the group's secret, so the control asks this. */
  disabled: boolean;
  openCamera: () => void;
  openLibrary: () => void;
  /** Open the third door: the box a bill is typed or pasted into. */
  openTyping: () => void;
  /**
   * The apparatus the three doors need and nothing renders itself: the two
   * hidden file inputs the photo halves click, and the dialog the third opens.
   * **Render once per screen**, outside whatever the reading's own answer might
   * rearrange — see the note on the dialog below.
   */
  inputs: React.ReactNode;
}

/**
 * Photograph a bill; the draft comes back filled in. Shared by the Items tab
 * and `/g/scan` so they cannot drift: one downscale, one prompt, one set of
 * failure words, one rule about what a scan may overwrite.
 *
 * **A scan never navigates.** It fills the draft and stops: the grid is one
 * tap away on the Items tab (ADR-0016), and it lets the rate dialog simply
 * open when needed.
 *
 * `onScanned` is the one follow-up (`/g/scan` hands over to the form).
 * **Skipped when the scan outlived its screen**: the draft still takes the
 * result, but nothing yanks anybody back.
 *
 * **Nor does a scan take the tab back.** Its progress lives in the store
 * (`lib/scan/live.ts`), not this hook, so leaving the tab or the form isn't
 * mistaken for the scan ending — see `tabAtStart`.
 */
export function useReceiptScan(
  /** The draft this fills, and the screen the scan's state belongs to. */
  groupId: string | undefined,
  /**
   * What the scan is sent under, which is not always the group it is for: a
   * quick split has no group, and the demo has no key (`useScanAs`). Undefined
   * while it is still being read, which is what disables the camera.
   */
  scanAs: ScanAs | undefined,
  onScanned?: () => void,
): ReceiptScan {
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const live = useLiveScan(groupId);

  const onScreen = useRef(true);
  useEffect(() => () => { onScreen.current = false; }, []);

  // Read at the end of a round trip, so held in a ref: a caller rebuilding it
  // every render would otherwise run the version from the render that started.
  const scanned = useRef(onScanned);
  scanned.current = onScanned;
  // Read at the start of the round trip, and held for the same reason.
  const before = useRef(scanAs);
  before.current = scanAs;

  /**
   * One reading, photographed or typed. What it may overwrite, which tab it may
   * claim and what it resets are shared — **two copies would be two rules**.
   */
  const read = useCallback(async (
    medium: ScanMedium,
    send: (sender: ScanAs, currency: string) => Promise<ScanResult>,
    /** Kept on the draft when this reading was of typed text, so reopening the
        dialog holds what was typed rather than an empty box over a bill. */
    text: string | null,
  ) => {
    if (!groupId || !before.current) return;
    const current = getDraft(groupId);
    if (!current) return;
    // Which tab the scan was started from, so the arrival can tell "still
    // where I left it" from "moved on" — see the `splitTab` handoff below.
    const tabAtStart = activeSplitTab(current);
    beginScan(groupId, medium);
    try {
      const sender = before.current;
      await sender.prepare?.();
      const result = await send(sender, current.currency);
      // One currency for both readings below: what this bill is counted in,
      // which is also what a total worked out from the lines is written in.
      const currency = scanCurrency(result, current.currency);
      const patch = normalizeScan(result, currency, Date.now());
      // Read as a bill rather than off the raw result: a deduction printed as
      // a negative line belongs in the discount, not in the grid as something
      // to tick, and a line priced per unit is multiplied out (`readBill`).
      const bill = readBill(result, currency);
      // Both labels travel: a bill is shown in the language it was printed in,
      // and the translation is one tap away on the grid (`billLabel`).
      // A line of several arrives already split into portions (`unfoldAll`),
      // so folding it on the grid is a view and never an edit to the bill.
      const receiptItems = unfoldAll(bill.items.map((li) => (
        { label: li.label, labelEn: li.labelEn, amount: li.amount, quantity: li.quantity }
      )), currency).items;
      // Read fresh: the round trip is long enough to have been typed through,
      // and long enough to have been abandoned. A draft that is gone was
      // discarded on the way out of the form, and there is nothing to fill.
      const latest = getDraft(groupId);
      if (!latest) { clearScan(groupId); return; }
      // The scan's title is a guess, and a title somebody typed is not. Take it
      // only into an empty field or over the *previous* scan's guess, so a
      // rescan can correct itself without renaming the expense you named.
      const keepsTyped = latest.description.trim().length > 0
        && latest.description !== latest.scannedDescription;
      const scanTab = tabAfterScan(latest, tabAtStart, receiptItems.length > 0);
      saveDraft(groupId, clipAmountToCurrency({
        ...latest,
        ...(patch.description !== undefined && !keepsTyped
          ? { description: patch.description, scannedDescription: patch.description }
          : {}),
        ...(patch.amountText !== undefined ? { amountText: patch.amountText } : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.occurredAt !== undefined
          ? {
            occurredAt: patch.occurredAt,
            dateOnly: patch.dateOnly === true,
            // A receipt printed today is stamped with the moment it was read,
            // and that reading is what a later date change measures against. A
            // backdated one brought no clock, so the draft keeps the one it had.
            recordedAt: patch.dateOnly ? latest.recordedAt : patch.occurredAt,
          }
          : {}),
        receiptItems: receiptItems.length > 0 ? receiptItems : null,
        receiptTip: bill.extras.tip,
        receiptTax: bill.extras.tax,
        receiptDiscounts: bill.extras.discounts.length > 0 ? bill.extras.discounts : null,
        // A fresh reading replaces whatever grid was saved before.
        receiptInvolved: null,
        receiptAssignments: null,
        // And whatever the bill last arrived as. A photograph clears the text
        // for the same reason it clears the grid: what is kept has to describe
        // the bill that is actually on the draft.
        receiptText: text,
        // A bill with lines claims the Items tab, unless somebody has moved
        // off it while the model read (`tabAfterScan`).
        ...(scanTab !== undefined ? { splitTab: scanTab } : {}),
      }));
      clearScan(groupId);
      if (onScreen.current) scanned.current?.();
    } catch (err) {
      failScan(groupId, scanErrorText(err, medium));
    }
  }, [groupId]);

  const onPhoto = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await read(
      "photo",
      (sender, currency) => scanReceipt(file, sender.id, sender.secret, currency),
      null,
    );
  }, [read]);

  const readText = useCallback(async (text: string) => {
    await read(
      "text",
      (sender, currency) => parseBillText(text, sender.id, sender.secret, currency),
      text,
    );
  }, [read]);

  /**
   * Whether the typing box is open, held **here, never in the control that
   * opens it**: that control changes shape once a bill lands, which would
   * remount the box over the bill just read. This hook sits at the screen's
   * root, where no reading can move it.
   */
  const [typing, setTyping] = useState(false);

  /**
   * Whose refusal it is: the surface the reading started from says it, the
   * other says nothing. A typed bill is fixed in the box; a photograph belongs
   * to the screen that took it.
   */
  const said = live?.state === "error" ? live.error ?? copy.scan.failed : null;
  const typed = live?.medium === "text";

  return {
    live,
    refusal: typed ? null : said,
    disabled: !scanAs,
    openCamera: () => cameraInput.current?.click(),
    openLibrary: () => libraryInput.current?.click(),
    openTyping: () => setTyping(true),
    inputs: (
      <>
        <input ref={cameraInput} type="file" accept="image/*" capture="environment"
          style={{ display: "none" }} onChange={(e) => void onPhoto(e)}
          aria-label={copy.scan.camera} />
        <input ref={libraryInput} type="file" accept="image/*"
          style={{ display: "none" }} onChange={(e) => void onPhoto(e)}
          aria-label={copy.scan.library} />
        {typing ? (
          <BillTextDialog live={live} refusal={typed ? said : null} onRead={readText}
            // Read at open, not held: the box shows what the draft carries now,
            // which a photograph in between will have cleared.
            initial={(groupId ? getDraft(groupId)?.receiptText : null) ?? ""}
            onClose={() => setTyping(false)} />
        ) : null}
      </>
    ),
  };
}

/**
 * The control every scanning screen wears: one button cut in three —
 * photograph now, pick a photo, or type it — one act with three doors, so one
 * box (`.btn-pair`), never buttons side by side.
 *
 * **Cut in two where the tap that got here was the camera** (`typeIn={false}`):
 * the ledger's scan FAB asks for the photograph it drew. Typing stays where the
 * bill might already be words — the quick split, and the Items tab.
 *
 * In flight, the doors give way to one "Reading…" strip.
 *
 * Registers: `lg` where the screen exists for it, `s` on the Items tab, `xs`
 * for replacing an assigned bill. The first two are ink blocks; only the chip
 * is on paper.
 *
 * `flash` is the entry form's refusal on an Items tab with no bill. **The box
 * carries it, not a half.**
 */
export function ScanPair({
  scan, register, typeIn = true, flash = "", onFlashEnd, disabled: held = false, refuse,
}: {
  scan: ReceiptScan;
  register: "lg" | "s" | "xs";
  /** Whether the third door is offered at all — see the note above. */
  typeIn?: boolean;
  flash?: string;
  onFlashEnd?: (e: React.AnimationEvent) => void;
  /** Held shut by the screen as well: spent for the length of its own
      refusal flash, same as Save on the entry form. */
  disabled?: boolean;
  /**
   * The screen's own veto at the moment of pressing: a quick split with a name
   * still unfiled, or fewer than two people, refuses the photograph. Returns
   * true when it refused, and no door opens.
   */
  refuse?: () => boolean;
}) {
  const { live } = scan;
  const disabled = scan.disabled || held;
  const busy = live?.state === "scanning";
  // Run the challenge while the button sits there, so pressing doesn't wait on
  // Cloudflare (`warmTurnstile`). Every scanning screen wears this control, so
  // this covers them all. Keyed on `busy`: a scan spends the token.
  useEffect(() => { if (!disabled && !busy) warmTurnstile(); }, [disabled, busy]);
  // Three doors share the width, so the glyphs give back a couple of points and
  // the padding between them narrows. The box keeps its height.
  const icon = register === "xs" ? 12 : 14;
  const half = `btn${register === "lg" ? " btn-lg" : ""}`;
  // Inverted at both acting sizes; only the chip stays on paper, beside a bill
  // already assigned, where an ink block would outweigh what it replaces.
  const box = `btn-pair${register === "xs" ? " pair-xs" : " pair-p"}${flash}`;
  const open = (door: () => void) => () => { if (!refuse?.()) door(); };

  // One reading at a time, so one strip covers the photograph's two doors and
  // the typed bill's alike — there is nothing else to be doing while the model
  // reads, and a door left standing beside "Reading…" would invite a second.
  if (busy && live) {
    return <ScanBusy live={live} box={box} button={half} onFlashEnd={onFlashEnd} />;
  }

  return (
    <div className={box} onAnimationEnd={onFlashEnd}>
      <button type="button" className={half} disabled={disabled} onClick={open(scan.openCamera)}
        {...keepsFocus}>
        <Icon name="cam" size={icon} />
        {register === "xs" ? copy.scan.rescan : copy.scan.snap}
      </button>
      <button type="button" className={half} disabled={disabled} onClick={open(scan.openLibrary)}
        {...keepsFocus}>
        <Icon name="image" size={icon} />
        {copy.scan.upload}
      </button>
      {/* The third door: typing the bill. The pencil, because behind it is a
          field. */}
      {typeIn ? (
        <button type="button" className={half} disabled={disabled} onClick={open(scan.openTyping)}
          {...keepsFocus}>
          <Icon name="edit" size={icon} />
          {register === "xs" ? copy.scan.typeIn.openLong : copy.scan.typeIn.open}
        </button>
      ) : null}
    </div>
  );
}
