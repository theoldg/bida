"use client";
// Doc: docs/who-had-what.md#the-bill-read-back

import { FlipCheck, Icon } from "./icons";
import { hasClipboard, writeClipboardText } from "../lib/clipboard";
import { copy } from "../lib/copy";
import { useFold } from "../lib/fold";
import { countText } from "../lib/format";
import { tick } from "../lib/haptics";
import { useFlash } from "../lib/hooks";
import type { MemberLine } from "../lib/scan/items";

/**
 * One person's row on a scanned bill: what they had, as printed.
 *
 * Counts are fractions of lines — "×1/2" shared, "×1 1/2", "×2"
 * (`countText`) — and amounts are the cents the split was derived from, so a
 * row and its lines agree by construction.
 *
 * Used by a saved expense (ADR-0016), where it folds, and a quick split
 * (ADR-0035), where it is `fixed`; the figure format differs too.
 */
export function MemberBill({ name, total, lines, format, fixed }: {
  name: React.ReactNode;
  total: React.ReactNode;
  lines: MemberLine[];
  format: (minor: number) => string;
  /**
   * A quick split's row: its answer *is* the bill, read out at the table, so
   * the lines are always there and nothing folds — and the total is what
   * somebody types into a bank app, so a tap copies `copy`, the number alone.
   * A saved expense keeps every row shut, yours too: the figure is what you
   * came for, as on your balance's fold.
   */
  fixed?: { copy: string };
}) {
  // Opened, the lines glide into view; shut, the list glides back (`useFold`).
  const { open, toggle, ref } = useFold<HTMLDivElement>();
  const shown = fixed !== undefined || open;
  return (
    // Nothing between people and nothing under the open one: it is marked by
    // its turned chevron alone (`globals.css`).
    <div ref={ref} className={`billgroup${shown ? " on" : ""}`}>
      {fixed ? (
        <div className="kv who">
          <span className="k">{name}</span>
          <CopyTotal text={fixed.copy}>{total}</CopyTotal>
        </div>
      ) : (
        <button type="button" className="kv who" aria-expanded={open}
          onClick={toggle}>
          <span className="k">
            {name}<Icon name="chev" size={11} className={`kvchev${open ? " on" : ""}`} />
          </span>
          <span className="v">{total}</span>
        </button>
      )}
      {shown ? (
        <div className="billlines">
          {lines.map((line, i) => {
            const count = line.extra ? null : countText(line.count);
            return (
              <div className={`billline${line.extra ? " billextra" : ""}`} key={i}>
                <span className="lbl">
                  {/* A deduction carries the name the bill gave it ("2 for 1");
                      the tip and the tax are only ever what they are. */}
                  {line.extra ? line.label || copy.items.extra[line.extra] : line.label}
                  {count ? <span className="billqty">×{count}</span> : null}
                </span>
                {/* A printed bill's dotted leader: what carries the eye from a
                    label of any length to the figure at the right margin. */}
                <span className="lead" aria-hidden="true" />
                <span className="amt">{format(line.minor)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The total, copied by a tap, as a balance is on Balances: the glyph flips to a
 * check, and a refused copy says nothing, the figure being on screen. It sits
 * left of the figure so the totals stay in the column the lines' figures make.
 * No clipboard, no button.
 */
function CopyTotal({ text, children }: { text: string; children: React.ReactNode }) {
  const [copied, setCopied] = useFlash();
  if (!hasClipboard()) return <span className="v">{children}</span>;
  return (
    <button type="button" className="v copytotal"
      onClick={() => void writeClipboardText(text).then(() => { setCopied(true); tick(); }, () => {})}>
      <FlipCheck name="copy" size={12} on={copied} />
      {children}
    </button>
  );
}
