"use client";
// Doc: docs/frontend.md#names

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Eyebrow, FieldLabel } from "@/components/bits";
import { Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { CreateAs } from "@/components/create-as";
import { CurrencyPicker } from "@/components/currency-picker";
import { ConfirmDialog } from "@/components/dialog";
import { Icon } from "@/components/icons";
import { AddName, type AddNameHandle } from "@/components/name-adder";
import { copy } from "@/lib/copy";
import { currencyLabel } from "@/lib/currencies";
import { createGroup } from "@/lib/db/commands";
import { db } from "@/lib/db/dexie";
import { route } from "@/lib/group-link";
import { useDevice } from "@/lib/hooks";
import { goUp } from "@/lib/nav";
import { flashClass, NOT_REFUSED, refused, type Refusal } from "@/lib/refusal";
import { NO_AUTOFILL } from "@/lib/autofill";

/**
 * The whole group, on one screen and then one question.
 *
 * **Every member is named here**, while the names are in your head, as one
 * run of typing. Nothing is written until the last button, so the list is
 * plain state, not ops.
 *
 * **Your own name is on that list, never in a field of its own** — a "You
 * are" box asks for the list twice and lets them disagree. So the screen ends
 * the way joining does: the picker asks which of these you are
 * (components/who-picker.tsx), and that member is the actor on every op that
 * creates the group. Asked even of a group of one, so the screen is learnable.
 */

/**
 * What a refused Create can bloom: an empty name blooms its field; an unfiled
 * name or an empty list blooms the add row (lib/refusal.ts).
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
  const [ask, setAsk] = useState<null | "currency" | "discard">(null);
  // The name still in the add row: something typed, so leaving with it on
  // screen is leaving with work unsaved. Create files it first
  // (components/name-adder.tsx).
  const [draft, setDraft] = useState<string | null>(null);
  const adder = useRef<AddNameHandle | null>(null);
  /**
   * The refusal flash, per field (`lib/refusal.ts`). **Create is always
   * tappable**: a tap that isn't ready blooms the reason. A name the list
   * already holds stays in the add row, and blooms it like an empty list.
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
   * row saying the fix landed early.
   */
  const settled = (field: Refusable) => (e?: React.AnimationEvent) => {
    if (e?.pseudoElement) return;
    setRefused((r) => ({ ...r, [field]: { ...r[field], live: false } }));
  };

  // A group typed here is only state, so leaving throws it away — worth the
  // same "discard?" the entry form asks, and the browser's on reload.
  const typed = name.trim().length > 0 || people.length > 0 || draft !== null;

  /**
   * Discard was answered, so this screen has stopped guarding the way out.
   * **Every asking screen must put its guard down before going** — the
   * browser's too, or a way back that leaves the page asks "Leave site?" after
   * "discard?". The entry form's draft goes only with the screen, and this
   * list lives in `useState` where `typed` stays true, so a traversal asked
   * for twice would ask "discard?" again (lib/nav.ts, lib/back-button.ts).
   */
  const leaving = useRef(false);
  useEffect(() => {
    if (!typed) return;
    const warn = (e: BeforeUnloadEvent) => { if (!leaving.current) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [typed]);

  function leave() {
    leaving.current = true;
    goUp(route.groups(), (to) => router.replace(to));
  }

  /** May we leave? Not with names on the screen — ask, and stay put. */
  function mayLeave() {
    if (leaving.current) return true;
    if (typed) { setAsk("discard"); return false; }
    return true;
  }

  /** Create: ask who you are — unless the form isn't ready to answer yet. */
  async function next() {
    // A name in the add row is filed first; one it refuses, or an empty list,
    // blooms that row rather than greying the button.
    const settled = await adder.current?.settle() ?? "empty";
    const nameMissing = name.trim().length === 0;
    const listMissing = settled === "refused" || people.length + (settled === "filed" ? 1 : 0) < 1;
    if (nameMissing || listMissing) {
      refuse({ name: nameMissing, list: listMissing });
      return;
    }
    setAsking(true);
  }

  /** Writes the group, and puts this screen's guard down: what was typed is saved, not lost. */
  async function create(me: string) {
    const { groupId } = await createGroup({
      name: name.trim(),
      baseCurrency: currency,
      myName: me,
      otherNames: people.filter((who) => who !== me),
    });
    leaving.current = true;
    return groupId;
  }

  if (asking) {
    return (
      <CreateAs title={copy.newGroup.named(name.trim())} names={people}
        onAdd={(who) => setPeople((list) => [...list, who])}
        onBack={() => setAsking(false)}
        create={create} failedText={copy.newGroup.failed} />
    );
  }

  return (
    <Screen>
      <Body>
        <TopBar title={copy.newGroup.title} back={{ ask: mayLeave, up: route.groups() }} />
        <Scroll>
          <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 9, paddingBottom: 10 }}>
            <div className={`field${flashClass(refusedFields.name)}`} onAnimationEnd={settled("name")}>
              <FieldLabel>{copy.newGroup.name}</FieldLabel>
              {/* The same cap every name in the app has: a member's is 40, and
                  a group drawn beside them has no more room than they do. */}
              <input data-field="g-name" aria-label={copy.newGroup.name} value={name} autoFocus maxLength={40}
                autoComplete={NO_AUTOFILL} enterKeyHint="next"
                placeholder={copy.newGroup.namePlaceholder}
                onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <span className="fieldlabel">{copy.newGroup.currency}</span>
              <button type="button" id="g-cur" className="pick" aria-label={copy.newGroup.currency}
                onClick={() => setAsk("currency")}>
                <span className="ptext">{currencyLabel(currency)}</span>
                <Icon name="updown" size={18} className="spacer pchev" />
              </button>
            </div>
          </div>

          <Eyebrow style={{ padding: "6px var(--gutter) 0" }}>{copy.newGroup.people}</Eyebrow>
          <div className="rows">
            {people.map((who, i) => (
              <div key={`${who}-${i}`} className="row">
                <div className="rmain"><div className="rtitle">{who}</div></div>
                <button className="rmark rdrop" aria-label={copy.members.removeLabel(who)}
                  onClick={() => setPeople((list) => list.filter((_, at) => at !== i))}>
                  <Icon name="cross" size={14} />
                </button>
              </div>
            ))}
            <AddName placeholder={copy.members.addPlaceholder} taken={people} handle={adder}
              onAdd={(who) => setPeople((list) => [...list, who])}
              onDraft={setDraft}
              flash={flashClass(refusedFields.list)} onFlashEnd={settled("list")} />
          </div>
        </Scroll>
        {/* The screen's one act, docked under the form (`.whodock`), so a long
            list of people scrolls above it rather than pushing it off. Never
            grey: a blank name or empty list points at itself (design-system.md). */}
        <div className="pad whodock" style={{ paddingTop: 18 }}>
          <button type="button" className="btn btn-p btn-lg" onClick={() => void next()}
            disabled={refusing}>
            {copy.act.create}
          </button>
        </div>
      </Body>

      {ask === "discard" ? (
        <ConfirmDialog title={copy.newGroup.discardTitle} confirm={copy.act.discard}
          danger={true} onConfirm={leave} onClose={() => setAsk(null)}>
          <p>{copy.newGroup.discardBody}</p>
        </ConfirmDialog>
      ) : null}

      {ask === "currency" ? (
        <CurrencyPicker value={currency} first={[currency]}
          onPick={setCurrency} onClose={() => setAsk(null)} />
      ) : null}
    </Screen>
  );
}
