"use client";

import { useState } from "react";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { countText } from "../lib/format";
import type { MemberLine } from "../lib/scan/items";

/**
 * One person's row on a scanned bill, opened: what they had, as printed.
 *
 * Counts are fractions of lines — "×1/2" shared, "×1 1/2", "×2"
 * (`countText`) — and amounts are the cents the split was derived from, so a
 * row and its lines agree by construction.
 *
 * Used by a saved expense (ADR-0016) and a quick split's result (ADR-0035);
 * only `startOpen` and the figure format differ.
 */
export function MemberBill({ name, total, lines, format, startOpen = false }: {
  name: string;
  total: React.ReactNode;
  lines: MemberLine[];
  format: (minor: number) => string;
  /**
   * Open from the start. A saved expense keeps rows shut but the viewer's own;
   * a quick split's answer *is* the bill, read out at the table (ADR-0035).
   */
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  return (
    // Nothing between people and nothing under the open one: it is marked by
    // its chevron and its darkened name alone (`globals.css`).
    <div className={`billgroup${open ? " on" : ""}`}>
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
