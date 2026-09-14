"use client";

import { useState } from "react";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { countText } from "../lib/format";
import type { MemberLine } from "../lib/scan/items";

/**
 * One person's row on a scanned bill, opened: what they had, as the bill
 * printed it.
 *
 * Only the split's share of a line is theirs, so the count is a fraction —
 * "×1/2" for a plate shared with somebody, "×1 1/2" for one of their own and
 * half of another, "×2" for a line they had all of and the receipt printed
 * twice (`countText`). The amounts are the same cents the split was derived
 * from, so a row and its lines agree by construction.
 *
 * Two screens read a bill back this way: a saved expense (ADR-0016) and the
 * answer a quick split ends on (ADR-0035). How a figure is printed is the
 * caller's — the group's currency, or bare.
 */
export function MemberBill({ name, total, lines, format, startOpen = false }: {
  name: string;
  total: React.ReactNode;
  lines: MemberLine[];
  format: (minor: number) => string;
  /**
   * Open from the start. A saved expense keeps its rows shut — the split is
   * one line of a screen about the whole entry — but a quick split's answer
   * *is* the bill, and somebody reading it out at the table should not have
   * to open three rows first (ADR-0035).
   */
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  return (
    // Row and lines are one band while it is open — the highlighter-and-edge
    // the bill screen uses for the portions of a single dish. Without it the
    // lines read as loose rows of the card rather than as this person's bill.
    <div className={`billgroup${startOpen ? " flat" : ""}${open ? " on" : ""}`}>
      <button type="button" className="kv" aria-expanded={open}
        onClick={() => setOpen(!open)}>
        <span className="k">
          {name}<Icon name="chev" size={11} className={`kvchev${open ? " on" : ""}`} />
        </span>
        <span className="v">{total}</span>
      </button>
      {open ? (
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
