"use client";

import { isDemo } from "@bida/core";
import { copy } from "../lib/copy";
import { Dialog } from "./dialog";
import { Icon } from "./icons";

/**
 * What the demo group says about itself, on the two screens that have to say
 * it: the mark at the head of its ledger, and the refusal behind Invite.
 */

/**
 * The mark: a thin card above the ledger, shaped like the install offer in
 * the same place (`LedgerInstall`).
 *
 * **It doesn't fold or dismiss** — the one fact looking around can't reveal,
 * that nothing here syncs, stays true the whole visit. The way out is Clear
 * the demo, in the group menu. Renders nothing for other groups.
 */
export function DemoCard({ groupId }: { groupId: string }) {
  if (!isDemo(groupId)) return null;
  return (
    <div className="pad" style={{ paddingBottom: 4 }}>
      <div className="card demomark">
        <div className="eyebrow demomarkhead">
          <Icon name="info" size={13} />
          {copy.demo.title}
        </div>
      </div>
    </div>
  );
}

/**
 * The one thing the demo can't do: it has no secret (no `saveGroupKey`), so
 * no invite link. **Invite says so out loud** — rendering nothing, as an
 * absent link does elsewhere, would read here as a dead button.
 */
export function DemoNoLink({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title={copy.demo.noLink.title} onClose={onClose}>
      <div className="dbody"><p>{copy.demo.noLink.body}</p></div>
      <div className="drow">
        <button className="btn btn-p" onClick={onClose}>{copy.act.close}</button>
      </div>
    </Dialog>
  );
}
