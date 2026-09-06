"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isCurrencyCode } from "@hajsik/core";
import { Eyebrow } from "../../components/bits";
import { Body, Failure, Screen, Scroll, TopBar } from "../../components/chrome";
import { ChoiceDialog, ConfirmDialog, PromptDialog } from "../../components/dialog";
import { Icon } from "../../components/icons";
import { AddName, type AddNameHandle } from "../../components/name-adder";
import { WhoPicker } from "../../components/who-picker";
import { copy } from "../../lib/copy";
import { COMMON_CURRENCIES, currencyLabel, normalizeCurrencyCode, OTHER_CURRENCY } from "../../lib/currencies";
import { createGroup } from "../../lib/db/commands";
import { errorText } from "../../lib/format";
import { route } from "../../lib/group-link";
import { goUp } from "../../lib/nav";

/**
 * The whole group, on one screen and then one question.
 *
 * The others used to be somebody else's problem: create, land on an empty
 * ledger, find People, add four names one dialog at a time. They belong here —
 * the names are in your head at exactly this moment, and typing them is one
 * uninterrupted run down the same list they'll appear in. Nothing is written
 * until the last button, so this list is plain state, not ops.
 *
 * Your own name is on that list rather than in a field of its own. A separate
 * "You are" box asked for the same list twice and let the two disagree, and it
 * put the question at the top of the screen, before there was a list to answer
 * it with. So the screen ends the way joining a group ends — the same picker,
 * asking which of these people you are (components/who-picker.tsx) — and
 * whoever is picked is the group's first member and the actor on every op that
 * creates it. One name typed skips the question: it can only be you.
 */
export default function NewGroupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [people, setPeople] = useState<string[]>([]);
  const [currency, setCurrency] = useState("EUR");
  const [asking, setAsking] = useState(false);
  const [picked, setPicked] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();
  const [ask, setAsk] = useState<null | "currency" | "other" | "discard">(null);
  // The name still in the add row. It counts as a person for everything below:
  // typing the only member of a group and finding Create dead beside it is the
  // failure the row was rebuilt to stop (components/name-adder.tsx).
  const [draft, setDraft] = useState<string | null>(null);
  const adder = useRef<AddNameHandle<string> | null>(null);

  // A group typed here is state and nothing else — no draft store, nothing in
  // Dexie — so both ways off this screen throw it away. The entry form asks
  // before it does that and lets the browser ask on a reload; a list of names
  // somebody just typed is worth the same courtesy.
  const typed = name.trim().length > 0 || people.length > 0 || draft !== null;
  useEffect(() => {
    if (!typed) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [typed]);

  function leave() {
    goUp(route.groups(), (to) => router.replace(to));
  }

  /** May we leave? Not with names on the screen — ask, and stay put. */
  function mayLeave() {
    if (typed && !busy) { setAsk("discard"); return false; }
    return true;
  }

  const ready = name.trim().length > 0 && currency.length === 3 && !busy
    && (people.length > 0 || draft !== null);

  /** Create: file whatever the add row is still holding, then ask who you are
      — unless the answer can only be one person. */
  async function next() {
    if (!ready) return;
    const added = await adder.current?.flush();
    const all = added ? [...people, added] : people;
    const only = all.length === 1 ? all[0] : undefined;
    if (only !== undefined) await save(only, all);
    else if (all.length > 0) setAsking(true);
  }

  async function save(me: string, all: readonly string[]) {
    setBusy(true);
    setFailed(undefined);
    try {
      const { groupId } = await createGroup({
        name: name.trim(),
        baseCurrency: currency,
        myName: me,
        otherNames: all.filter((who) => who !== me),
      });
      router.replace(route.group(groupId));
    } catch (err) {
      setBusy(false);
      setAsking(false);
      setFailed(errorText(err));
    }
  }

  if (asking) {
    return (
      <Screen>
        <Body>
          <TopBar title={copy.claim.title} sub={name.trim()}
            back={{ ask: () => { setAsking(false); return false; } }} />
          <Scroll>
            <WhoPicker
              people={people.map((who) => ({ id: who, name: who }))}
              picked={picked}
              addPlaceholder={copy.members.addPlaceholder}
              onPick={setPicked}
              // Typing a name that is already on the list picks that person
              // rather than listing them twice — nothing is written yet, so
              // "adding" them here is only a way of saying which one is you.
              onAdd={(who) => {
                setPeople((list) => (list.includes(who) ? list : [...list, who]));
                return { id: who, name: who };
              }}
              onContinue={(who, all) => save(who, all.map((p) => p.name))}
            />
          </Scroll>
        </Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <Body>
        <TopBar title={copy.newGroup.title} back={{ ask: mayLeave, up: route.groups() }}
          right={<button className="action" onClick={() => void next()} disabled={!ready}>
            {copy.act.create}
          </button>} />
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
            {people.map((who, i) => (
              <div key={`${who}-${i}`} className="row">
                <div className="rmain"><div className="rtitle">{who}</div></div>
                <button className="iconbtn" aria-label={copy.members.removeLabel(who)}
                  onClick={() => setPeople((list) => list.filter((_, at) => at !== i))}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
            <AddName placeholder={copy.members.addPlaceholder} taken={people}
              onAdd={(who) => { setPeople((list) => [...list, who]); return who; }}
              handle={adder} onDraft={setDraft} />
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
