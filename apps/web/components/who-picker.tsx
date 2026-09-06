"use client";

import { useRef, useState } from "react";
import { AddName, type AddNameHandle } from "./name-adder";
import { Icon } from "./icons";
import { copy } from "../lib/copy";

/** One name to pick from. On `/new` the id *is* the name — nothing is written
    yet, and names are unique on that list for the same reason they are in a
    group (core/names.ts). */
export interface Who {
  id: string;
  name: string;
}

/**
 * "Which one is you?" — the last step of both ways into a group.
 *
 * Joining ends here because a link hands a device a group full of strangers and
 * no idea which one it speaks for. Creating ends here for the opposite reason:
 * you typed all of these names, so asking which is yours is one tap, where the
 * separate "You are" field it replaced was a second name box that meant the
 * same list twice and could disagree with itself.
 *
 * One screen for both, so the question is asked the same way whichever door you
 * came through — and so the answer costs the same nothing either side of it:
 * picking here is a selection, never a claim. Creating writes the group with
 * this name as its actor; joining writes the claim op (ADR-0003). Both happen
 * on the button, not on the tap.
 *
 * The button sits under the list rather than in a `Foot`, because it is the
 * next thing you do after tapping your name and not a fixture of the screen:
 * pinned to the bottom of a short list it read as unrelated to the tap that
 * had just lit it up.
 */
export function WhoPicker({ people, picked, addPlaceholder, onPick, onAdd, onContinue }: {
  people: readonly Who[];
  /** Whoever is already selected — a group re-opened from its invite link
      preselects the name this phone last claimed. */
  picked?: string;
  addPlaceholder: string;
  onPick: (id: string) => void;
  /** Adds the name and answers to what it added, which is then the selection:
      you typed your own name, so making it one more tap asks twice. */
  onAdd: (name: string) => Who | Promise<Who>;
  /** The pick, and the list as it stands — which is the prop plus whatever the
      field was still holding when the button was pressed. */
  onContinue: (id: string, people: readonly Who[]) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  // The name still in the add row, which the button below is as willing to
  // continue as anyone already on the list — it says so, rather than sitting
  // dead beside a field somebody has plainly just filled in.
  const [draft, setDraft] = useState<string | null>(null);
  const adder = useRef<AddNameHandle<Who> | null>(null);
  const chosen = people.find((p) => p.id === picked);

  async function proceed() {
    if (busy) return;
    setBusy(true);
    try {
      // The press files what is in the add row itself, rather than letting the
      // blur it would otherwise cause do it (components/name-adder.tsx).
      const added = await adder.current?.flush();
      // `added` can be somebody already on the list — the field takes a name
      // that matches as a way of picking them, so it is not always a new row.
      const all = added && !people.some((p) => p.id === added.id) ? [...people, added] : people;
      const who = added?.id ?? picked;
      if (!who) return;
      await onContinue(who, all);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="rows">
        {/* Keeps the caret in the add row rather than blurring it, because a
            blur files what is in it: half of "Nadia" and a tap on somebody
            else's name would otherwise put a member called "Nad" in the group.
            Picking a name is also the plainest way of saying the row was a
            false start, so it goes. */}
        {people.map((p) => (
          <button key={p.id} className="row" onMouseDown={(e) => e.preventDefault()}
            onClick={() => { adder.current?.clear(); onPick(p.id); }}>
            <div className="rmain">
              <div className="rtitle">{p.name}</div>
            </div>
            {/* A name in the add row outranks the tick for the button's label,
                so it outranks it here too: two answers to one question, one of
                them stale, is worse than none. The tick comes back the moment
                the field is empty again. */}
            <span className="rmark">
              {!draft && p.id === picked
                ? <Icon name="check" size={16} style={{ color: "var(--brand)" }} />
                : null}
            </span>
          </button>
        ))}

        {/* A name already on this list is you, not a clash: this is the list
            you are picking yourself out of (components/name-adder.tsx). */}
        <AddName placeholder={addPlaceholder} taken={people.map((p) => p.name)} duplicates="match"
          onAdd={onAdd} handle={adder} onDraft={setDraft} />
      </div>

      <div className="pad">
        {/* Keeps the field's focus, like the rows above. A blur files the name,
            and filing it *between* this press and its release is what killed
            this button: the list gains a row under the finger, and with the
            field emptied and nobody ticked the button disables itself — either
            way the release lands on something that is no longer this button, so
            no click is dispatched at all. The name was added and the press that
            added it did nothing, which is what a dead "Continue as Nadia" was.
            The press files it instead, in `proceed`. */}
        <button className="btn btn-p" onMouseDown={(e) => e.preventDefault()}
          onClick={() => void proceed()}
          disabled={busy || (!chosen && !draft)}>
          {/* The draft outranks the selection, because pressing files it and
              continues as it — most recent intent wins, and the label has to
              be the one that is about to happen. Clearing the field hands the
              button back to whoever is ticked. */}
          {draft || chosen
            ? copy.claim.continueAs(draft ?? chosen?.name ?? copy.someoneLower)
            : copy.claim.pickFirst}
        </button>
      </div>
    </>
  );
}
