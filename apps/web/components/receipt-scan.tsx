"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clipAmountToCurrency } from "./amount-input";
import { copy } from "../lib/copy";
import { Icon } from "./icons";
import { getDraft, saveDraft } from "../lib/draft";
import { readBill, scanCurrency } from "@bida/core";
import {
  normalizeScan, scanReceipt,
  ScanOfflineError, ScanRejectedError, ScanUnavailableError, ScanUnreliableError,
} from "../lib/scan";

/** Where a scan is: idle, in flight, or refused. */
export type ScanState = "idle" | "scanning" | "error";

/**
 * Why the scan failed, in words. Only the model's own refusal is quoted —
 * everything else is the phone's condition or the app's own arithmetic, and
 * the app says those in its voice.
 */
export function scanErrorText(err: unknown): string | null {
  if (err instanceof ScanOfflineError) return copy.scan.offline;
  if (err instanceof ScanUnavailableError) return copy.scan.busy;
  if (err instanceof ScanRejectedError) return err.message;
  if (err instanceof ScanUnreliableError) return copy.scan.problem[err.problem];
  return null;
}

export interface ReceiptScan {
  state: ScanState;
  /** Why the last scan failed, already worded for a person. Null falls back to the generic message. */
  error: string | null;
  /** Nothing can be sent without the group's secret, so the control asks this. */
  disabled: boolean;
  openCamera: () => void;
  openLibrary: () => void;
  /** The two hidden file inputs the halves above click. Render once per screen. */
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
 */
export function useReceiptScan(
  groupId: string | undefined,
  secret: string | undefined,
  onScanned?: () => void,
): ReceiptScan {
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ScanState>("idle");
  const [error, setError] = useState<string | null>(null);

  const onScreen = useRef(true);
  useEffect(() => () => { onScreen.current = false; }, []);

  // The callback is read at the end of a round trip, so it is held in a ref
  // rather than closed over: a caller that rebuilds it every render would
  // otherwise have `onPhoto` running the version from whichever render
  // started the scan.
  const scanned = useRef(onScanned);
  scanned.current = onScanned;

  const onPhoto = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !groupId || !secret) return;
    const current = getDraft(groupId);
    if (!current) return;
    setState("scanning");
    setError(null);
    try {
      const result = await scanReceipt(file, groupId, secret, current.currency);
      const patch = normalizeScan(result);
      // Read as a bill rather than off the raw result: a deduction printed as
      // a negative line belongs in the discount, not in the grid as something
      // to tick (`readBill`).
      const bill = readBill(result, scanCurrency(result, current.currency));
      const receiptItems = bill.items.map((li) => (
        { label: li.labelEn ?? li.label, amount: li.amount, quantity: li.quantity }
      ));
      // The scan's title is a guess, and a title somebody typed is not. Take it
      // only into an empty field or over the *previous* scan's guess, so a
      // rescan can correct itself without renaming the expense you named.
      // Read fresh: the round trip is long enough to have been typed through.
      const latest = getDraft(groupId) ?? current;
      const keepsTyped = latest.description.trim().length > 0
        && latest.description !== latest.scannedDescription;
      saveDraft(groupId, clipAmountToCurrency({
        ...latest,
        ...(patch.description !== undefined && !keepsTyped
          ? { description: patch.description, scannedDescription: patch.description }
          : {}),
        ...(patch.amountText !== undefined ? { amountText: patch.amountText } : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.occurredAt !== undefined ? { occurredAt: patch.occurredAt } : {}),
        receiptItems: receiptItems.length > 0 ? receiptItems : null,
        receiptTip: bill.extras.tip,
        receiptTax: bill.extras.tax,
        receiptDiscounts: bill.extras.discounts.length > 0 ? bill.extras.discounts : null,
        // A fresh scan replaces whatever grid was saved before.
        receiptInvolved: null,
        receiptAssignments: null,
        // Only a bill with lines on it is something to assign, so only that
        // claims the Items tab. A receipt that is just a total is an
        // ordinary expense — the grid never opens on it — and showing the tab
        // for one put "Scan a receipt" over a form a scan had just filled in.
        ...(receiptItems.length > 0 ? { splitTab: "receipt" as const } : {}),
      }));
      setState("idle");
      if (onScreen.current) scanned.current?.();
    } catch (err) {
      setState("error");
      setError(scanErrorText(err));
    }
  }, [groupId, secret]);

  return {
    state,
    error,
    disabled: !secret,
    openCamera: () => cameraInput.current?.click(),
    openLibrary: () => libraryInput.current?.click(),
    inputs: (
      <>
        <input ref={cameraInput} type="file" accept="image/*" capture="environment"
          style={{ display: "none" }} onChange={(e) => void onPhoto(e)}
          aria-label={copy.scan.camera} />
        <input ref={libraryInput} type="file" accept="image/*"
          style={{ display: "none" }} onChange={(e) => void onPhoto(e)}
          aria-label={copy.scan.library} />
      </>
    ),
  };
}

