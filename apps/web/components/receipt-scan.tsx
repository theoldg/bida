"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clipAmountToCurrency } from "./amount-input";
import { copy } from "../lib/copy";
import { Icon } from "./icons";
import { getDraft, saveDraft, tabAfterScan } from "../lib/draft";
import { normalizeScan, readBill, scanCurrency, type ScanMedium, type ScanResult } from "@bida/core";
import {
  parseBillText, scanReceipt,
  ScanKeyError, ScanLimitError, ScanOfflineError, ScanRejectedError, ScanUnavailableError,
  ScanUnreliableError, TurnstileBlockedError,
} from "../lib/scan";
import { beginScan, clearScan, failScan, useLiveScan, type LiveScan } from "../lib/scan/live";
import { unfoldAll } from "../lib/scan/items";
import { billAsText } from "../lib/scan/text";
import { BillTextDialog } from "./bill-text-dialog";
import { ScanBusy } from "./scan-bar";
import type { ScanAs } from "../lib/scan/credential";
import { warmTurnstile } from "../lib/scan/turnstile";
import { warmBillFinder } from "../lib/scan/find-bill";

export type { ScanState } from "../lib/scan/live";

/** Only the model's own refusal is quoted; the rest the app says in its own voice. */
function scanErrorText(err: unknown, medium: ScanMedium = "photo"): string | null {
  if (err instanceof ScanOfflineError) return copy.scan.offline;
  if (err instanceof TurnstileBlockedError) return copy.scan.unverified[err.side];
  // A phone on its own key never reaches a budget of ours.
  if (err instanceof ScanKeyError) return copy.scan.key[err.why];
  if (err instanceof ScanLimitError) {
    return err.scope === "global" ? copy.scan.limit.global : copy.scan.limit.you;
  }
  if (err instanceof ScanUnavailableError) return copy.scan.busy;
  if (err instanceof ScanRejectedError) return err.message;
  // Two of three ask for a different photo, no help to somebody typing.
  if (err instanceof ScanUnreliableError) return copy.scan.problem[medium][err.problem];
  return null;
}

export interface ReceiptScan {
  /** Undefined while idle. */
  live: LiveScan | undefined;
  /** What this screen says under its control. Not `live.error`: a typed bill's refusal stays in its box. */
  refusal: string | null;
  disabled: boolean;
  openCamera: () => void;
  openLibrary: () => void;
  openTyping: () => void;
  /** The hidden file inputs and the typing dialog. Render once per screen, outside anything a reading rearranges. */
  inputs: React.ReactNode;
}

/**
 * Read a bill into the draft. Shared by every scanning screen so there is one
 * rule about what a scan may overwrite. A scan never navigates: it fills the
 * draft and stops. `onScanned` is skipped when the scan outlived its screen, so
 * nothing yanks anybody back. Progress lives in `lib/scan/live.ts`, so leaving
 * the screen isn't mistaken for the scan ending.
 */
