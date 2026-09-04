"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { formatRate, isCurrencyCode, type RateSource } from "@hajsik/core";
import { GhostRow } from "../../../components/bits";
import { BadLink, Blank, Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { ChoiceDialog, ConfirmDialog, PromptDialog } from "../../../components/dialog";
import { RateDialog } from "../../../components/rate-dialog";
import { clearRate, setRate } from "../../../lib/db/commands";
import { copy } from "../../../lib/copy";
import {
  COMMON_CURRENCIES, currencyLabel, normalizeCurrencyCode, OTHER_CURRENCY,
} from "../../../lib/currencies";
import { plural } from "../../../lib/format";
import { route } from "../../../lib/group-link";
import { useGroupData } from "../../../lib/hooks";

/**
 * The group's exchange-rate registry: one rate per currency it spends in.
 *
 * A screen rather than a dialog because it is a list that grows — the same
 * shape as People, reached the same way, from the icon next to it. Each row is
 * one currency and what the group says it is worth; tapping one opens the
 * editor, which is a dialog because a rate is one decision with one sentence
 * to say about it (ADR-0008).
 *
 * There is nothing to "save" on this screen. A rate is a shared fact, so
 * setting one is an op and takes effect for everybody the moment it syncs —
 * and every entry already written in that currency is read at the new number
 * ([ADR-0005](../../../docs/decisions/0005-money-and-currency.md)).
 */
export default function RatesPage() {
  return <QueryBoundary><RatesScreen /></QueryBoundary>;
}

type Ask =
  | { kind: "edit"; currency: string }
  | { kind: "pick" }
  | { kind: "other" }
  | { kind: "remove"; currency: string; entryCount: number };

function RatesScreen() {
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const [ask, setAsk] = useState<Ask | null>(null);

  if (!groupId) return <BadLink />;
  if (data.loading) return <Blank title={copy.rates.title} back={route.group(groupId)} />;
  if (!data.group) return <BadLink />;

  const group = data.group;
  const base = group.baseCurrency;
  const { currencies } = data;
  const actor = data.me ?? "";

  const editing = ask?.kind === "edit"
    ? currencies.find((c) => c.currency === ask.currency)
      ?? { currency: ask.currency, entryCount: 0, rate: undefined }
    : undefined;

  async function save(currency: string, rate: string, source: RateSource, asOf: number) {
    if (!groupId || !actor) return;
    await setRate(groupId, actor, currency, rate, source, asOf);
  }

  async function remove(currency: string) {
    if (!groupId || !actor) return;
    await clearRate(groupId, actor, currency);
    setAsk(null);
  }

  /** Picking from the menu goes straight into the editor for that currency. */
  function add(currency: string) {
    if (currency === base) return;
    setAsk({ kind: "edit", currency });
  }

  return (
    <Screen>
      <Body>
        <TopBar title={copy.rates.title} sub={copy.rates.subtitle(base)} back={route.group(groupId)} />
        <Scroll>
          {currencies.length === 0 ? (
            <Empty title={copy.rates.empty}>{copy.rates.emptyBody}</Empty>
          ) : (
            <div className="rows">
              {currencies.map((c) => (
                <button key={c.currency} className="row" type="button"
                  onClick={() => setAsk({ kind: "edit", currency: c.currency })}>
                  <div className="rmain">
                    <div className="rtitle">{currencyLabel(c.currency)}</div>
                    <div className="rmeta">
                      {c.entryCount > 0
                        ? copy.rates.usedBy(plural(c.entryCount, copy.noun.entry))
                        : copy.rates.usedByNone}
                    </div>
                  </div>
                  <div className="ramt">
                    {/* The rate, the way this screen's own heading reads it:
                        one of theirs is this much of ours. */}
                    <div className="ratecell">
                      {c.rate
                        ? copy.currency.hasRate(`${formatRate(c.rate.rate)} ${base}`)
                        : copy.currency.noRate}
                    </div>
                    <div className="rmeta">{c.rate ? "" : copy.rates.unset}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="rows">
            <GhostRow icon="plus" label={copy.rates.add} onClick={() => setAsk({ kind: "pick" })} />
          </div>
        </Scroll>
      </Body>

      {editing ? (
        <RateDialog
          currency={editing.currency}
          base={base}
          current={editing.rate}
          entryCount={editing.entryCount}
          onSave={(rate, source, asOf) => save(editing.currency, rate, source, asOf)}
          onRemove={editing.rate
            ? () => { setAsk({ kind: "remove", currency: editing.currency, entryCount: editing.entryCount }); return Promise.resolve(); }
            : undefined}
          onClose={() => setAsk((a) => (a?.kind === "edit" ? null : a))}
        />
      ) : null}

      {ask?.kind === "pick" ? (
        <ChoiceDialog
          title={copy.currency.title}
          value={base}
          options={[
            ...[...new Set([base, ...COMMON_CURRENCIES])].map((c) => ({
              value: c,
              label: currencyLabel(c),
              note: c === base ? copy.currency.isBase
                : currencies.find((u) => u.currency === c)?.rate
                  ? copy.currency.hasRate(
                    `${formatRate(currencies.find((u) => u.currency === c)!.rate!.rate)} ${base}`)
                  : undefined,
            })),
            { value: OTHER_CURRENCY, label: copy.currency.other, note: copy.currency.otherNote },
          ]}
          onPick={(currency) => {
            if (currency === OTHER_CURRENCY) { setAsk({ kind: "other" }); return; }
            add(currency);
          }}
          // "Other…" hands over to the prompt, so that pick must not close it.
          onClose={() => setAsk((a) => (a?.kind === "pick" ? null : a))}
        />
      ) : null}

      {ask?.kind === "other" ? (
        <PromptDialog title={copy.currency.title} placeholder={copy.currency.otherPlaceholder}
          confirm={copy.act.useIt} maxLength={3}
          autoCapitalize="characters" hint={copy.currency.otherHint}
          clean={normalizeCurrencyCode} valid={(v) => isCurrencyCode(v) && v !== base}
          onSubmit={(currency) => add(currency)}
          onClose={() => setAsk((a) => (a?.kind === "other" ? null : a))} />
      ) : null}

      {ask?.kind === "remove" ? (
        <ConfirmDialog title={copy.rates.removeTitle(ask.currency)} confirm={copy.act.remove}
          danger={true} onConfirm={() => remove(ask.currency)} onClose={() => setAsk(null)}>
          <p>{ask.entryCount > 0
            ? copy.rates.removeBody(plural(ask.entryCount, copy.noun.entry))
            : copy.rates.removeBodyEmpty}</p>
        </ConfirmDialog>
      ) : null}
    </Screen>
  );
}
