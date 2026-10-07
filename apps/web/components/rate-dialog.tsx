"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import {
  formatRate, invertRate, isValidRate, sanitizeRate,
  RATE_DIGITS, RATE_SHOWN_DIGITS, type EntryRateSource, type Rate, type RateSource,
} from "@bida/core";
import { Dialog } from "./dialog";
import { GroupedInput } from "./amount-input";
import { copy } from "../lib/copy";
import { fetchRate, RateOfflineError } from "../lib/rates";
import { errorText, rateText } from "../lib/format";

/**
 * What one currency is worth on this entry, edited from either end — "1 EUR =
 * 4.5 PLN" or "1 PLN = 0.22 EUR", since which way is natural depends on the
 * pair. Typing in either updates the other; only the typed field keeps its
 * text verbatim, so "4." isn't reformatted under the caret.
 *
 * One direction is stored (foreign to base, what `convertMinor` takes); the
 * reciprocal is computed at `RATE_DIGITS` and shown at `RATE_SHOWN_DIGITS`, so
 * "4.5" reads back as "4.5" (see `invertRate`).
 *
 * The rate is the entry's own, so Save here only hands it back; it reaches the
 * log with the entry ([ADR-0005](../../../docs/decisions/0005-money-and-currency.md)).
 * Opens on a fetched rate when it has none, saying which it shows. Focuses
 * neither field: the caret would have to guess a direction.
 */

/** Where the number currently in the fields came from. */
type Provenance =
  | { kind: "loading" }
  | { kind: "fetched"; asOf: string | null }
  | { kind: "typed" | "copied" | "group" }
  | { kind: "offline" }
  | { kind: "unavailable" };

function provenanceText(from: Provenance): string {
  switch (from.kind) {
    case "loading": return copy.rates.from.loading;
    case "offline": return copy.rates.from.offline;
    case "unavailable": return copy.rates.from.unavailable;
    case "fetched":
      return from.asOf ? copy.rates.from.fetched(from.asOf) : copy.rates.from.fetchedUndated;
    case "typed": return copy.rates.from.typed;
    case "copied": return copy.rates.from.copied;
    case "group": return copy.rates.from.group;
  }
}

/** The two fields, kept in step. `forward` is "1 currency = ? base". */
interface Pair {
  forward: string;
  inverse: string;
}

/** Both directions of a stored rate, each at reading precision. */
function pairOf(rate: Rate): Pair {
  return {
    forward: formatRate(rate, RATE_SHOWN_DIGITS),
    inverse: formatRate(invertRate(rate, RATE_DIGITS), RATE_SHOWN_DIGITS),
  };
}

/**
 * One side typed, the other derived. The typed text is kept verbatim — "0."
 * and "4.50" are both mid-thought.
 */
function pairFrom(typed: string, side: "forward" | "inverse"): Pair {
  const other = isValidRate(typed)
    ? formatRate(invertRate(typed, RATE_DIGITS), RATE_SHOWN_DIGITS)
    : "";
  return side === "forward"
    ? { forward: typed, inverse: other }
    : { forward: other, inverse: typed };
}

