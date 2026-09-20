"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isCurrencyCode } from "@bida/core";
import { Eyebrow, keepsFocus } from "@/components/bits";
import { Body, Failure, Screen, Scroll, TopBar } from "@/components/chrome";
import { ChoiceDialog, ConfirmDialog, PromptDialog } from "@/components/dialog";
import { Icon } from "@/components/icons";
import { AddName } from "@/components/name-adder";
import { WhoPicker } from "@/components/who-picker";
import { copy } from "@/lib/copy";
import { currencyChoices, currencyLabel, normalizeCurrencyCode, OTHER_CURRENCY } from "@/lib/currencies";
import { createGroup } from "@/lib/db/commands";
import { db } from "@/lib/db/dexie";
import { errorText } from "@/lib/format";
import { route } from "@/lib/group-link";
import { useDevice } from "@/lib/hooks";
import { goUp } from "@/lib/nav";
import { flashClass, NOT_REFUSED, refused, type Refusal } from "@/lib/refusal";

/**
 * The whole group, on one screen and then one question.
 *
 * **Every member is named here**, not found later under People: the names are
 * in your head at exactly this moment, and typing them is one uninterrupted run
 * down the same list they'll appear in. Nothing is written until the last
 * button, so this list is plain state, not ops.
 *
 * **Your own name is on that list, never in a field of its own** — a separate
 * "You are" box asks for the same list twice, lets the two disagree, and puts
 * the question above the list that answers it. So the screen ends the way
 * joining a group ends: the same picker, asking which of these people you are
 * (components/who-picker.tsx), and whoever is picked is the group's first
 * member and the actor on every op that creates it. Asked even of a group of
 * one — the answer is written into every op, and a screen that sometimes skips
 * the question is a screen you cannot learn.
 */

/**
 * What a refused Create can bloom: an empty name blooms the field itself,
 * the same way an empty title does on the entry form, and a name still
 * sitting unfiled in the add row or nobody on the list yet blooms the plus
 * that fixes either — two different problems, so two fields to remember
 * (lib/refusal.ts).
 */
const REFUSABLE = ["name", "list"] as const;
type Refusable = typeof REFUSABLE[number];

