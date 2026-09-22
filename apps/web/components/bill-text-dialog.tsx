"use client";

import { useEffect, useRef, useState } from "react";
import { BILL_TEXT_MAX } from "@bida/core";
import { Dialog } from "./dialog";
import { Failure } from "./chrome";
import { keepsFocus } from "./bits";
import { ScanBusy } from "./scan-bar";
import { copy } from "../lib/copy";
import { billTextLeft, cleanBillText } from "../lib/scan/text";
import type { LiveScan } from "../lib/scan/live";

/**
 * Type the bill in — the scan control's third door, for a receipt with no
 * usable photo or one that arrived as text
 * (docs/receipt-scanning.md#typing-a-bill-in). It goes through the same
 * reading as a photo and returns the same filled draft, so this is only the
 * box and the cap.
 *
 * **State comes from the reading, not the dialog**: `live` is the screen's own
 * `LiveScan`, so closing mid-read still fills the draft and reopening shows the
 * bar where the reading is. A refusal keeps the dialog up with the text, since
 * a bad typed bill is fixed where it was typed.
 *
 * **Rendered by `useReceiptScan`, never by a screen** — a dialog whose answer
 * moves the panel around it gets unmounted mid-sentence.
 */
export function BillTextDialog({ live, refusal, initial = "", onRead, onClose }: {
  live: LiveScan | undefined;
  /** This box's own refusal, in words, or null — the hook decides whose it is. */
  refusal: string | null;
  /** What was typed last time, off the draft. Editing beats retyping. */
  initial?: string;
  onRead: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const reading = live?.state === "scanning";
  // Only this dialog's own reading closes it; a photo scan started earlier
  // ending is no reason to take the box from someone typing.
  const mine = useRef(false);
  useEffect(() => {
    if (mine.current && live === undefined) onClose();
  }, [live, onClose]);

  const text = cleanBillText(value);
  const left = billTextLeft(value);
  // Only near the cap. A counter nobody is close to is fat
  // (docs/standing-instructions.md#interface), and this one has a job exactly
  // once: when the next paste is going to be cut off.
  const counting = left <= BILL_TEXT_MAX / 5;

  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (reading || text.length === 0) return;
    mine.current = true;
    await onRead(text);
  }

  return (
    <Dialog title={copy.scan.typeIn.title} onClose={onClose}>
      <form onSubmit={(e) => void go(e)}>
        <div className="dbody"><p>{copy.scan.typeIn.lede}</p></div>
        {/* `enterKeyHint` is deliberately not set: the newlines are the bill's
            lines, so Enter has to be Enter and the button is the way out. */}
        <textarea className="dtext" data-autofocus="" value={value}
          aria-label={copy.scan.typeIn.field} placeholder={copy.scan.typeIn.placeholder}
          maxLength={BILL_TEXT_MAX} rows={8} autoCapitalize="none" spellCheck={false}
          onChange={(e) => setValue(e.target.value)} />
        {counting ? (
          <div className="hint" aria-live="polite">
            {left <= 0 ? copy.scan.typeIn.full : copy.scan.typeIn.left(left)}
          </div>
        ) : null}
        {/* A typed bill's refusal is said **only** here, where the fix is; the
            screen behind never carries it (`ReceiptScan.refusal`). A photo
            refused before the box opened is the screen's, not repeated here. */}
        {refusal ? <Failure>{refusal}</Failure> : null}
        <div className="drow">
          {/* Enabled while the model reads, and it only closes the box: the
              reading outlives the dialog the way a scan outlives the tab that
              started it, and there is no request to take back. */}
          <button type="button" className="btn btn-s" onClick={onClose}
            {...keepsFocus}>{copy.act.cancel}</button>
          {reading && live
            ? <ScanBusy live={live} box="btn-pair pair-p" />
            : (
              <button type="submit" className="btn btn-p" disabled={text.length === 0}
                {...keepsFocus}>{copy.scan.typeIn.confirm}</button>
            )}
        </div>
      </form>
    </Dialog>
  );
}
