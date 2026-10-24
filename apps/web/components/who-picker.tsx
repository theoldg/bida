"use client";

import { useRef, useState, type ReactNode } from "react";
import { nameTaken } from "@bida/core";
import { AddName, type AddNameHandle } from "./name-adder";
import { Icon } from "./icons";
import { Scroll } from "./chrome";
import { WriteBusy } from "./scan-bar";
import { copy } from "../lib/copy";

/** One name to pick from. On `/new` the id *is* the name — nothing is written
    yet, and names are unique on that list for the same reason they are in a
    group (core/names.ts). */
export interface Who {
  id: string;
  name: string;
}

/**
 * "Which one are you?" — the last step of joining, creating or importing a group,
 * one screen so the question reads the same every way. **Picking is a
 * selection, never a claim**: creating writes the group with this actor,
 * joining writes the claim op (ADR-0003), both on the button.
 *
 * **The button reads the add row as it is typed**: "Continue as M", "…as Ma",
 * and the tick steps aside meanwhile, back if the row is emptied. Pressed, it
 * files the name, which is the pick, and goes on in the same press — the label
 * has already said who. A name the list holds is that row, not a refusal.
 *
 * **Under the list, not in a `Foot`**, so it sits by the tap that lit it;
 * docked beside the scroller (`.whodock`), so a list too long to fit scrolls
 * above it. That is why the picker draws the screen's `Scroll` itself.
 * `.btn-lg`, like Create and Save (docs/design-system.md).
 */
export function WhoPicker({ people, picked, addPlaceholder, onPick, onAdd, onContinue, after, progress }: {
  people: readonly Who[];
  /** Whoever is already selected — a group re-opened from its invite link
      preselects the name this phone last claimed. */
  picked?: string;
  addPlaceholder: string;
  onPick: (id: string) => void;
  /**
   * Adds the name and returns it, which becomes the selection — you typed your
   * own name, so don't ask twice.
   */
  onAdd: (name: string) => Who | Promise<Who>;
  onContinue: (id: string) => void | Promise<void>;
  /** Drawn in the scroller under the list — a failure to report. */
  after?: ReactNode;
  /**
   * A write long enough to watch, an import's: the button becomes its bar, in
   * its place and its size, so nothing on the screen moves.
   */
  progress?: { percent: number; label: string };
}) {
  const [busy, setBusy] = useState(false);
  // Whoever the add row just filed. On `/g/claim` the row arrives via a Dexie
  // write on its own schedule, and the button must not sit blank meanwhile.
  const [added, setAdded] = useState<Who | null>(null);
  const adder = useRef<AddNameHandle | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const chosen = people.find((p) => p.id === picked)
    ?? (added?.id === picked ? added : undefined);
  const match = draft === null ? undefined : people.find((p) => nameTaken(draft, [p.name]));
  const shown = draft === null ? chosen : match ?? { id: "", name: draft };
  // Whoever the row's last filing picked, for the press that filed it.
  const filed = useRef<Who | null>(null);

  async function proceed() {
    if (busy || !shown) return;
    setBusy(true);
    try {
      let who: Who | null | undefined = chosen;
      if (draft !== null) who = await adder.current?.settle() === "filed" ? filed.current : null;
      if (who) await onContinue(who.id);
    } finally {
      setBusy(false);
    }
  }

  function pick(who: Who) {
    filed.current = who;
    onPick(who.id);
  }

  return (
    <>
      <Scroll>
        <h2 className="question">{copy.claim.title}</h2>
        <div className="rows">
          {/* Picking a name is the plainest way of saying the row being typed was
              a false start, so it goes — one question, one answer on screen. */}
          {people.map((p) => (
            // The check mark is a shape, and a shape says nothing to a screen
            // reader — without `aria-pressed` nothing on the row names the pick.
            <button key={p.id} className="row" aria-pressed={p.id === shown?.id}
              onClick={() => { adder.current?.clear(); onPick(p.id); }}>
              <div className="rmain">
                <div className="rtitle">{p.name}</div>
              </div>
              <span className="rmark">
                {p.id === shown?.id
                  ? <Icon name="check" size={16} style={{ color: "var(--brand)" }} />
                  : null}
              </span>
            </button>
          ))}

          {/* Filing a name here is picking it. A name already on the list is
              that row, and picks it. */}
          <AddName placeholder={addPlaceholder} taken={people.map((p) => p.name)} handle={adder}
            onDraft={setDraft}
            onTaken={(name) => {
              const who = people.find((p) => nameTaken(name, [p.name]));
              if (who) pick(who);
            }}
            onAdd={async (name) => {
              const who = await onAdd(name);
              setAdded(who);
              pick(who);
            }} />
        </div>
        {after}
      </Scroll>

      {/* Outside the scroller, so its rubber-band never moves the button. On
          `/g/claim` the "Have the app?" dock follows it. */}
      <div className="pad whodock">
        {progress ? (
          // The scan button's wait, so a long write looks like the one other.
          <WriteBusy percent={progress.percent} label={progress.label}
            box="btn-pair pair-p" button="btn btn-lg" />
        ) : (
          <button className="btn btn-p btn-lg" onClick={() => void proceed()} disabled={busy || !shown}>
            {shown ? copy.claim.continueAs(shown.name) : copy.claim.pickFirst}
          </button>
        )}
      </div>
    </>
  );
}
