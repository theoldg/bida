"use client";
// Doc: docs/receipt-scanning.md

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { clipAmountToCurrency } from "./amount-input";
import { copy } from "../lib/copy";
import { Icon, type IconName } from "./icons";
import { getDraft, saveDraft, tabAfterScan } from "../lib/draft";
import {
  normalizeScan, readBill, scanCurrency, type ScanResult,
} from "@bida/core";
import {
  scanReceipt,
  ScanKeyError, ScanLimitError, ScanOfflineError, ScanRejectedError, ScanUnavailableError,
  ScanUnreliableError, TurnstileBlockedError,
} from "../lib/scan";
import { beginScan, clearScan, failScan, useLiveScan, type LiveScan } from "../lib/scan/live";
import { unfoldAll } from "../lib/scan/items";
import { ScanBusy } from "./scan-bar";
import type { ScanAs } from "../lib/scan/credential";
import { warmTurnstile } from "../lib/scan/turnstile";
import { warmBillFinder } from "../lib/scan/find-bill";

export type { ScanState } from "../lib/scan/live";

/** Only the model's own refusal is quoted; the rest the app says in its own voice. */
function scanErrorText(err: unknown): string | null {
  if (err instanceof ScanOfflineError) return copy.scan.offline;
  if (err instanceof TurnstileBlockedError) return copy.scan.unverified[err.side];
  // A phone on its own key never reaches a budget of ours.
  if (err instanceof ScanKeyError) return copy.scan.key[err.why];
  if (err instanceof ScanLimitError) {
    return err.scope === "global" ? copy.scan.limit.global : copy.scan.limit.you;
  }
  if (err instanceof ScanUnavailableError) return copy.scan.busy;
  if (err instanceof ScanRejectedError) return err.message;
  if (err instanceof ScanUnreliableError) return copy.scan.problem[err.problem];
  return null;
}

export interface ReceiptScan {
  /** Undefined while idle. */
  live: LiveScan | undefined;
  /** What this screen says under its control. */
  refusal: string | null;
  disabled: boolean;
  openCamera: () => void;
  openLibrary: () => void;
  openTyping: () => void;
  /** The hidden file inputs. Render once per screen, outside anything a reading rearranges. */
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
  /** The bill typed by hand, a screen of its own; none hides that door. */
  billHref?: string,
): ReceiptScan {
  const router = useRouter();
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

  const read = useCallback(async (
    send: (sender: ScanAs, currency: string) => Promise<ScanResult>,
  ) => {
    if (!groupId || !latestScanAs.current) return;
    const current = getDraft(groupId);
    if (!current) return;
    const tabAtStart = current.splitTab;
    beginScan(groupId);
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
        // Whatever was kept must describe the bill now on the draft.
        receiptInvolved: null,
        receiptAssignments: null,
        ...(scanTab !== undefined ? { splitTab: scanTab } : {}),
      }));
      clearScan(groupId);
      if (onScreen.current) latestOnScanned.current?.();
    } catch (err) {
      failScan(groupId, scanErrorText(err));
    }
  }, [groupId]);

  const onPhoto = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await read((sender, currency) => scanReceipt(file, sender.id, sender.secret, currency));
  }, [read]);

  const said = live?.state === "error" ? live.error ?? copy.scan.failed : null;

  return {
    live,
    refusal: said,
    disabled: !scanAs,
    // The crop model downloads while the camera is up, not after the shutter.
    openCamera: () => { void warmBillFinder(); cameraInput.current?.click(); },
    openLibrary: () => { void warmBillFinder(); libraryInput.current?.click(); },
    openTyping: () => { if (billHref) router.push(billHref); },
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
 * One act with three doors (camera, library, the items by hand), so one box,
 * never buttons side by side. `typeIn={false}` where the tap that got here was
 * the camera. `lg` where the screen exists for scanning, inked; `s` on the
 * Items tab, grey, since the entry form's one ink is Save. `overBill` where a
 * read bill is held and a button above or below it is the way on: the doors
 * replace it, so they shrink to fit their words, under "Change bill".
 */
export function ScanPair({
  scan, register, overBill = false, typeIn = true, flash = "", onFlashEnd,
}: {
  scan: ReceiptScan;
  register: "lg" | "s";
  overBill?: boolean;
  typeIn?: boolean;
  flash?: string;
  onFlashEnd?: (e: React.AnimationEvent) => void;
}) {
  const { live, disabled } = scan;
  const busy = live?.state === "scanning";
  // So pressing doesn't wait on Cloudflare. Keyed on `busy`: a scan spends the token.
  useEffect(() => { if (!disabled && !busy) warmTurnstile(); }, [disabled, busy]);
  const half = `btn${register === "lg" ? " btn-lg" : ""}`;
  const box = `btn-pair${overBill ? " pair-sm" : register === "lg" ? " pair-p" : ""}${flash}`;
  const titled = (doors: React.ReactNode) => {
    if (!overBill) return doors;
    return <div className="billdoors"><span>{copy.scan.changeBill}</span>{doors}</div>;
  };

  // A door left beside "Reading…" would invite a second reading.
  if (busy && live) {
    return titled(<ScanBusy live={live} box={box} button={half} onFlashEnd={onFlashEnd} />);
  }

  const door = (icon: IconName, label: string, onClick: () => void) => (
    <button type="button" className={half} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={14} />
      {label}
    </button>
  );

  return titled(
    <div className={box} onAnimationEnd={onFlashEnd}>
      {door("cam", copy.scan.snap, scan.openCamera)}
      {door("image", copy.scan.upload, scan.openLibrary)}
      {typeIn ? door("edit", overBill ? copy.scan.byHand.edit : copy.scan.byHand.open, scan.openTyping) : null}
    </div>
  );
}
