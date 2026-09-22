"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/bits";
import { Blank, Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { ConfirmDialog, Dialog } from "@/components/dialog";
import { Icon } from "@/components/icons";
import { MemberBill } from "@/components/member-bill";
import { writeClipboardText } from "@/lib/clipboard";
import { copy } from "@/lib/copy";
import { clearDraft, useDraft } from "@/lib/draft";
import { bare } from "@/lib/format";
import { route } from "@/lib/group-link";
import { useBillEnglish } from "@/lib/hooks";
import { goUp } from "@/lib/nav";
import {
  clearQuickPeople, quickShares, quickSummaryText, useQuickPeople, useScanCredential,
} from "@/lib/quick";

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
  // The grid's translation toggle reaches here: the answer, and the text it is
  // handed over as, read in whichever language the bill was left in.
  const english = useBillEnglish();
  const draft = useDraft(cred?.id);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  // Done is the end of the split and the end of the split is the end of the
  // bill: nothing here is written anywhere, so leaving without the text
  // copied loses the evening's arithmetic. Worth one question.
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const ready = draft !== undefined && (draft.receiptItems?.length ?? 0) > 0;
  // Leaving on purpose throws the split away too, and "left" and "arrived with
  // nothing" are the same state one tick apart. **Mark the way out**, or the
  // redirect below wins the race and sends anybody leaving back to the start.
  const leaving = useRef(false);
  // A reload loses a quick split — it is a draft, and no draft in this app
  // outlives its screens. Start again rather than show an empty answer.
  useEffect(() => {
    if (cred && !ready && !leaving.current) router.replace(route.quick());
  }, [cred, ready, router]);

  if (!cred || !draft || !ready) return <Blank title={copy.quick.split} />;

  const { totalMinor, shares } = quickShares(draft, people, english);
  const title = draft.description.trim();
  const text = quickSummaryText(title, totalMinor, shares, draft.currency);

  async function hand() {
    try {
      await writeClipboardText(text);
      setCopied(true);
    } catch {
      // The clipboard is refused on an insecure context or a denied
      // permission, and absent altogether in some in-app browsers
      // (lib/clipboard.ts). A button that looks inert is worse than no button:
      // put the text on screen to be read instead (`components/invite.tsx`
      // does the same for the one other string this app hands over).
      setFailed(true);
    }
  }

  function done() {
    leaving.current = true;
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
                  format={(minor) => bare(minor, draft.currency)}
                  startOpen={true} />
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
            {/* The way out, in the secondary register: the act this screen
                exists for is the one above it. */}
            <button type="button" className="btn btn-s" onClick={() => setAsking(true)}>
              {copy.act.done}
            </button>
          </div>
        </Scroll>
      </Body>

      {asking ? (
        <ConfirmDialog title={copy.quick.doneTitle} confirm={copy.act.done}
          danger={true} onConfirm={done} onClose={() => setAsking(false)}>
          <p>{copy.quick.discardBody}</p>
        </ConfirmDialog>
      ) : null}

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
