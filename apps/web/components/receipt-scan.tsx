"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clipAmountToCurrency } from "./amount-input";
import { copy } from "../lib/copy";
import { keepsFocus } from "./bits";
import { Icon } from "./icons";
import { activeSplitTab, getDraft, saveDraft, tabAfterScan } from "../lib/draft";
import { readBill, scanCurrency, type ScanMedium, type ScanResult } from "@bida/core";
import {
  normalizeScan, parseBillText, scanReceipt,
  ScanKeyError, ScanLimitError, ScanOfflineError, ScanRejectedError, ScanUnavailableError,
  ScanUnreliableError, TurnstileBlockedError,
} from "../lib/scan";
import { beginScan, clearScan, failScan, useLiveScan, type LiveScan } from "../lib/scan/live";
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
 * Photograph a bill; the draft comes back filled in.
 *
 * Two screens scan: the expense form's Items tab, and `/g/scan`, which is
 * the same act reached before there is a form. They share this so the two
 * cannot drift — one downscale, one prompt, one set of words for a failure,
 * and one rule about what a scan is allowed to overwrite.
 *
 * **A scan never navigates.** It fills the draft and stops there. It used to
 * push straight to the who-had-what grid whenever the bill had lines, which
 * made every scan a commitment to itemise; the grid is one tap away on the
 * Items tab, and reaching it is the person's decision (ADR-0016). Nothing
 * else wants the screen after a scan either, which is what lets the rate
 * dialog simply open when it is needed.
 *
 * `onScanned` is the one thing a caller may do afterwards — `/g/scan` uses it
 * to hand over to the form. It is skipped when the scan outlived the screen
 * that started it: a scan is a network round trip to a model and people put
 * the phone down, so the draft still takes the result, but nothing yanks
 * anybody back.
 *
 * **Nor does a scan take the tab back.** Where it is *up to* lives in the
 * store beside the draft (`lib/scan/live.ts`), not in this hook's state, so
 * that neither leaving the Items tab nor leaving the form for the payers
 * editor is mistaken for the scan ending; and what it does on the way back is
 * decided the same way — see `tabAtStart` below.
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

  // The callback is read at the end of a round trip, so it is held in a ref
  // rather than closed over: a caller that rebuilds it every render would
  // otherwise have `onPhoto` running the version from whichever render
  // started the scan.
  const scanned = useRef(onScanned);
  scanned.current = onScanned;
  // Read at the start of the round trip, and held for the same reason.
  const before = useRef(scanAs);
  before.current = scanAs;

  /**
   * One reading, whichever medium it arrived in.
   *
   * Everything below the `send` argument is the same for a photograph and for a
   * bill somebody typed: what a scan may overwrite, which tab it may claim,
   * and what it resets. Two copies of this were two rules about renaming an
   * expense somebody had named.
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
      const receiptItems = bill.items.map((li) => (
        { label: li.labelEn ?? li.label, amount: li.amount, quantity: li.quantity }
      ));
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
   * Whether the typing box is open, held **here** rather than in the control
   * that opens it.
   *
   * The control comes and goes under it: the Items tab draws one shape when
   * there is no bill and another when there is, and a typed bill's own answer is
   * what moves it from the first to the second. With the box's state in the
   * control, it changed position in the tree the moment its own reading landed
   * — React unmounted it and mounted a fresh one, which reopened holding what
   * had just been read, over a bill that had just arrived. The hook sits at the
   * screen's root, where nothing a reading does can move it.
   */
  const [typing, setTyping] = useState(false);

  return {
    live,
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
          <BillTextDialog live={live} onRead={readText}
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
 * The control every scanning screen wears: one button cut in three.
 *
 * Getting this bill into the form is one act, and the doors are the ways in —
 * photograph it now, pick the photograph you already took, or type it. So it is
 * one bordered box with hairlines between them (`.btn-pair`), not buttons
 * standing side by side, which is the vocabulary for separate jobs and is how
 * the pair read before: equal weight on the form, primary-above-secondary on
 * `/g/scan`, and two different words for the camera on the two screens.
 *
 * It was two doors until typing arrived, and the third joined them in the box
 * rather than beside it (2026-09-19, owner's call): a reading is a reading
 * whichever medium it starts from, and a door standing outside the box would
 * have said typing was a different act — which is exactly what it is not, since
 * everything after the bytes is shared (`useReceiptScan`).
 *
 * While a reading is in flight the doors are gone and the box holds one strip
 * saying "Reading…", because there was only ever one act in it — which is
 * also what retired `ScanSource`, a type whose whole job was knowing which of
 * two buttons should spin.
 *
 * Three registers of the same control, so where it sits changes its size and
 * almost nothing else: `lg` where the screen exists for it, `s` on the Items
 * tab, `xs` for replacing a bill already assigned. The first two are ink
 * blocks, because each is the one act of the surface it sits on; only the chip
 * is on paper.
 *
 * `flash` is the entry form's refusal: a Save tapped on an Items tab with no
 * bill behind it fills this box red and lets it settle, which is what the
 * amount and the title have always done. The box carries it, not a half —
 * neither half is the one that was wrong.
 */
export function ScanPair({
  scan, register, flash = "", onFlashEnd, disabled: held = false, refuse,
}: {
  scan: ReceiptScan;
  register: "lg" | "s" | "xs";
  flash?: string;
  onFlashEnd?: (e: React.AnimationEvent) => void;
  /** Held shut by the screen as well: spent for the length of its own
      refusal flash, same as Save on the entry form. */
  disabled?: boolean;
  /**
   * The screen's own veto on the press, for what it can only know at the
   * moment of pressing: a quick split with a name still unfiled in the add
   * row, or fewer than two people on the list, refuses the photograph rather
   * than taking one nobody can actually divide. Returns true when it
   * refused, and neither door opens.
   */
  refuse?: () => boolean;
}) {
  const { live } = scan;
  const disabled = scan.disabled || held;
  const busy = live?.state === "scanning";
  // Run the challenge while the button is merely sitting there, so pressing it
  // doesn't wait for a round trip to Cloudflare (`warmTurnstile`). Every screen
  // that scans wears this control, so warming here is what "wherever a scan
  // button appears" actually means — including the Items tab, which mounts one
  // the moment that tab is picked. Keyed on `busy` as well as mount: a scan
  // spends the token, and the button coming back is the next scan's cue.
  useEffect(() => { if (!disabled && !busy) warmTurnstile(); }, [disabled, busy]);
  // Three doors share the width now, so the glyphs give back a couple of points
  // and the padding between them narrows. The box keeps the height it had.
  const icon = register === "xs" ? 12 : 14;
  const half = `btn${register === "lg" ? " btn-lg" : ""}`;
  // Inverted at both sizes that act: on `/g/scan` it is the screen's one act,
  // and on the Items tab it is the only thing to do on an empty tab. Only
  // the chip register stays on paper — it stands beside a bill already
  // assigned, where an ink block would outweigh the thing it replaces.
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
      {/* The third door, and the reason this is no longer a pair: the box is the
          act, and typing the bill is a way into it rather than a thing beside
          it. The pencil, because what is behind this one is a field. */}
      <button type="button" className={half} disabled={disabled} onClick={open(scan.openTyping)}
        {...keepsFocus}>
        <Icon name="edit" size={icon} />
        {register === "xs" ? copy.scan.typeIn.openLong : copy.scan.typeIn.open}
      </button>
    </div>
  );
}
