"use client";

import { useRef, useState } from "react";
import { AddName, type AddNameHandle } from "./name-adder";
import { keepsFocus } from "./bits";
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
 * "Which one are you?" — the last step of both ways into a group.
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
 * The button answers to the tick and to nothing else. A name still being typed
 * in the add row is not an answer to the question — it is a name being typed,
 * and a button that rewrote itself with every keystroke was reading intent out
 * of a field nobody had pressed anything on. Filing that name is the plus's
 * job (components/name-adder.tsx); what this screen does is take the row that
 * arrives and tick it, because a name you typed into the list you are picking
 * yourself out of is the pick.
 *
 * The button sits under the list rather than in a `Foot`, because it is the
 * next thing you do after tapping your name and not a fixture of the screen:
 * pinned to the bottom of a short list it read as unrelated to the tap that
 * had just lit it up. A list too long for the screen is the other case, and
 * `.whodock` is sticky for it — the button stops at the foot of the scroller
 * and the names scroll under it. It is the act the screen exists for, so it is
 * the same `.btn-lg` register as Create and Save (docs/design-system.md).
 */
export function WhoPicker({ people, picked, addPlaceholder, onPick, onAdd, onContinue }: {
  people: readonly Who[];
  /** Whoever is already selected — a group re-opened from its invite link
      preselects the name this phone last claimed. */
  picked?: string;
  /** Only with `onAdd`: there is no row to place it over otherwise. */
  addPlaceholder?: string;
  onPick: (id: string) => void;
  /**
   * Adds the name and answers to what it added, which is then the selection:
   * you typed your own name, so making it one more tap asks twice.
   *
   * Left out where the list is not ours to add to. An import's list is the
   * columns of somebody else's file (`app/import/page.tsx`), and a name with
   * no column in it has no balance to be, so that screen asks which of these
   * you are and offers no way to be a fourth.
   */
  onAdd?: (name: string) => Who | Promise<Who>;
  onContinue: (id: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  // Whoever the add row just filed. A row of the list is what it becomes, but
  // on `/g/claim` that is a Dexie write arriving on its own schedule, and the
  // button must not sit blank in the meantime saying to pick a name that has
  // just been picked.
  const [added, setAdded] = useState<Who | null>(null);
  const adder = useRef<AddNameHandle | null>(null);
  const chosen = people.find((p) => p.id === picked)
    ?? (added?.id === picked ? added : undefined);

  async function proceed() {
    if (busy || !picked) return;
    setBusy(true);
    try {
      await onContinue(picked);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="rows">
        {/* Picking a name is the plainest way of saying the row being typed was
            a false start, so it goes — one question, one answer on screen. */}
        {people.map((p) => (
          // The check mark is a shape, and a shape says nothing to a screen
          // reader: without `aria-pressed` the only thing that named the pick
          // was the button at the foot of the screen.
          <button key={p.id} className="row" aria-pressed={p.id === picked}
            onClick={() => { adder.current?.clear(); onPick(p.id); }} {...keepsFocus}>
            <div className="rmain">
              <div className="rtitle">{p.name}</div>
            </div>
            <span className="rmark">
              {p.id === picked
                ? <Icon name="check" size={16} style={{ color: "var(--brand)" }} />
                : null}
            </span>
          </button>
        ))}

        {/* Filing a name here is picking it: you typed your own name into the
            list you are picking yourself out of, so asking again would be
            asking twice. A name the list already holds cannot be filed — it is
            a row a tap away, and that tap is the same answer. */}
        {onAdd ? (
          <AddName placeholder={addPlaceholder ?? ""} taken={people.map((p) => p.name)} handle={adder}
            onAdd={async (name) => {
              const who = await onAdd(name);
              setAdded(who);
              onPick(who.id);
            }} />
        ) : null}
      </div>

      {/* Under the list, and sticky once the list is longer than the screen:
          it is the next thing you do after tapping your name, so on a short
          list it sits right under the tap that lit it up — pinned to the
          bottom there, it read as unrelated to it. On a group of twenty it
          would be off the bottom instead, so it stops at the foot of the
          scroller and the names pass underneath. Opaque, or they'd show
          through it. `bottom: 0` is the scroller's own foot, which on
          `/g/claim` is above the "Have the app?" dock, never over it. */}
      <div className="pad whodock">
        <button className="btn btn-p btn-lg" onClick={() => void proceed()} disabled={busy || !chosen}
          {...keepsFocus}>
          {chosen ? copy.claim.continueAs(chosen.name) : copy.claim.pickFirst}
        </button>
      </div>
    </>
  );
}
