"use client";
// Doc: docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SharedSplit } from "@bida/core";
import { Card } from "@/components/bits";
import { Blank, Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { ConfirmDialog, NoticeDialog } from "@/components/dialog";
import { FlipLabel } from "@/components/icons";
import { MemberBill } from "@/components/member-bill";
import { writeClipboardText } from "@/lib/clipboard";
import { copy } from "@/lib/copy";
import { useDraft } from "@/lib/draft";
import { bare, figure } from "@/lib/format";
import { route } from "@/lib/group-link";
import { useFlash } from "@/lib/hooks";
import { goUp } from "@/lib/nav";
import {
  markQuickLinkHanded, quickLinkHanded, quickLinkSecret, quickLinkSent, quickMessage, quickShares,
  quickSharedSplit, sendQuickLink, useQuickPeople,
} from "@/lib/quick";
import { useScanCredential } from "@/lib/scan/credential";
import { formatSplitLink, shareSplit } from "@/lib/split-link";

/** How long a press waits on an upload still on its way before saying so. */
const GRACE_MS = 500;

function send(secret: string, split: SharedSplit): Promise<boolean> {
  return sendQuickLink(secret, async () => (await shareSplit(secret, split)) === "shared");
}

/**
 * What the bill came to, per person — the end of a quick split (ADR-0035).
 *
 * The figures are the grid's own (`receiptBill`, same seed), so the totals
 * watched while tapping are the totals here. Each row shows that person's
 * lines, and a tap on their total copies it.
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
  // The message, shown to be held by hand, when the clipboard wouldn't take it.
  const [failed, setFailed] = useState<string>();
  const [notShared, setNotShared] = useState<"offline" | "unsent">();
  // Done is the end of the split and the end of the split is the end of the
  // bill: unless it went out as a link, leaving loses the evening's
  // arithmetic. Worth one question.
  const [asking, setAsking] = useState(false);

  const ready = draft !== undefined && (draft.receiptItems?.length ?? 0) > 0;
  // A reload loses a quick split — it is a draft, and no draft in this app
  // outlives its screens. Start again rather than show an empty answer.
  // Once, unwinding, as the grid does.
  const sent = useRef(false);
  useEffect(() => {
    if (!cred || ready || sent.current) return;
    sent.current = true;
    goUp(route.quick(), (to) => router.replace(to));
  }, [cred, ready, router]);

  const answer = draft && ready ? quickShares(draft, people) : undefined;
  const title = draft?.description.trim() ?? "";
  const split = draft && answer
    ? quickSharedSplit(title, answer.totalMinor, answer.shares, draft.currency) : undefined;
  const secret = split ? quickLinkSecret(split) : undefined;

  // Sent as the answer appears, not when it is asked for, so that copying is
  // the whole wait. A failed one goes again when the phone is back online.
  useEffect(() => {
    if (!split || !secret) return;
    const again = () => void send(secret, split);
    again();
    window.addEventListener("online", again);
    return () => window.removeEventListener("online", again);
    // `split` is new every render; `secret` is what changes when it does.
  }, [secret]);

  if (!cred || !draft || !answer || !split || !secret) return <Blank title={copy.quick.split} />;
  const { totalMinor, shares } = answer;

  async function hand() {
    if (!split || !secret) return;
    const text = quickMessage(split, formatSplitLink(secret));
    // Said at once, and nothing copied: a link to a split that isn't there yet.
    if (!quickLinkSent(secret) && navigator.onLine === false) return setNotShared("offline");
    // The secret is this phone's, so the link exists before the upload does —
    // and it has to be written now, inside the tap: Safari refuses a
    // clipboard written after an await.
    const copying = copyAgain(text);
    // Usually landed long ago. If not, it gets a moment more; past that the
    // check has said copied, and this says the link won't open yet.
    const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), GRACE_MS));
    const sent = await Promise.race([send(secret, split), timeout]);
    await copying;
    if (sent) return markQuickLinkHanded(secret);
    // The text on screen would hold a link that won't open: this outranks it.
    setFailed(undefined);
    setNotShared(navigator.onLine === false ? "offline" : "unsent");
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
    // Unwind rather than push: the flow behind this screen is over, and nothing
    // in it survives leaving it (quick/layout.tsx).
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
                  fixed={{ copy: figure(share.minor, draft.currency) }} />
              ))}
            </Card>
          </div>

          {/* The one act this screen exists for, and then the way out. */}
          <div className="pad" style={{ paddingTop: 18 }}>
            {/* The label flips to a check (`FlipLabel`), on the button itself —
                nothing else here can say the clipboard took it. */}
            <button type="button" className="btn btn-p btn-lg" onClick={() => void hand()}>
              <FlipLabel icon="copy" label={copy.quick.copy.label} iconSays={copy.quick.copy.verb}
                done={copy.quick.copied} on={copied} />
            </button>
          </div>
          <div className="pad" style={{ paddingTop: 8, paddingBottom: "var(--dock-foot)" }}>
            {/* The way out, in the secondary register: the act this screen
                exists for is the one above it. */}
            <button type="button" className="btn btn-s"
              onClick={() => (quickLinkHanded(secret) ? done() : setAsking(true))}>
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
