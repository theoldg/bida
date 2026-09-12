"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "../../../components/bits";
import { Blank, Body, Screen, Scroll, TopBar } from "../../../components/chrome";
import { Dialog } from "../../../components/dialog";
import { Icon } from "../../../components/icons";
import { MemberBill } from "../../../components/member-bill";
import { copy } from "../../../lib/copy";
import { clearDraft, useDraft } from "../../../lib/draft";
import { bare } from "../../../lib/format";
import { route } from "../../../lib/group-link";
import { goUp } from "../../../lib/nav";
import {
  clearQuickPeople, quickShares, quickSummaryText, useQuickPeople, useScanCredential,
} from "../../../lib/quick";

/**
 * What the bill came to, per person — the end of a quick split (ADR-0035).
 *
 * The figures are the grid's own, read off `receiptBill` under the same seed,
 * so the totals somebody watched add up while tapping are the totals here.
 * Each row opens onto that person's own lines, which is the concrete reading
 * of a figure, exactly as a scanned expense's rows do inside a group.
 *
 * It ends by handing the whole thing over as text. No link and no image: a
 * link has to carry the bill somewhere, and this is the one flow that puts
 * nothing anywhere.
 */
export default function QuickResultPage() {
  const router = useRouter();
  const cred = useScanCredential();
  const people = useQuickPeople();
  const draft = useDraft(cred?.id);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const ready = draft !== undefined && (draft.receiptItems?.length ?? 0) > 0;
  // A reload loses a quick split — it is a draft, and no draft in this app
  // outlives its screens. Start again rather than show an empty answer.
  useEffect(() => {
    if (cred && !ready) router.replace(route.quick());
  }, [cred, ready, router]);

  if (!cred || !draft || !ready) return <Blank title={copy.quick.split} />;

  const { totalMinor, shares } = quickShares(draft, people);
  const title = draft.description.trim();
  const text = quickSummaryText(title, totalMinor, shares, draft.currency);

  async function hand() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // The clipboard is refused on an insecure context or a denied
      // permission, and a button that looks inert is worse than no button:
      // put the text on screen to be read instead (`components/invite.tsx`
      // does the same for the one other string this app hands over).
      setFailed(true);
    }
  }

  function done() {
    if (cred) clearDraft(cred.id);
    clearQuickPeople();
    // Unwind rather than push: the three screens behind this one are a flow
    // that is now over, and nothing in them survives the clearing above.
    goUp(route.groups(), (to) => router.replace(to));
  }

  return (
    <Screen>
      <Body>
        <TopBar title={copy.quick.split} sub={title || undefined} back={true} />
        <Scroll>
          <div className="pad" style={{ paddingTop: 2 }}>
            <span className="bignum" style={{ fontSize: 32 }}>{bare(totalMinor, draft.currency)}</span>
          </div>

          <div className="pad" style={{ paddingTop: 2 }}>
            <Card>
              {shares.map((share) => (
                <MemberBill key={share.name} name={share.name}
                  total={bare(share.minor, draft.currency)}
                  lines={share.lines}
                  format={(minor) => bare(minor, draft.currency)} />
              ))}
            </Card>
          </div>

          {/* The one act this screen exists for, and then the way out. */}
          <div className="pad" style={{ paddingTop: 18 }}>
            <button type="button" className="btn btn-p btn-lg" onClick={() => void hand()}>
              {copied ? <Icon name="check" size={16} /> : null}
              {copied ? copy.quick.copied : copy.quick.copy}
            </button>
          </div>
          <div className="pad" style={{ paddingTop: 8, paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
            <button type="button" className="btn" onClick={done}>{copy.act.done}</button>
          </div>
        </Scroll>
      </Body>

      {failed ? (
        <Dialog title={copy.quick.fallbackTitle} onClose={() => setFailed(false)}>
          <div className="dbody">
            <p>{copy.quick.fallbackBody}</p>
            {/* `.selectable` because the app turns selection off everywhere
                else — this is the text somebody has to be able to take. */}
            <p className="selectable quicktext">{text}</p>
          </div>
          <div className="drow">
            <button className="btn btn-p" onClick={() => setFailed(false)}>{copy.act.close}</button>
          </div>
        </Dialog>
      ) : null}
    </Screen>
  );
}
