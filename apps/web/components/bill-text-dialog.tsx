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
 * Type the bill in — the scan control's third door, for a receipt nobody
 * photographed, one a camera has failed on, or one that arrived as text
 * (docs/receipt-scanning.md#typing-a-bill-in). What it sends goes through the
 * same reading as a photograph and comes back as the same filled draft, so
 * there is nothing here about bills, lines or totals: the box and the cap.
 *
 * **It takes its state from the reading, not from itself.** `live` is the one
 * `LiveScan` the screen behind it is also watching, so the bar is a clock on the
 * reading: close it mid-read and the draft still fills, reopen it and the bar is
 * where the reading actually is. A refusal keeps the dialog standing with the
 * text intact — unlike a bad photograph, a bad bill is fixed where it was typed,
 * which is also why this is the one place it is said.
 *
 * **Rendered by `useReceiptScan`, never by a screen**: a dialog whose own answer
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
  // Only this dialog's own reading closes it. A photograph started before it
  // was opened is still a reading, and watching it end is no reason to take the
  // box away from somebody who is typing.
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
        {/* A typed bill's refusal, said where the fix is — and said **only**
            here: the screen behind never rang this reading, so it does not
            carry the sentence (`ReceiptScan.refusal`). Shut the box and the
            message goes with the text it was about. A photograph refused
            before the box was opened is the screen's, and is not repeated
            over it. */}
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
