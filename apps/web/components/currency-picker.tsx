"use client";

import { useRef, useState } from "react";
import { isCurrencyCode } from "@bida/core";
import { ChoiceDialog, PromptDialog } from "./dialog";
import { copy } from "../lib/copy";
import { currencyChoices, currencyLabel, normalizeCurrencyCode, OTHER_CURRENCY } from "../lib/currencies";

/**
 * Picking a currency, wherever one is picked — a new group's base, an entry's,
 * a rate to add: the list `currencyChoices` orders, then "Other…", which swaps
 * the list for a field taking any three-letter code. `onClose` is heard once,
 * when the whole picker is done, never on the swap.
 */
export function CurrencyPicker({ value, first, used = [], note, refuse, onPick, onClose }: {
  /** The ticked row; picking it again is no change. */
  value: string;
  /** Listed first, in order (`currencyChoices`). */
  first: readonly string[];
  /** The group's own currencies, most spent-in first. */
  used?: readonly string[];
  note?: (code: string) => string | undefined;
  /** A code "Other…" won't take besides a malformed one — Rates' base. */
  refuse?: string;
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const [other, setOther] = useState(false);
  // `ChoiceDialog` closes itself right after a pick, in the same tick — before
  // `other` above is read back — so the swap is told apart by a ref.
  const swapping = useRef(false);

  if (other) {
    return (
      <PromptDialog title={copy.currency.title} placeholder={copy.currency.otherPlaceholder}
        confirm={copy.act.useIt} maxLength={3}
        autoCapitalize="characters"
        clean={normalizeCurrencyCode} valid={(v) => isCurrencyCode(v) && v !== refuse}
        onSubmit={(code) => { onPick(code); onClose(); }}
        onClose={onClose} />
    );
  }
  return (
    <ChoiceDialog
      title={copy.currency.title}
      value={value}
      options={[
        ...currencyChoices(first, used).map((c) => ({ value: c, label: currencyLabel(c), note: note?.(c) })),
        { value: OTHER_CURRENCY, label: copy.currency.other, note: copy.currency.otherNote },
      ]}
      onPick={(c) => {
        if (c !== OTHER_CURRENCY) return onPick(c);
        swapping.current = true;
        setOther(true);
      }}
      onClose={() => { if (!swapping.current) onClose(); }}
    />
  );
}
