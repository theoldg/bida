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
 * photographed, one a camera has already failed on, or one that arrived as text
 * in the first place (docs/receipt-scanning.md#typing-a-bill-in).
 *
 * What it sends goes through the same reading as a photograph and comes back as
 * the same filled draft, so there is nothing here about bills, lines or totals:
 * the box, the cap, and the two things the photo path says elsewhere.
 *
 * **It takes its state from the reading, not from itself.** `live` is the one
 * `LiveScan` the screen behind it is also watching, which is what lets the bar be
 * a clock on the reading rather than on this dialog: close it mid-read and the
 * draft still fills, open it again and the bar is where the reading actually is.
 * A refusal keeps the dialog standing with the text intact, because unlike a bad
 * photograph a bad bill is fixed where it was typed.
 *
 * It is rendered by `useReceiptScan` and never by a screen, for the reason given
 * there: a dialog whose own answer moves the panel around it is a dialog that
 * gets unmounted mid-sentence.
 */
export function BillTextDialog({ live, initial = "", onRead, onClose }: {
  live: LiveScan | undefined;
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
        {/* The reading's own refusal, said where the fix is. The screen behind is
            showing the same sentence; this one is the copy somebody can act on
            without closing anything. */}
        {live?.state === "error"
          ? <Failure>{live.error ?? copy.scan.failed}</Failure> : null}
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
