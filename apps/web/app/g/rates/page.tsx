"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { isCurrencyCode, type CurrencyInUse, type RateSource } from "@bida/core";
import { GhostRow } from "@/components/bits";
import { BadLink, Blank, Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "@/components/chrome";
import { ChoiceDialog, ConfirmDialog, Dialog, PromptDialog } from "@/components/dialog";
import { useLongPressMenu } from "@/components/long-press";
import { RateDialog } from "@/components/rate-dialog";
import { clearRate, setRate } from "@/lib/db/commands";
import { copy } from "@/lib/copy";
import {
  currencyChoices, currencyLabel, normalizeCurrencyCode, OTHER_CURRENCY,
} from "@/lib/currencies";
import { money, plural, rateText } from "@/lib/format";
import { route } from "@/lib/group-link";
import { useClaimGate, useGroupData } from "@/lib/hooks";

/**
 * The group's exchange-rate registry: one rate per currency it spends in.
 *
 * A screen because it is a growing list, like People; each row opens a dialog
 * editor, a rate being one decision (ADR-0008).
 *
 * Nothing to "save": setting a rate is an op, effective for everybody on sync,
 * and every entry in that currency is read at the new number
 * ([ADR-0005](../../../docs/decisions/0005-money-and-currency.md)).
 */
export default function RatesPage() {
  return <QueryBoundary><RatesScreen /></QueryBoundary>;
}

/** One entry still written in a currency — the dialog treats both kinds alike. */
interface BlockingEntry {
  id: string;
  label: string;
  baseAmountMinor: number;
}

type Ask =
  | { kind: "edit"; currency: string }
  | { kind: "pick" }
  | { kind: "other" }
  | { kind: "remove"; currency: string }
  | { kind: "blocked"; currency: string; entries: BlockingEntry[] };

function RatesScreen() {
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const unclaimed = useClaimGate(groupId, data);
  const [ask, setAsk] = useState<Ask | null>(null);

  if (!groupId) return <BadLink />;
  if (data.loading || unclaimed) {
    return <Blank title={copy.rates.title} back={route.group(groupId)} />;
  }
  if (!data.group) return <BadLink />;

  const group = data.group;
  const base = group.baseCurrency;
  const { currencies } = data;
  const actor = data.me;

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

  // **A rate is removed on the same terms as a person: only when nothing leans
  // on it.** Otherwise every entry in it silently re-prices to its saved rate.
  function askRemove(currency: string) {
    const blocking: BlockingEntry[] = [
      ...data.expenses.filter((e) => e.currency === currency).map((e) => ({
        id: e.id,
        label: e.description || copy.group.untitled,
        baseAmountMinor: e.baseAmountMinor,
      })),
      ...data.settlements.filter((t) => t.currency === currency).map((t) => ({
        id: t.id,
        label: copy.group.paidTo(data.nameOf(t.fromMember), data.nameOf(t.toMember)),
        baseAmountMinor: t.baseAmountMinor,
      })),
    ];
    setAsk(blocking.length > 0
      ? { kind: "blocked", currency, entries: blocking }
      : { kind: "remove", currency });
  }

  /** Picking from the menu goes straight into the editor for that currency. */
  function add(currency: string) {
    if (currency === base) return;
    setAsk({ kind: "edit", currency });
  }

  return (
    <Screen>
      <Body>
        <TopBar title={copy.rates.title} back={route.group(groupId)} />
        <Scroll>
          {currencies.length === 0 ? (
            <Empty title={copy.rates.empty}>{copy.rates.emptyBody}</Empty>
          ) : (
            <div className="rows">
              {currencies.map((c) => (
                <RateRow key={c.currency} row={c} base={base}
                  onOpen={() => setAsk({ kind: "edit", currency: c.currency })}
                  onDelete={() => askRemove(c.currency)} />
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
          onClose={() => setAsk((a) => (a?.kind === "edit" ? null : a))}
        />
      ) : null}

      {ask?.kind === "pick" ? (
        <ChoiceDialog
          title={copy.currency.title}
          value={base}
          options={[
            ...currencyChoices([base], currencies.map((u) => u.currency)).map((c) => ({
              value: c,
              label: currencyLabel(c),
              note: c === base ? copy.currency.isBase
                : currencies.find((u) => u.currency === c)?.rate
                  ? copy.currency.hasRate(
                    `${rateText(currencies.find((u) => u.currency === c)!.rate!.rate)} ${base}`)
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
          autoCapitalize="characters"
          clean={normalizeCurrencyCode} valid={(v) => isCurrencyCode(v) && v !== base}
          onSubmit={(currency) => add(currency)}
          onClose={() => setAsk((a) => (a?.kind === "other" ? null : a))} />
      ) : null}

      {ask?.kind === "remove" ? (
        <ConfirmDialog title={copy.rates.removeTitle(ask.currency)} confirm={copy.act.remove}
          danger={true} onConfirm={() => remove(ask.currency)} onClose={() => setAsk(null)}>
          <p>{copy.rates.removeBodyEmpty}</p>
        </ConfirmDialog>
      ) : null}

      {ask?.kind === "blocked" ? (
        <Dialog title={copy.rates.blockedTitle(ask.currency)} onClose={() => setAsk(null)}>
          <div className="dbody">
            <p>{copy.rates.blockedBody(plural(ask.entries.length, copy.noun.entry))}</p>
          </div>
          <div className="dlist">
            {ask.entries.map((e) => (
              <Link key={e.id} href={route.entry(groupId, e.id, "rates")} className="drow-pick">
                <span className="rmain">
                  <span className="rtitle">{e.label}</span>
                </span>
                <span className="rmeta">{money(e.baseAmountMinor, base)}</span>
              </Link>
            ))}
          </div>
          <div className="drow">
            <button className="btn btn-p" onClick={() => setAsk(null)}>{copy.act.close}</button>
          </div>
        </Dialog>
      ) : null}
    </Screen>
  );
}

/**
 * One currency and its rate. Tap opens the editor; long press offers delete,
 * as for entries, so the editor is only about the number. An unset rate has
 * nothing to delete, and an empty menu doesn't open.
 */
function RateRow({ row, base, onOpen, onDelete }: {
  row: CurrencyInUse; base: string; onOpen: () => void; onDelete: () => void;
}) {
  const { hold, menu } = useLongPressMenu(row.rate
    ? [{ label: copy.act.delete, icon: "trash", danger: true, onSelect: onDelete }]
    : []);
  return (
    <>
      <button className="row" type="button" onClick={onOpen} {...hold}>
        <div className="rmain">
          <div className="rtitle">{currencyLabel(row.currency)}</div>
          <div className="rmeta">
            {row.entryCount > 0
              ? copy.rates.usedBy(plural(row.entryCount, copy.noun.entry))
              : copy.rates.usedByNone}
          </div>
        </div>
        <div className="ramt">
          {/* The rate, the way this screen's own heading reads it:
              one of theirs is this much of ours. */}
          <div className="ratecell">
            {row.rate
              ? copy.currency.hasRate(`${rateText(row.rate.rate)} ${base}`)
              : copy.currency.noRate}
          </div>
          <div className="rmeta">{row.rate ? "" : copy.rates.unset}</div>
        </div>
      </button>
      {menu}
    </>
  );
}
