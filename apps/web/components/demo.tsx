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
 * The mark: a thin card above the ledger, in the shape of the install offer
 * that sits in the same place (`LedgerInstall`).
 *
 * **It does not fold and it does not dismiss.** Every screen in the demo works
 * — the entry form saves, the balances settle, the export writes a file — so
 * "this is not yours" is not news that can be delivered once and cleared. A
 * toast would be exactly that. It stays put instead, and the way out is on it
 * in words: clearing is one item down in the group menu.
 *
 * Renders nothing for every other group, so the ledger can mount it unasked.
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
        <p className="hint" style={{ marginTop: 3, textWrap: "balance" }}>{copy.demo.body}</p>
      </div>
    </div>
  );
}

/**
 * The one thing the demo genuinely cannot do.
 *
 * A group is a secret link, and the demo has no secret: it was created without
 * `saveGroupKey`, which is the whole of why it never reaches the server. So
 * the invite link does not exist — not withheld, absent — and Invite has to
 * say so out loud. Rendering nothing instead, which is what an absent link
 * gets everywhere else in the app, would read as a button that does nothing.
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
