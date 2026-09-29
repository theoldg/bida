"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { CurrencyCode } from "@bida/core";
import { money } from "@/lib/format";
import { planRoll, rollTime, ROLL_GAP, type Glyph, type Roll } from "@/lib/roll";
import { calmly } from "@/lib/seek";

/**
 * An unsigned figure that rolls to a new value: each digit that changed slides
 * out and its successor in, one after another from the left — up for a bigger
 * figure, down for a smaller. The digits that stay never move.
 *
 * `from` is read on mount only: the figure this card drew last time, so a
 * figure that changed while the card was away (a save, a reopen) rolls from
 * it after `wait`. A change arriving while mounted rolls at once. Reduced
 * motion puts the figure in place. Settled, it is plain text again.
 */
export function RollingFigure({ minor, currency, from = null, wait = 0, hold }: {
  minor: number; currency: CurrencyCode; from?: number | null; wait?: number;
  /**
   * Holds any roll at its old figure until `go` is called, then rolls with
   * whatever is left of `wait` (lib/ledger-motion.ts `awaitRoll`); returns
   * its unsubscribe.
   */
  hold?: (go: () => void) => () => void;
}) {
  const [roll, setRoll] = useState<{ plan: Roll; wait: number; n: number } | null>(() => {
    const plan = from === null || still() ? null : planRoll(from, minor, currency);
    return plan ? { plan, wait, n: 0 } : null;
  });
  const drawn = useRef(minor);

  // Held, any roll — the opening one, or a change landing just after it, as a
  // save's write can — waits at its old figure.
  const [held, setHeld] = useState(hold !== undefined);
  const [mounted] = useState(() => Date.now());
  useEffect(() => {
    if (!held || !hold) return;
    const go = () => {
      setHeld(false);
      // What is left of the opening beat, if the hold was shorter.
      setRoll((r) => (r ? { plan: r.plan, wait: Math.max(0, r.wait - (Date.now() - mounted)), n: r.n + 1 } : r));
    };
    // Nothing is left holding it for good: a save whose row never draws.
    const t = setTimeout(go, HOLD_MAX_MS);
    const off = hold(go);
    return () => { off(); clearTimeout(t); };
  }, [held, hold, mounted]);

  useEffect(() => {
    const was = drawn.current;
    drawn.current = minor;
    if (was === minor) return;
    // Interrupted mid-roll, it starts again from the figure it was heading to.
    const plan = still() ? null : planRoll(was, minor, currency);
    setRoll((r) => (plan ? { plan, wait: 0, n: (r?.n ?? 0) + 1 } : null));
  }, [minor, currency]);

  useEffect(() => {
    if (!roll || held) return;
    const t = setTimeout(() => setRoll(null), roll.wait + rollTime(roll.plan));
    return () => clearTimeout(t);
  }, [roll, held]);

  const figure = money(minor, currency);
  if (!roll) return <>{figure}</>;
  const { plan } = roll;
  return (
    <>
      <span className="sr">{figure}</span>
      <span key={roll.n} className={`rolling ${plan.up ? "up" : "down"}${held ? " held" : ""}`} aria-hidden="true">
        {plan.pre}
        {plan.glyphs.map((g, i) => <Cell key={i} glyph={g} delay={roll.wait + (g.order ?? 0) * ROLL_GAP} />)}
        {plan.post}
      </span>
    </>
  );
}

const HOLD_MAX_MS = 4000;

/** No roll under reduced motion, nor where there is no window to ask. */
const still = () => typeof window === "undefined" || calmly();

function Cell({ glyph, delay }: { glyph: Glyph; delay: number }) {
  if (glyph.order === null) return <span className="rollcell">{glyph.to}</span>;
  // A cell only one side has opens from nothing or closes to it.
  const size = glyph.from === "" ? " open" : glyph.to === "" ? " close" : "";
  return (
    <span className={`rollcell moving${size}`} style={{ "--delay": `${delay}ms` } as CSSProperties}>
      <span className="rollstrip">
        <span>{glyph.from || " "}</span>
        <span>{glyph.to || " "}</span>
      </span>
    </span>
  );
}
