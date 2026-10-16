"use client";
// Doc: docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/bits";
import { Blank, Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { ConfirmDialog, NoticeDialog } from "@/components/dialog";
import { FlipLabel } from "@/components/icons";
import { MemberBill } from "@/components/member-bill";
import { writeClipboardText } from "@/lib/clipboard";
import { copy } from "@/lib/copy";
import { clearDraft, useDraft } from "@/lib/draft";
import { bare } from "@/lib/format";
import { route } from "@/lib/group-link";
import { useFlash } from "@/lib/hooks";
import { goUp } from "@/lib/nav";
import {
  clearQuickPeople, markQuickLinkSent, quickLinkSecret, quickLinkSent, quickMessage, quickShares,
  quickSharedSplit, useQuickPeople,
} from "@/lib/quick";
import { useScanCredential } from "@/lib/scan/credential";
import { formatSplitLink, shareSplit } from "@/lib/split-link";

/**
 * What the bill came to, per person — the end of a quick split (ADR-0035).
 *
 * The figures are the grid's own (`receiptBill`, same seed), so the totals
 * watched while tapping are the totals here. Each row opens onto that
 * person's lines.
 *
 * It ends by handing it over as a few lines of text around a link
 * (`lib/split-link.ts`): the figures, sealed on this phone and stored under an
 * address the server can't read.
 */
export default function QuickResultPage() {
  const router = useRouter();
  const cred = useScanCredential();
  const people = useQuickPeople();
  const draft = useDraft(cred?.id);
  const [copied, setCopied] = useFlash();
  const [sending, setSending] = useState(false);
  // The message, shown to be held by hand, when the clipboard wouldn't take it.
  const [failed, setFailed] = useState<string>();
  const [notShared, setNotShared] = useState<"offline" | "unsent">();
  // Done is the end of the split and the end of the split is the end of the
  // bill: unless it went out as a link, leaving loses the evening's
  // arithmetic. Worth one question.
  const [asking, setAsking] = useState(false);

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

  const { totalMinor, shares } = quickShares(draft, people);
  const title = draft.description.trim();
  const split = quickSharedSplit(title, totalMinor, shares, draft.currency);
  const secret = quickLinkSecret(split);

  async function hand() {
    if (sending) return;
    const text = quickMessage(split, formatSplitLink(secret));
    // Already on the server: the clipboard is all that is left, and it needs
    // no network — so this works offline, and sends nothing twice.
    if (quickLinkSent(secret)) return copyAgain(text);
    // Said at once, and nothing copied: a link to a split that isn't there yet.
    if (navigator.onLine === false) return setNotShared("offline");
    setSending(true);
    // The secret is this phone's, so the link exists before the upload does —
    // and it has to be written now, inside the tap: Safari refuses a
    // clipboard written after an await. The upload runs beside it.
    const [copying, sent] = await Promise.allSettled([writeClipboardText(text), shareSplit(secret, split)]);
    setSending(false);
    if (sent.status !== "fulfilled" || sent.value !== "shared") return setNotShared("unsent");
    markQuickLinkSent(secret);
    landed(copying.status === "fulfilled", text);
  }

  async function copyAgain(text: string) {
    try {
      await writeClipboardText(text);
      landed(true, text);
    } catch {
      landed(false, text);
    }
  }

  function landed(ok: boolean, text: string) {
    if (ok) return setCopied(true);
    // The clipboard can be refused or absent (lib/clipboard.ts). An inert-looking
    // button is worse than none, so show the text instead, as
    // `components/invite.tsx` does.
    setFailed(text);
  }

  function done() {
    leaving.current = true;
    if (cred) clearDraft(cred.id);
    clearQuickPeople();
    // Unwind rather than push: the flow behind this screen is over, and nothing
    // in it survives the clearing above.
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
            {/* The label flips to a check (`FlipLabel`), on the button itself —
                nothing else here can say the clipboard took it. */}
            <button type="button" className="btn btn-p btn-lg" disabled={sending} onClick={() => void hand()}>
              {sending ? <span className="spinner" /> : null}
              <FlipLabel label={copy.quick.copy} done={copy.quick.copied} on={copied} />
            </button>
          </div>
          <div className="pad" style={{ paddingTop: 8, paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
            {/* The way out, in the secondary register: the act this screen
                exists for is the one above it. */}
            <button type="button" className="btn btn-s"
              onClick={() => (quickLinkSent(secret) ? done() : setAsking(true))}>
              {copy.quick.done}
            </button>
          </div>
        </Scroll>
      </Body>

      {asking ? (
        <ConfirmDialog title={copy.quick.doneTitle} confirm={copy.quick.done}
          danger={true} onConfirm={done} onClose={() => setAsking(false)}>
          <p>{copy.quick.discardBody}</p>
        </ConfirmDialog>
      ) : null}

      {failed ? (
        <NoticeDialog title={copy.quick.fallbackTitle} onClose={() => setFailed(undefined)}>
          <p>{copy.quick.fallbackBody}</p>
          {/* `.selectable` because the app turns selection off everywhere
              else — this is the text somebody has to be able to take. */}
          <p className="selectable quicktext">{failed}</p>
        </NoticeDialog>
      ) : null}

      {notShared ? (
        <NoticeDialog title={copy.quick.notShared.title} onClose={() => setNotShared(undefined)}>
          <p>{copy.quick.notShared[notShared]}</p>
        </NoticeDialog>
      ) : null}
    </Screen>
  );
}