/**
 * The wash sweeping across the control while the model reads.
 *
 * A scan is about two seconds of network and model — long enough that a
 * spinner alone says only "no idea" — so the control fills at the pace a scan
 * usually takes, and `onFull` hands over to the spinner if this one is slower.
 * The bar promises the *usual* scan and not this one, which is why it is
 * `aria-hidden`: what a screen reader is owed is the "Reading…" beside it.
 *
 * Two details it cannot do without. The duration is inline because it is a
 * different number every sweep and the class holds only the shape. And the
 * animation's end is the one event the box must not hear — `.btn-pair`
 * listens on the way up for the refusal flash (`onFlashEnd`), and an
 * unstopped `animationend` reads there as a flash that has settled.
 */
function ScanBar({ onFull }: { onFull: () => void }) {
  const [seconds] = useState(barSeconds);
  return (
    <span className="scanbar" aria-hidden="true"
      style={{ animationDuration: `${seconds}s` }}
      onAnimationEnd={(e) => { e.stopPropagation(); onFull(); }} />
  );
}

/**
 * How long one sweep lasts. Two seconds, jittered: drawn once per sweep so a
 * second scan doesn't repeat the first to the frame, which is what makes a bar
 * read as a canned animation rather than an estimate.
 */
function barSeconds(): number {
  return 1.8 + Math.random() * 0.4;
}

/**
 * The control both scanning screens wear: one button cut in two.
 *
 * Photographing the bill and picking a photo of it are the same act with two
 * doors, and this says so — one bordered box, one hairline down the middle
 * (`.btn-pair`). It replaced two buttons standing side by side, which is the
 * shape for two *different* jobs and read as one: equal weight on the form,
 * primary-above-secondary on `/g/scan`, and two different words for the
 * camera on the two screens.
 *
 * While a scan is in flight the halves are gone and the box holds one strip
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
  state, disabled, onCamera, onLibrary, register, flash = "", onFlashEnd,
}: {
  state: ScanState;
  disabled: boolean;
  onCamera: () => void;
  onLibrary: () => void;
  register: "lg" | "s" | "xs";
  flash?: string;
  onFlashEnd?: (e: React.AnimationEvent) => void;
}) {
  const busy = state === "scanning";
  /**
   * The sweep has run out and the scan is still going, so the spinner takes
   * over. Reset the moment the scan ends — the next one is a fresh two
   * seconds, and an answer that beat the sweep never shows a spinner at all.
   */
  const [full, setFull] = useState(false);
  useEffect(() => { if (!busy) setFull(false); }, [busy]);
  const icon = register === "xs" ? 13 : register === "lg" ? 17 : 16;
  const half = `btn${register === "lg" ? " btn-lg" : ""}`;
  // Inverted at both sizes that act: on `/g/scan` it is the screen's one act,
  // and on the Items tab it is the only thing to do on an empty tab. Only
  // the chip register stays on paper — it stands beside a bill already
  // assigned, where an ink block would outweigh the thing it replaces.
  const box = `btn-pair${register === "xs" ? " pair-xs" : " pair-p"}${flash}`;

  // One element, so the box keeps the height it had and nothing under it moves
  // while the model reads. Disabled through the same `.btn:disabled` every
  // other spent button in the app uses.
  if (busy) {
    return (
      <div className={`${box} pair-busy`} onAnimationEnd={onFlashEnd}>
        {full ? null : <ScanBar onFull={() => setFull(true)} />}
        <button type="button" className={half} disabled aria-live="polite">
          {full ? <span className="spinner" aria-hidden="true" /> : null}
          {copy.scan.reading}
        </button>
      </div>
    );
  }

  return (
    <div className={box} onAnimationEnd={onFlashEnd}>
      <button type="button" className={half} disabled={disabled} onClick={onCamera}>
        <Icon name="cam" size={icon} />
        {register === "xs" ? copy.scan.rescan : copy.scan.snap}
      </button>
      <button type="button" className={half} disabled={disabled} onClick={onLibrary}>
        <Icon name="image" size={icon} />
        {copy.scan.upload}
      </button>
    </div>
  );
}
