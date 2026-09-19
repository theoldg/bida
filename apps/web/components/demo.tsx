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
 * **It does not fold and it does not dismiss** — a toast would be exactly that.
 * Every screen in the demo works, so "this is not yours" is not news that can
 * be delivered once and cleared; it stays put and says the one fact looking
 * around cannot: nothing here syncs. The way out is Clear the demo, in the
 * group menu.
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
      </div>
    </div>
  );
}

/**
 * The one thing the demo genuinely cannot do.
 *
 * A group is a secret link, and the demo has no secret — created without
 * `saveGroupKey`, which is the whole of why it never reaches the server. So the
 * invite link is absent, not withheld, and **Invite says so out loud**: the
 * rendering-nothing an absent link gets elsewhere would read here as a button
 * that does nothing.
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
