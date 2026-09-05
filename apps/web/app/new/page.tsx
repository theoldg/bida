"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isCurrencyCode } from "@hajsik/core";
import { Eyebrow } from "../../components/bits";
import { Body, Failure, Screen, Scroll, TopBar } from "../../components/chrome";
import { ChoiceDialog, ConfirmDialog, PromptDialog } from "../../components/dialog";
import { Icon } from "../../components/icons";
import { AddName } from "../../components/name-adder";
import { copy } from "../../lib/copy";
import { COMMON_CURRENCIES, currencyLabel, normalizeCurrencyCode, OTHER_CURRENCY } from "../../lib/currencies";
import { createGroup } from "../../lib/db/commands";
import { errorText } from "../../lib/format";
import { route } from "../../lib/group-link";
import { nameTaken } from "../../lib/names";
import { goUp } from "../../lib/nav";

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
  const [ask, setAsk] = useState<null | "currency" | "other" | "discard">(null);

  // A group typed here is state and nothing else — no draft store, nothing in
  // Dexie — so both ways off this screen throw it away. The entry form asks
  // before it does that and lets the browser ask on a reload; a list of names
  // somebody just typed is worth the same courtesy.
  const typed = name.trim().length > 0 || myName.trim().length > 0 || others.length > 0;
  useEffect(() => {
    if (!typed) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [typed]);

  function leave() {
    goUp(route.groups(), (to) => router.replace(to));
  }

  function goBack() {
    if (typed && !busy) { setAsk("discard"); return; }
    leave();
  }

  // Your own name is on the same list as everyone else's, so it plays by the
  // same rule: one Ana, and the app can tell people apart everywhere it only
  // ever shows a name (lib/names.ts).
  const clash = nameTaken(myName, others);
  const ready = name.trim().length > 0 && myName.trim().length > 0
    && !clash && currency.length === 3 && !busy;

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
        <TopBar title={copy.newGroup.title} back={goBack}
          right={<button className="action" onClick={save} disabled={!ready}>{copy.act.create}</button>} />
        <Scroll>
          <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <div className="field">
              <label htmlFor="g-name">{copy.newGroup.name}</label>
              {/* The same cap every name in the app has: a member's is 40, and
                  a group drawn beside them has no more room than they do. */}
              <input id="g-name" value={name} autoFocus maxLength={40}
                placeholder={copy.newGroup.namePlaceholder}
                onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="g-me">{copy.newGroup.you}</label>
              <input id="g-me" value={myName} maxLength={40}
                placeholder={copy.newGroup.yourNamePlaceholder}
                onChange={(e) => setMyName(e.target.value)} />
            </div>
            {clash ? <Failure>{copy.members.taken(myName.trim())}</Failure> : null}
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
            <AddName placeholder={copy.members.addPlaceholder} taken={[myName, ...others]}
              onAdd={(who) => setOthers((list) => [...list, who])} />
          </div>
        </Scroll>
      </Body>

      {ask === "discard" ? (
        <ConfirmDialog title={copy.newGroup.discardTitle} confirm={copy.act.discard}
          danger={true} onConfirm={leave} onClose={() => setAsk(null)}>
          <p>{copy.newGroup.discardBody}</p>
        </ConfirmDialog>
      ) : null}

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
          autoCapitalize="characters"
          clean={normalizeCurrencyCode} valid={isCurrencyCode}
          onSubmit={(code) => { setCurrency(code); setAsk(null); }}
          onClose={() => setAsk(null)} />
      ) : null}
    </Screen>
  );
}
