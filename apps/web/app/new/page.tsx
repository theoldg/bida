"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Body, Screen, Scroll, TopBar } from "../../components/chrome";
import { COMMON_CURRENCIES, currencyLabel, normalizeCurrencyCode, OTHER_CURRENCY } from "../../lib/currencies";
import { createGroup } from "../../lib/db/commands";
import { route } from "../../lib/group-link";

export default function NewGroupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [myName, setMyName] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [customCurrency, setCustomCurrency] = useState("");
  const [busy, setBusy] = useState(false);

  const isCustom = currency === OTHER_CURRENCY;
  const resolvedCurrency = isCustom ? normalizeCurrencyCode(customCurrency) : currency;
  const ready = name.trim().length > 0 && myName.trim().length > 0
    && resolvedCurrency.length === 3 && !busy;

  async function save() {
    if (!ready) return;
    setBusy(true);
    try {
      const { groupId } = await createGroup({
        name: name.trim(), baseCurrency: resolvedCurrency, myName: myName.trim(),
      });
      router.replace(route.group(groupId));
    } catch (err) {
      setBusy(false);
      alert(err instanceof Error ? err.message : String(err));
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
              <label htmlFor="g-cur">Currency</label>
              <select id="g-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{currencyLabel(c)}</option>)}
                <option value={OTHER_CURRENCY}>Other…</option>
              </select>
            </div>
            {isCustom ? (
              <div className="field">
                <label htmlFor="g-cur-custom">Currency code</label>
                <input id="g-cur-custom" value={customCurrency} placeholder="e.g. UZS" maxLength={3}
                  autoFocus
                  onChange={(e) => setCustomCurrency(e.target.value)} />
              </div>
            ) : null}
            <p className="hint">
              Balances settle in this currency. An expense can be in any other, and
              keeps the rate it was entered at.
            </p>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}