export function RateDialog({
  currency, base, day, current, onSave, onClose,
}: {
  currency: string;
  base: string;
  /** The entry's local day, "YYYY-MM-DD": what "Look it up" asks the feed for. */
  day: string;
  /** The entry's rate, or undefined when it hasn't got one yet. */
  current: { rate: Rate; source: EntryRateSource } | undefined;
  onSave: (rate: Rate, source: RateSource) => Promise<void> | void;
  onClose: () => void;
}) {
  const [pair, setPair] = useState<Pair>(() => (current ? pairOf(current.rate) : { forward: "", inverse: "" }));
  const [from, setFrom] = useState<Provenance>(() =>
    current ? (current.source === "fetched" ? { kind: "fetched", asOf: null } : { kind: current.source })
      : { kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();
  // A rate that arrives after somebody has started typing is not welcome.
  const touched = useRef(false);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  async function look() {
    setFrom({ kind: "loading" });
    try {
      const got = await fetchRate(currency, base, day);
      if (!live.current || touched.current) return;
      setPair(pairOf(got.rate));
      setFrom({ kind: "fetched", asOf: got.asOf });
    } catch (err) {
      if (!live.current) return;
      setFrom({ kind: err instanceof RateOfflineError ? "offline" : "unavailable" });
    }
  }

  // Only when the entry hasn't got a number yet. Opening the dialog over one is
  // not a request to overrule it — "Look it up" is, and it is one tap away.
  useEffect(() => {
    if (current) return;
    void look();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  function type(typed: string, side: "forward" | "inverse") {
    touched.current = true;
    setPair(pairFrom(typed, side));
    setFrom({ kind: "typed" });
  }

  const rate = pair.forward.trim();
  const ok = isValidRate(rate);

  async function save() {
    if (!ok || busy) return;
    setBusy(true);
    setFailed(undefined);
    try {
      await onSave(rate, from.kind === "fetched" ? "fetched" : "typed");
      onClose();
    } catch (err) {
      if (live.current) setFailed(errorText(err));
    } finally {
      if (live.current) setBusy(false);
    }
  }

  return (
    <Dialog title={copy.rates.editTitle(currency)} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="ratepair">
          <RateSide code={currency} unit={base} value={pair.forward}
            onChange={(v) => type(v, "forward")} />
          <RateSide code={base} unit={currency} value={pair.inverse}
            onChange={(v) => type(v, "inverse")} />
        </div>

        <div className="ratefrom">
          <span>{provenanceText(from)}</span>
          <button type="button" className="chip" onClick={() => { touched.current = false; void look(); }}
            disabled={from.kind === "loading"}>
            {copy.rates.refetch}
          </button>
        </div>

        {failed ? <p className="failure" role="alert">{copy.rates.failed(failed)}</p> : null}

        {/* Two ways out, both about this dialog: leave it, or save it. */}
        <div className="drow">
          <button type="button" className="btn btn-s" onClick={onClose} disabled={busy}>
            {copy.act.cancel}
          </button>
          <button type="submit" className="btn btn-p" disabled={!ok || busy}>
            {busy ? <span className="spinner" /> : null}{copy.act.save}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** "1 PLN = [ 0.234 ] EUR" — one direction of the pair. */
function RateSide({ code, unit, value, onChange }: {
  code: string; unit: string; value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="rateside">
      <span className="ratelead">{copy.rates.oneOf(code)}</span>
      {/* The same field as every amount in the app, with the rate's own idea
          of what may be typed: unclipped decimals, and thousands grouped —
          "1 EUR = 18 000 IDR" is a rate people really do type. */}
      <GroupedInput className="rateinput wide" value={value} sanitize={sanitizeRate}
        fieldClassName={value !== "" && !isValidRate(value) ? "bad" : undefined}
        aria-label={copy.form.rateLabel(code, unit)}
        onChange={onChange} />
      <span className="rateunit">{unit}</span>
    </label>
  );
}

/** A chip is read at a glance, so one figure fewer than the dialog edits. */
export const RATE_CHIP_DIGITS = RATE_SHOWN_DIGITS - 1;

/**
 * "@ 4.3731", the way to `RateDialog` wherever a converted figure is shown: the
 * entry form under its amount, the entry's summary under its figure. The "@"
 * is quiet so the figure leads; while the feed is asked it is a spinner, and
 * no rate after that is a red "?", which the form's refusal blooms.
 */
export function RateChip({ rate, looking, className, ...rest }: {
  rate: Rate | undefined;
  looking?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children">) {
  return (
    <button type="button" className={`chip ratechip${className ?? ""}`} {...rest}>
      <span className="at">{copy.rates.at}</span>{" "}
      {rate !== undefined ? rateText(rate, RATE_CHIP_DIGITS)
        : looking ? <span className="spinner" aria-label={copy.rates.from.loading} />
          : <span className="bad">?</span>}
    </button>
  );
}
