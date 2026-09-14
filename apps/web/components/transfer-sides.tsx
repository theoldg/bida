"use client";

import { useState } from "react";
import type { Member } from "@bida/core";
import { ChoiceDialog } from "./dialog";
import { Icon } from "./icons";
import { copy } from "../lib/copy";

/**
 * A transfer's two sides, and the one-tap reversal between them.
 *
 * Getting the direction the wrong way round is the mistake this form invites,
 * and it is one people make *after* picking both names — so the fix is the
 * arrow itself, which points the way the money goes and reverses it when
 * pressed, rather than two pickers you have to re-open in turn.
 *
 * Each half is labelled above the person: "From" then a face, which is the
 * order the sentence is read in. Tapping one opens our own picker rather than
 * the browser's wheel (ADR-0008) — which is what lets the person already on
 * the other side stay in the list, saying what picking them does: it swaps the
 * sides, the only reading of "send this to the person who is sending it" that
 * isn't the error message below.
 */
export function TransferSides({ members, from, to, onChange }: {
  members: Member[];
  from: string;
  to: string;
  onChange: (sides: { fromMember: string; toMember: string }) => void;
}) {
  const [picking, setPicking] = useState<null | "from" | "to">(null);
  // Same restart trick as lib/refusal.ts: alternate the class name so a
  // second swap replays the animation even while the first is still running.
  const [swapN, setSwapN] = useState(0);
  const swapClass = swapN === 0 ? "" : swapN % 2 === 1 ? " swap-a" : " swap-b";
  const byId = new Map(members.map((m) => [m.id, m]));

  const doSwap = () => {
    onChange({ fromMember: to, toMember: from });
    setSwapN((n) => n + 1);
  };

  const side = (which: "from" | "to") => {
    const member = byId.get(which === "from" ? from : to);
    return (
      <button type="button" className="tside" onClick={() => setPicking(which)}
        aria-label={which === "from" ? copy.form.sentBy : copy.form.receivedBy}>
        <span className="eyebrow">{which === "from" ? copy.entry.from : copy.entry.to}</span>
        <span className={"who" + swapClass}>{member?.name ?? copy.none}</span>
      </button>
    );
  };

  const pick = (id: string) => {
    if (!picking) return;
    // Picking the other side's person is a reversal, not an impossible transfer.
    const swap = picking === "from" ? id === to : id === from;
    if (swap) doSwap();
    else if (picking === "from") onChange({ fromMember: id, toMember: to });
    else onChange({ fromMember: from, toMember: id });
  };

  return (
    <div>
      <div className="card transfer">
        {side("from")}
        <button type="button" className="tswap" aria-label={copy.form.swapSides} onClick={doSwap}>
          <Icon name="arrow" size={18} />
        </button>
        {side("to")}
      </div>
      {from === to ? (
        <p className="failure" role="alert">{copy.form.sameSide}</p>
      ) : null}

      {picking ? (
        <ChoiceDialog
          title={picking === "from" ? copy.form.sentBy : copy.form.receivedBy}
          value={picking === "from" ? from : to}
          options={members.map((m) => ({
            value: m.id,
            label: m.name,
            note: (picking === "from" ? m.id === to : m.id === from) && from !== to
              ? copy.form.otherSide : undefined,
          }))}
          onPick={pick}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </div>
  );
}
