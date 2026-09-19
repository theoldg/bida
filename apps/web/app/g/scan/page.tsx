"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { ScanPair, useReceiptScan } from "@/components/receipt-scan";
import { ScanDiagram } from "@/components/scan-diagram";
import { BadLink, Blank, Body, Failure, QueryBoundary, Screen, Scroll, TopBar } from "@/components/chrome";
import { copy } from "@/lib/copy";
import { blankDraft, draftSeedKey, newEntryKey, seedDraft } from "@/lib/draft";
import { route } from "@/lib/group-link";
import { useClaimGate, useGroupData } from "@/lib/hooks";
import { useScanAs } from "@/lib/quick";
import { clearScan, getLiveScan } from "@/lib/scan/live";

/**
 * The scan, before there is a form — photographing the bill is how an expense
 * most often starts, so it is one tap rather than four down inside the split
 * editor. What comes back is an ordinary expense form, filled in, which you are
 * free to split evenly: **the scan reads what is printed, it does not decide how
 * the money divides** (ADR-0016).
 */
export default function ScanPage() {
  return <QueryBoundary><ScanScreen /></QueryBoundary>;
}

/** The key the entry form uses for a blank expense — see `newEntryKey`. */
const NEW_EXPENSE = newEntryKey("expense");

function ScanScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const unclaimed = useClaimGate(groupId, data);
  const scanAs = useScanAs(groupId);

  // `replace`, not push: this screen has done its job the moment the draft is
  // filled, and leaving it on the stack would put a second scan behind the
  // form's back arrow rather than the ledger.
  const scan = useReceiptScan(groupId, scanAs, () => {
    if (groupId) router.replace(route.addEntry(groupId));
  });

  /**
   * The draft the scan writes into.
   *
   * Seeded under the key the form uses for a blank expense, so the form adopts
   * this draft instead of re-seeding over it on arrival. An existing draft
   * under that key is left alone — somebody who typed half an expense, came
   * back out and reached for the camera keeps what they typed, and the scan's
   * own rule about not renaming an expense you named does the rest.
   */
  useEffect(() => {
    if (!groupId || data.loading || !data.group) return;
    if (draftSeedKey(groupId) === NEW_EXPENSE) return;
    const me = data.me ?? data.members[0]?.id;
    if (!me) return;
    seedDraft(groupId, blankDraft(
      "expense", me, data.group.baseCurrency, data.members.map((m) => m.id),
    ), NEW_EXPENSE);
  }, [groupId, data.loading, data.group, data.me, data.members]);

  /**
   * This screen shows a refusal once. Leaving it any way but a scan landing
   * (`onScanned`, which clears the error itself) means it has been read and
   * moved on from — most often to the ordinary "+", which seeds under this same
   * key and so would inherit the error too, putting a refusal nobody caused
   * under a scan button that never rang. **A scan still in flight is untouched**
   * — it belongs to the draft, not to this screen (`lib/scan/live.ts`).
   */
  useEffect(() => () => {
    if (groupId && getLiveScan(groupId)?.state === "error") clearScan(groupId);
  }, [groupId]);

  if (!groupId) return <BadLink />;
  if (!data.loading && !data.group) return <BadLink />;
  if (unclaimed || !data.group) return <Blank title={copy.scan.title} back={route.group(groupId)} />;

  return (
    <Screen>
      <Body>
        <TopBar title={copy.scan.title} sub={data.group.name} back={route.group(groupId)} />
        <Scroll>
          {scan.inputs}
          <div className="pad scanpage">
            {/* The one thing this screen can't show: where the photo goes.
                So it draws it — a bill, and the expense that comes back from
                it — and the control sits under the drawing rather than at the
                foot, so the picture and the act it explains are one block in
                the middle of the screen. The sentence this replaced is its
                `alt`. */}
            <div className="scanshow">
              <ScanDiagram names={data.members.map((m) => m.name)} seed={groupId} />

              {/* What the drawing can only imply, said once: the whole form
                  comes back filled, and the bill's own lines are a way to
                  split it. It belongs to the picture — hence inside the same
                  block, a line under it — and the screen's wide gap still
                  falls between that block and the control. */}
              <p className="scanlede">{copy.scan.lede}</p>
            </div>

            <div className="scanact">
              {/* This screen exists for this one act, so the control takes the
                  full width at `.btn-lg` and the primary register — the same
                  emphasis the entry form's Save gets, size being the only
                  emphasis this palette has left. */}
              <ScanPair scan={scan} register="lg" />

              {/* No "try again" beside the message: the control above it is
                  still enabled, and it is the retry. */}
              {scan.live?.state === "error"
                ? <Failure>{scan.live.error ?? copy.scan.failed}</Failure> : null}

              <p className="scanterms">{copy.scan.terms}</p>
            </div>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}
