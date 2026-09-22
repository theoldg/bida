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
 * "Which one are you?" — the last step of both joining and creating a group,
 * one screen so the question reads the same either way. **Picking is a
 * selection, never a claim**: creating writes the group with this actor,
 * joining writes the claim op (ADR-0003), both on the button.
 *
 * **The button answers to the tick and nothing else** — never to a name
 * half-typed in the add row. Filing that name is the plus's job
 * (components/name-adder.tsx), and the filed row is then ticked.
 *
 * **Under the list, not in a `Foot`**, so it sits by the tap that lit it;
 * `.whodock` is sticky for lists too long to fit. `.btn-lg`, like Create and
 * Save (docs/design-system.md).
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
   * Adds the name and returns it, which becomes the selection — you typed your
   * own name, so don't ask twice.
   *
   * Omitted where the list isn't ours: an import's people are the file's
   * columns (`app/import/page.tsx`), and a name outside them has no balance.
   */
  onAdd?: (name: string) => Who | Promise<Who>;
  onContinue: (id: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  // Whoever the add row just filed. On `/g/claim` the row arrives via a Dexie
  // write on its own schedule, and the button must not sit blank meanwhile.
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
          // reader — without `aria-pressed` nothing on the row names the pick.
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

        {/* Filing a name here is picking it. A name already on the list can't be
            filed — its row is the same answer. */}
        {onAdd ? (
          <AddName placeholder={addPlaceholder ?? ""} taken={people.map((p) => p.name)} handle={adder}
            onAdd={async (name) => {
              const who = await onAdd(name);
              setAdded(who);
              onPick(who.id);
            }} />
        ) : null}
      </div>

      {/* Sticky once the list outgrows the screen: stops at the scroller's
          foot with names passing under. Opaque, or they'd show through.
          `bottom: 0` is the scroller's foot, which on `/g/claim` is above the
          "Have the app?" dock. */}
      <div className="pad whodock">
        <button className="btn btn-p btn-lg" onClick={() => void proceed()} disabled={busy || !chosen}
          {...keepsFocus}>
          {chosen ? copy.claim.continueAs(chosen.name) : copy.claim.pickFirst}
        </button>
      </div>
    </>
  );
}
