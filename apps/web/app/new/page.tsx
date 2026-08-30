"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Body, Failure, Screen, Scroll, TopBar } from "../../components/chrome";
import { ChoiceDialog, PromptDialog } from "../../components/dialog";
import { Icon } from "../../components/icons";
import { COMMON_CURRENCIES, currencyLabel, normalizeCurrencyCode, OTHER_CURRENCY } from "../../lib/currencies";
import { createGroup } from "../../lib/db/commands";
import { errorText } from "../../lib/format";
import { route } from "../../lib/group-link";

export default function NewGroupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [myName, setMyName] = useState("");
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
        name: name.trim(), baseCurrency: currency, myName: myName.trim(),
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
        <TopBar title="New group" back={route.groups()}
          right={<button className="action" onClick={save} disabled={!ready}>Create</button>} />
        <Scroll>
          <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <div className="field">
              <label htmlFor="g-name">Name</label>
              <input id="g-name" value={name} autoFocus placeholder="Group name"
                onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="g-me">You are</label>
              <input id="g-me" value={myName} placeholder="Your name"
                onChange={(e) => setMyName(e.target.value)} />
            </div>
            <div className="field">
              <span className="fieldlabel" style={{ width: 62 }}>Currency</span>
              <button type="button" id="g-cur" className="pick" aria-label="Currency"
                onClick={() => setAsk("currency")}>
                <span className="ptext">{currencyLabel(currency)}</span>
                <Icon name="chev" size={13} className="spacer pchev" />
              </button>
            </div>
            {failed ? <Failure>Couldn&rsquo;t create the group — {failed}</Failure> : null}
            <p className="hint">
              Balances settle in this currency. An expense can be in any other, and
              keeps the rate it was entered at.
            </p>
          </div>
        </Scroll>
      </Body>

      {ask === "currency" ? (
        <ChoiceDialog
          title="Currency"
          value={currency}
          options={[
            ...[...new Set([currency, ...COMMON_CURRENCIES])].map((c) => ({
              value: c, label: currencyLabel(c),
            })),
            { value: OTHER_CURRENCY, label: "Other…", note: "any three-letter code" },
          ]}
          onPick={(c) => { if (c === OTHER_CURRENCY) setAsk("other"); else setCurrency(c); }}
          // "Other…" swaps one dialog for the next, so it can't close this one.
          onClose={() => setAsk((a) => (a === "other" ? a : null))}
        />
      ) : null}

      {ask === "other" ? (
        <PromptDialog title="Currency" placeholder="UZS" confirm="Use it" maxLength={3}
          autoCapitalize="characters" hint="A three-letter ISO code."
          clean={normalizeCurrencyCode} valid={(v) => v.length === 3}
          onSubmit={(code) => { setCurrency(code); setAsk(null); }}
          onClose={() => setAsk(null)} />
      ) : null}
    </Screen>
  );
}