export function useReceiptScan(
  groupId: string | undefined,
  /** Not always the group's own key: a quick split has none (`useScanAs`). Undefined disables the camera. */
  scanAs: ScanAs | undefined,
  onScanned?: () => void,
): ReceiptScan {
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const live = useLiveScan(groupId);

  const onScreen = useRef(true);
  useEffect(() => () => { onScreen.current = false; }, []);

  // Refs, so a round trip reads this render's values rather than the starting render's.
  const latestOnScanned = useRef(onScanned);
  latestOnScanned.current = onScanned;
  const latestScanAs = useRef(scanAs);
  latestScanAs.current = scanAs;

  /** A photograph and a typed bill share it: two copies would be two rules. */
  const read = useCallback(async (
    medium: ScanMedium,
    send: (sender: ScanAs, currency: string) => Promise<ScanResult>,
    typedText: string | null,
  ) => {
    if (!groupId || !latestScanAs.current) return;
    const current = getDraft(groupId);
    if (!current) return;
    const tabAtStart = current.splitTab;
    beginScan(groupId, medium);
    try {
      const sender = latestScanAs.current;
      await sender.prepare?.();
      const result = await send(sender, current.currency);
      const currency = scanCurrency(result, current.currency);
      const patch = normalizeScan(result, currency, Date.now());
      // Not the raw result: a negative line is a discount, not something to tick.
      const bill = readBill(result, currency);
      // Pre-split into portions, so folding on the grid is a view, never an edit.
      const receiptItems = unfoldAll(bill.items.map((li) => (
        { label: li.label, labelEn: li.labelEn, amount: li.amount, quantity: li.quantity }
      )), currency).items;
      // Fresh: the round trip is long enough to have been typed through, or abandoned.
      const latest = getDraft(groupId);
      if (!latest) { clearScan(groupId); return; }
      // Only over an empty title or the previous scan's guess, never one somebody typed.
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
        // A scan always looks the rate up again, for whatever currency and day
        // it settled on — even over a typed one (`rateLookupWanted`).
        rateDay: undefined,
        ...(patch.occurredAt !== undefined
          ? {
            occurredAt: patch.occurredAt,
            dateOnly: patch.dateOnly === true,
            // A date-only receipt brought no clock, so the draft keeps the one it had.
            recordedAt: patch.dateOnly ? latest.recordedAt : patch.occurredAt,
          }
          : {}),
        receiptItems: receiptItems.length > 0 ? receiptItems : null,
        receiptTip: bill.extras.tip,
        receiptTax: bill.extras.tax,
        receiptDiscounts: bill.extras.discounts.length > 0 ? bill.extras.discounts : null,
        // Whatever was kept must describe the bill now on the draft. A
        // photograph's reading becomes the text, so a misread line is typed
        // over rather than retaken.
        receiptInvolved: null,
        receiptAssignments: null,
        receiptText: typedText ?? (billAsText(bill, result.total) || null),
        ...(scanTab !== undefined ? { splitTab: scanTab } : {}),
      }));
      clearScan(groupId);
      if (onScreen.current) latestOnScanned.current?.();
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

  // Here, not in the control that opens it: that control changes shape once a
  // bill lands, which would remount the box over the bill just read.
  const [typing, setTyping] = useState(false);

  const said = live?.state === "error" ? live.error ?? copy.scan.failed : null;
  const typed = live?.medium === "text";

  return {
    live,
    refusal: typed ? null : said,
    disabled: !scanAs,
    // The crop model downloads while the camera is up, not after the shutter.
    openCamera: () => { void warmBillFinder(); cameraInput.current?.click(); },
    openLibrary: () => { void warmBillFinder(); libraryInput.current?.click(); },
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
            // Read at open: a photograph in between replaces it.
            initial={(groupId ? getDraft(groupId)?.receiptText : null) ?? ""}
            onClose={() => setTyping(false)} />
        ) : null}
      </>
    ),
  };
}

/**
 * One act with three doors (camera, library, type it), so one box, never
 * buttons side by side. `typeIn={false}` where the tap that got here was the
 * camera. `lg` where the screen exists for scanning, `s` on the Items tab, `xs`
 * beside an assigned bill, where an ink block would outweigh what it replaces.
 */
export function ScanPair({
  scan, register, typeIn = true, flash = "", onFlashEnd, disabled: held = false, refuse,
}: {
  scan: ReceiptScan;
  register: "lg" | "s" | "xs";
  typeIn?: boolean;
  flash?: string;
  onFlashEnd?: (e: React.AnimationEvent) => void;
  /** Spent for the length of the screen's own refusal flash, as Save is. */
  disabled?: boolean;
  /** The screen's veto at the press; true keeps every door shut. */
  refuse?: () => boolean;
}) {
  const { live } = scan;
  const disabled = scan.disabled || held;
  const busy = live?.state === "scanning";
  // So pressing doesn't wait on Cloudflare. Keyed on `busy`: a scan spends the token.
  useEffect(() => { if (!disabled && !busy) warmTurnstile(); }, [disabled, busy]);
  const icon = register === "xs" ? 12 : 14;
  const half = `btn${register === "lg" ? " btn-lg" : ""}`;
  const box = `btn-pair${register === "xs" ? " pair-xs" : " pair-p"}${flash}`;
  const open = (door: () => void) => () => { if (!refuse?.()) door(); };

  // A door left beside "Reading…" would invite a second reading.
  if (busy && live) {
    return <ScanBusy live={live} box={box} button={half} onFlashEnd={onFlashEnd} />;
  }

  return (
    <div className={box} onAnimationEnd={onFlashEnd}>
      <button type="button" className={half} disabled={disabled} onClick={open(scan.openCamera)}>
        <Icon name="cam" size={icon} />
        {register === "xs" ? copy.scan.rescan : copy.scan.snap}
      </button>
      <button type="button" className={half} disabled={disabled} onClick={open(scan.openLibrary)}>
        <Icon name="image" size={icon} />
        {copy.scan.upload}
      </button>
      {typeIn ? (
        <button type="button" className={half} disabled={disabled} onClick={open(scan.openTyping)}>
          <Icon name="edit" size={icon} />
          {register === "xs" ? copy.scan.typeIn.asText : copy.scan.typeIn.open}
        </button>
      ) : null}
    </div>
  );
}