export default function NewGroupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [people, setPeople] = useState<string[]>([]);
  const [currency, setCurrency] = useState("EUR");
  // Defaults to whatever currency the group you last opened uses — most people
  // stay on one trip, one currency, at a time — falling back to EUR for a
  // phone with no groups yet, or one whose last-opened group has since gone.
  const device = useDevice();
  useEffect(() => {
    const lastGroupId = device?.lastOpenedGroupId;
    if (!lastGroupId) return;
    let cancelled = false;
    void db().groups.get(lastGroupId).then((group) => {
      if (!cancelled && group) setCurrency(group.baseCurrency);
    });
    return () => { cancelled = true; };
  }, [device?.lastOpenedGroupId]);
  const [asking, setAsking] = useState(false);
  const [picked, setPicked] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();
  const [ask, setAsk] = useState<null | "currency" | "other" | "discard">(null);
  // The name still in the add row. Nothing acts on it — only its own plus files
  // it (components/name-adder.tsx) — but it is something typed, so leaving with
  // it on screen is leaving with work unsaved.
  const [draft, setDraft] = useState<string | null>(null);
  /**
   * The refusal flash, per field (`lib/refusal.ts`) — same shape as the entry
   * form's. **Create is always tappable**: a tap that isn't ready blooms the
   * reason (`REFUSABLE`) rather than doing nothing.
   *
   * The group is written in one go, so a name left in the add row when Create
   * lands is a person who was never in it — same as an empty list.
   */
  const [refusedFields, setRefused] = useState<Record<Refusable, Refusal>>({
    name: NOT_REFUSED, list: NOT_REFUSED,
  });
  const refuse = (fields: Partial<Record<Refusable, boolean>>) =>
    setRefused((r) => {
      const next = { ...r };
      for (const f of REFUSABLE) if (fields[f]) next[f] = refused(r[f]);
      return next;
    });
  /** A refusal is still on screen, so Create is spent for exactly as long. */
  const refusing = REFUSABLE.some((f) => refusedFields[f].live);
  /**
   * The flash is over. Only the control's own animation counts — a
   * `pseudoElement` event is somebody else's — and no event at all is the add
   * row saying the fix landed before the animation ran out.
   */
  const settled = (field: Refusable) => (e?: React.AnimationEvent) => {
    if (e?.pseudoElement) return;
    setRefused((r) => ({ ...r, [field]: { ...r[field], live: false } }));
  };

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

  /**
   * Discard was answered, so this screen has stopped guarding the way out.
   *
   * **Every screen that asks has to put this down before it goes**, and the
   * ones that keep their work somewhere have it for free: the entry form's
   * Discard clears the draft, and `mayLeave` reads the draft. A list of names
   * held in `useState` has nothing to clear — `typed` is still true the whole
   * way out — so without this the guard answers the going itself, and a
   * traversal that has to be asked for twice is asked "discard?" the second
   * time (lib/nav.ts, lib/back-button.ts).
   */
  const leaving = useRef(false);

  function leave() {
    leaving.current = true;
    goUp(route.groups(), (to) => router.replace(to));
  }

  /** May we leave? Not with names on the screen — ask, and stay put. */
  function mayLeave() {
    if (leaving.current) return true;
    if (typed && !busy) { setAsk("discard"); return false; }
    return true;
  }

  /** Create: ask who you are — unless the form isn't ready to answer yet. */
  function next() {
    if (busy) return;
    // A name still in the add row is not a person on the list: it has not
    // been filed, and the box it sits in says so. Neither is an empty list a
    // group — one person is enough, but zero isn't. Both bloom their own
    // control rather than holding the button grey.
    const nameMissing = name.trim().length === 0;
    const listMissing = draft !== null || people.length < 1;
    if (nameMissing || listMissing) {
      refuse({ name: nameMissing, list: listMissing });
      return;
    }
    setAsking(true);
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
              // A name already on the list cannot be filed here either — it
              // is a row a tap above, and tapping it says the same thing.
              onAdd={(who) => {
                setPeople((list) => [...list, who]);
                return { id: who, name: who };
              }}
              onContinue={(who) => save(who, people)}
            />
          </Scroll>
        </Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <Body>
        <TopBar title={copy.newGroup.title} back={{ ask: mayLeave, up: route.groups() }} />
        <Scroll>
          {/* The hint the currency row used to carry is gone; its bottom
              margin is not, so the Members eyebrow still clears the field. */}
          <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 9, paddingBottom: 10 }}>
            <div className={`field${flashClass(refusedFields.name)}`} onAnimationEnd={settled("name")}>
              <label htmlFor="g-name">{copy.newGroup.name}</label>
              {/* The same cap every name in the app has: a member's is 40, and
                  a group drawn beside them has no more room than they do. */}
              <input id="g-name" value={name} autoFocus maxLength={40}
                enterKeyHint="next"
                placeholder={copy.newGroup.namePlaceholder}
                onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <span className="fieldlabel" style={{ width: 62 }}>{copy.newGroup.currency}</span>
              <button type="button" id="g-cur" className="pick" aria-label={copy.newGroup.currency}
                onClick={() => setAsk("currency")} {...keepsFocus}>
                <span className="ptext">{currencyLabel(currency)}</span>
                <Icon name="chev" size={13} className="spacer pchev" />
              </button>
            </div>
          </div>

          <Eyebrow style={{ padding: "6px 16px 0" }}>{copy.newGroup.people}</Eyebrow>
          <div className="rows">
            {people.map((who, i) => (
              <div key={`${who}-${i}`} className="row">
                <div className="rmain"><div className="rtitle">{who}</div></div>
                <button className="iconbtn" aria-label={copy.members.removeLabel(who)}
                  onClick={() => setPeople((list) => list.filter((_, at) => at !== i))}
                  {...keepsFocus}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
            <AddName placeholder={copy.members.addPlaceholder} taken={people}
              onAdd={(who) => setPeople((list) => [...list, who])}
              onDraft={setDraft}
              flash={flashClass(refusedFields.list)} onFlashEnd={settled("list")} />
          </div>

          {/* The screen's one act, at the foot of the form rather than an
              underlined word in the corner — same button as the entry form's
              Save, and for the same reason: beside a back arrow it read as
              optional. It scrolls with the fields, so the keyboard under a
              name being typed never sits on it. Never grey: a blank name or
              an empty list points at itself instead of holding the button
              dead with no reason on screen (design-system.md). */}
          <div className="pad" style={{ paddingTop: 18, paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
            {failed ? <Failure>{copy.newGroup.failed(failed)}</Failure> : null}
            <button type="button" className="btn btn-p btn-lg" onClick={next}
              disabled={busy || refusing} {...keepsFocus}>
              {copy.act.create}
            </button>
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
            ...currencyChoices([currency]).map((c) => ({
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
