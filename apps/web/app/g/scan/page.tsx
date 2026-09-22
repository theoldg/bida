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
 * The scan, before there is a form — one tap, since a photo is how an expense
 * most often starts. What comes back is an ordinary filled-in form: **the scan
 * reads what is printed, it doesn't decide how the money divides** (ADR-0016).
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
   * The draft the scan writes into, seeded under the form's blank-expense key so
   * the form adopts it. An existing draft there is left alone, so half-typed
   * work survives reaching for the camera.
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
   * Leaving by any way but a scan landing clears the refusal — otherwise the
   * ordinary "+", seeding under this same key, would inherit it. **A scan still
   * in flight is untouched**: it belongs to the draft (`lib/scan/live.ts`).
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
            {/* Drawn, not described: a bill and the expense it becomes, with the
                control under it so picture and act are one block. Its `alt` says
                it in words. */}
            <div className="scanshow">
              <ScanDiagram names={data.members.map((m) => m.name)} seed={groupId} />

              {/* What the drawing can only imply: the whole form comes back filled.
                  Inside the picture's block, so the wide gap still falls before the
                  control. */}
              <p className="scanlede">{copy.scan.lede}</p>
            </div>

            <div className="scanact">
              {/* Full width at `.btn-lg`, the emphasis of the form's Save.

                  Two doors, not three: the picture promises a photograph, and a typed
                  bill goes into the form's Items tab. */}
              <ScanPair scan={scan} register="lg" typeIn={false} />

              {/* No "try again" beside the message: the control above it is
                  still enabled, and it is the retry. */}
              {scan.refusal ? <Failure>{scan.refusal}</Failure> : null}

              <p className="scanterms">{copy.scan.terms}</p>
            </div>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}
