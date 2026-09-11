"use client";

import { useEffect, useRef, useState } from "react";
import {
  formatRate, invertRate, isValidRate, sanitizeRate,
  RATE_DIGITS, RATE_SHOWN_DIGITS, type Rate, type RateSource,
} from "@bida/core";
import { Dialog } from "./dialog";
import { GroupedInput } from "./amount-input";
import { copy } from "../lib/copy";
import { fetchRate, RateOfflineError } from "../lib/rates";
import { plural } from "../lib/format";

/**
 * What one currency is worth to this group, edited from either end.
 *
 * The two fields are the same number said the two ways people think in — "1
 * EUR = 4.5 PLN" going one way, "1 PLN = 0.22 EUR" the other — because which
 * way round a rate is natural depends entirely on the pair, and having to do
 * the division in your head to use the app's chosen direction is the reason
 * this dialog has two fields instead of one. Typing in either moves the other
 * on every keystroke; only the field being typed in keeps its text verbatim,
 * so a half-typed "4." isn't reformatted out from under the caret.
 *
 * One direction is stored — foreign to base, which is what `convertMinor`
 * takes — so the reciprocal is computed at `RATE_DIGITS` and shown at
 * `RATE_SHOWN_DIGITS`, which is what makes "4.5" read back as "4.5" rather
 * than "4.500000001" (see `invertRate`).
 *
 * It opens on a fetched number when it can get one, and says which it is
 * showing: today's rate, or yours. Nothing is written until Save — a rate
 * moves every balance in the group, so it is never a background write
 * ([ADR-0005](../../../docs/decisions/0005-money-and-currency.md)).
 */

/** Where the number currently in the fields came from. */
type Provenance =
  | { kind: "loading" }
  | { kind: "fetched"; asOf: string | null }
  | { kind: "typed"; asOf: number | null }
  | { kind: "offline" }
  | { kind: "unavailable" };

function provenanceText(from: Provenance): string {
  switch (from.kind) {
    case "loading": return copy.rates.from.loading;
    case "offline": return copy.rates.from.offline;
    case "unavailable": return copy.rates.from.unavailable;
    case "fetched":
      return from.asOf ? copy.rates.from.fetched(from.asOf) : copy.rates.from.fetchedUndated;
    case "typed":
      return from.asOf
        ? copy.rates.from.typedOn(new Date(from.asOf).toISOString().slice(0, 10))
        : copy.rates.from.typed;
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
 * One side typed; the other derived. The typed text is kept exactly as typed —
 * "0." and "4.50" are both mid-thought and reformatting either is how a field
 * fights the person using it.
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
  currency, base, current, entryCount, onSave, onClose,
}: {
  currency: string;
  base: string;
  /** The registry's row, or undefined when the group hasn't got one yet. */
  current: { rate: Rate; source: RateSource; asOf: number } | undefined;
  /** Live entries written in this currency — what saving will re-value. */
  entryCount: number;
  onSave: (rate: Rate, source: RateSource, asOf: number) => Promise<void>;
  onClose: () => void;
}) {
  const [pair, setPair] = useState<Pair>(() => (current ? pairOf(current.rate) : { forward: "", inverse: "" }));
  const [from, setFrom] = useState<Provenance>(() =>
    current ? { kind: current.source, asOf: current.source === "typed" ? current.asOf : null } as Provenance
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
      const got = await fetchRate(currency, base);
      if (!live.current || touched.current) return;
      setPair(pairOf(got.rate));
      setFrom({ kind: "fetched", asOf: got.asOf });
    } catch (err) {
      if (!live.current) return;
      setFrom({ kind: err instanceof RateOfflineError ? "offline" : "unavailable" });
    }
  }

  // Only when the group hasn't got a number yet. A rate somebody set is the
  // group's decision, and opening the dialog is not a request to overrule it —
  // "Look it up" is, and it is one tap away.
  useEffect(() => {
    if (current) return;
    void look();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  function type(typed: string, side: "forward" | "inverse") {
    touched.current = true;
    setPair(pairFrom(typed, side));
    setFrom({ kind: "typed", asOf: null });
  }

  const rate = pair.forward.trim();
  const ok = isValidRate(rate);
  const changed = !current || current.rate !== rate;

  async function save() {
    if (!ok || busy) return;
    setBusy(true);
    setFailed(undefined);
    try {
      await onSave(rate, from.kind === "fetched" ? "fetched" : "typed", Date.now());
      onClose();
    } catch (err) {
      if (live.current) setFailed(err instanceof Error ? err.message : String(err));
    } finally {
      if (live.current) setBusy(false);
    }
  }

  return (
    <Dialog title={copy.rates.editTitle(currency)} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="ratepair">
          <RateSide code={currency} unit={base} value={pair.forward} autofocus={!!current}
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

        {/* The one consequence worth saying out loud: this is not a number on
            one entry, it is the number every entry in this currency is read at. */}
        {entryCount > 0 && changed ? (
          <div className="dbody"><p>{copy.rates.movesEntries(plural(entryCount, copy.noun.entry), currency)}</p></div>
        ) : null}

        {failed ? <p className="failure" role="alert">{copy.rates.failed(failed)}</p> : null}

        {/* Two ways out, both about this dialog: leave it, or save it.
            Removing the rate is the row's business, not the editor's — it
            lives on the row's long-press menu, where deleting an entry does. */}
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
function RateSide({ code, unit, value, autofocus, onChange }: {
  code: string; unit: string; value: string; autofocus?: boolean;
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
        {...(autofocus ? { "data-autofocus": "" } : {})}
        onChange={onChange} />
      <span className="rateunit">{unit}</span>
    </label>
  );
}
