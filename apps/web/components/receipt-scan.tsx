"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clipAmountToCurrency } from "./amount-input";
import { copy } from "../lib/copy";
import { Icon } from "./icons";
import { getDraft, saveDraft } from "../lib/draft";
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
 * Two screens scan: the expense form's Receipt tab, and `/g/scan`, which is
 * the same act reached before there is a form. They share this so the two
 * cannot drift — one downscale, one prompt, one set of words for a failure,
 * and one rule about what a scan is allowed to overwrite.
 *
 * **A scan never navigates.** It fills the draft and stops there. It used to
 * push straight to the who-had-what grid whenever the bill had lines, which
 * made every scan a commitment to itemise; the grid is one tap away on the
 * Receipt tab, and reaching it is the person's decision (ADR-0016). Nothing
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
      const receiptItems = result.lineItems.map((li) => (
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
        receiptTip: result.tip,
        // A fresh scan replaces whatever grid was saved before.
        receiptInvolved: null,
        receiptAssignments: null,
        // Only a bill with lines on it is something to assign, so only that
        // claims the Receipt tab. A receipt that is just a total is an
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
 * nothing else: `lg` where the screen exists for it, `s` on the Receipt tab,
 * `xs` for replacing a bill already assigned.
 *
 * `flash` is the entry form's refusal: a Save tapped on a Receipt tab with no
 * bill behind it blooms this box red and lets it settle, which is what the
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
  const icon = register === "xs" ? 13 : register === "lg" ? 17 : 16;
  const half = `btn${register === "lg" ? " btn-lg" : ""}`;
  const box = `btn-pair${register === "lg" ? " pair-p" : ""}${register === "xs" ? " pair-xs" : ""}${flash}`;

  // One element, so the box keeps the height it had and nothing under it moves
  // while the model reads. Disabled through the same `.btn:disabled` every
  // other spent button in the app uses.
  if (busy) {
    return (
      <div className={box} onAnimationEnd={onFlashEnd}>
        <button type="button" className={half} disabled aria-live="polite">
          <span className="spinner" aria-hidden="true" />
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
