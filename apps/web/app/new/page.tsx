"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eyebrow } from "../../components/bits";
import { Body, Failure, Screen, Scroll, TopBar } from "../../components/chrome";
import { ChoiceDialog, PromptDialog } from "../../components/dialog";
import { Icon } from "../../components/icons";
import { AddName } from "../../components/name-adder";
import { copy } from "../../lib/copy";
import { COMMON_CURRENCIES, currencyLabel, normalizeCurrencyCode, OTHER_CURRENCY } from "../../lib/currencies";
import { createGroup } from "../../lib/db/commands";
import { errorText } from "../../lib/format";
import { route } from "../../lib/group-link";

/**
 * The whole group, on one screen.
 *
 * The others used to be somebody else's problem: create, land on an empty
 * ledger, find People, add four names one dialog at a time. They belong here —
 * the names are in your head at exactly this moment, and typing them is one
 * uninterrupted run down the same list they'll appear in. Nothing is written
 * until Create, so this list is plain state, not ops.
 */
export default function NewGroupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [myName, setMyName] = useState("");
  const [others, setOthers] = useState<string[]>([]);
  const [currency, setCurrency] = useState("EUR");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();
  const [ask, setAsk] = useState<null | "currency" | "other">(null);

  const ready = name.trim().length > 0 && myName.trim().length > 0
    && currency.length === 3 && !busy;

  async function save() {
    if (!ready) return;
    setBusy(true);
    setFailed(undefined);
    try {
      const { groupId } = await createGroup({
        name: name.trim(), baseCurrency: currency, myName: myName.trim(), otherNames: others,
      });
      router.replace(route.group(groupId));
    } catch (err) {
      setBusy(false);
      setFailed(errorText(err));
    }
  }

  return (
    <Screen>
      <Body>
        <TopBar title={copy.newGroup.title} back={route.groups()}
          right={<button className="action" onClick={save} disabled={!ready}>{copy.act.create}</button>} />
        <Scroll>
          <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <div className="field">
              <label htmlFor="g-name">{copy.newGroup.name}</label>
              <input id="g-name" value={name} autoFocus placeholder={copy.newGroup.namePlaceholder}
                onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="g-me">{copy.newGroup.you}</label>
              <input id="g-me" value={myName} placeholder={copy.newGroup.yourNamePlaceholder}
                onChange={(e) => setMyName(e.target.value)} />
            </div>
            <div className="field">
              <span className="fieldlabel" style={{ width: 62 }}>{copy.newGroup.currency}</span>
              <button type="button" id="g-cur" className="pick" aria-label={copy.newGroup.currency}
                onClick={() => setAsk("currency")}>
                <span className="ptext">{currencyLabel(currency)}</span>
                <Icon name="chev" size={13} className="spacer pchev" />
              </button>
            </div>
            {failed ? <Failure>{copy.newGroup.failed(failed)}</Failure> : null}
            <p className="hint">{copy.newGroup.currencyHint}</p>
          </div>

          <Eyebrow style={{ padding: "6px 16px 0" }}>{copy.newGroup.people}</Eyebrow>
          <div className="rows">
            {others.map((who, i) => (
              <div key={`${who}-${i}`} className="row">
                <div className="rmain"><div className="rtitle">{who}</div></div>
                <button className="iconbtn" aria-label={copy.members.removeLabel(who)}
                  onClick={() => setOthers((list) => list.filter((_, at) => at !== i))}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
            <AddName placeholder={copy.members.addPlaceholder}
              onAdd={(who) => setOthers((list) => [...list, who])} />
          </div>
        </Scroll>
      </Body>

      {ask === "currency" ? (
        <ChoiceDialog
          title={copy.currency.title}
          value={currency}
          options={[
            ...[...new Set([currency, ...COMMON_CURRENCIES])].map((c) => ({
              value: c, label: currencyLabel(c),
            })),
            { value: OTHER_CURRENCY, label: copy.currency.other, note: copy.currency.otherNote },
          ]}
          onPick={(c) => { if (c === OTHER_CURRENCY) setAsk("other"); else setCurrency(c); }}
          // "Other…" swaps one dialog for the next, so it can't close this one.
          onClose={() => setAsk((a) => (a === "other" ? a : null))}
        />
      ) : null}

      {ask === "other" ? (
        <PromptDialog title={copy.currency.title} placeholder={copy.currency.otherPlaceholder}
          confirm={copy.act.useIt} maxLength={3}
          autoCapitalize="characters" hint={copy.currency.otherHint}
          clean={normalizeCurrencyCode} valid={(v) => v.length === 3}
          onSubmit={(code) => { setCurrency(code); setAsk(null); }}
          onClose={() => setAsk(null)} />
      ) : null}
    </Screen>
  );
}
