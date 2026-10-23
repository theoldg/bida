"use client";
// Doc: docs/entry.md#the-keyboards-chain

import { useState } from "react";
import { ChoiceDialog } from "./dialog";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { NO_AUTOFILL } from "../lib/autofill";
import { currencyChoices, currencyLabel, currencySearch } from "../lib/currencies";

/**
 * Picking a currency, wherever one is picked — a new group's base, an entry's:
 * the list `currencyChoices` orders, under a search that reaches every
 * currency the browser knows and takes a three-letter code none of them is.
 * The field takes no caret until tapped, so the list opens with no keyboard
 * over it.
 */
export function CurrencyPicker({ value, first, used = [], note, onPick, onClose }: {
  /** The ticked row; picking it again is no change. */
  value: string;
  /** Listed first, in order (`currencyChoices`). */
  first: readonly string[];
  /** The group's own currencies, most spent-in first. */
  used?: readonly string[];
  note?: (code: string) => string | undefined;
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const { codes, typed } = currencySearch(query, currencyChoices(first, used));
  const options = [
    ...codes.map((c) => ({ value: c, label: currencyLabel(c), note: note?.(c) })),
    ...typed ? [{ value: typed, label: typed, note: copy.currency.typed }] : [],
  ];
  return (
    <ChoiceDialog
      title={copy.currency.title}
      value={value}
      options={options}
      onPick={onPick}
      onClose={onClose}
      empty={<p className="hint dnone">{copy.currency.none}</p>}
      head={
        // Enter takes the top row, as a search's first answer is the one meant.
        <form className="dsearch" onSubmit={(e) => {
          e.preventDefault();
          const top = options[0]?.value;
          if (top === undefined) return;
          if (top !== value) onPick(top);
          onClose();
        }}>
          {/* A label, so a tap anywhere on the row lands in the field. */}
          <label className="dsearchrow">
            <Icon name="search" size={15} className="muted" style={{ flex: "none" }} />
            <input value={query} placeholder={copy.currency.search}
              aria-label={copy.currency.search} autoCapitalize="none" autoCorrect="off" spellCheck={false}
              autoComplete={NO_AUTOFILL} enterKeyHint="go" maxLength={40}
              onChange={(e) => setQuery(e.target.value)} />
          </label>
        </form>
      }
    />
  );
}
