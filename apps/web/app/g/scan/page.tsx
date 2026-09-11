"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useReceiptScan } from "../../../components/receipt-scan";
import { BadLink, Blank, Body, Failure, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { Icon } from "../../../components/icons";
import { copy } from "../../../lib/copy";
import { blankDraft, draftSeedKey, newEntryKey, seedDraft } from "../../../lib/draft";
import { route } from "../../../lib/group-link";
import { useClaimGate, useGroupData, useGroupSecret } from "../../../lib/hooks";

/**
 * The scan, before there is a form.
 *
 * Photographing the bill is how an expense most often starts, and it used to
 * be four taps down: "+", then the split editor, then its fourth tab, then
 * the camera. This is that act with nothing else on the screen — and what
 * comes back is an ordinary expense form, filled in, which you are free to
 * split evenly. The scan reads what is printed; it does not decide how the
 * money divides (ADR-0016).
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
  const secret = useGroupSecret(groupId);

  // `replace`, not push: this screen has done its job the moment the draft is
  // filled, and leaving it on the stack would put a second scan behind the
  // form's back arrow rather than the ledger.
  const scan = useReceiptScan(groupId, secret, () => {
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

  if (!groupId) return <BadLink />;
  if (!data.loading && !data.group) return <BadLink />;
  if (unclaimed || !data.group) return <Blank title={copy.scan.title} back={route.group(groupId)} />;

  const busy = scan.state === "scanning";

  return (
    <Screen>
      <Body>
        <TopBar title={copy.scan.title} sub={data.group.name} back={route.group(groupId)} />
        <Scroll>
          {scan.inputs}
          <div className="pad" style={{ paddingTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
            <button type="button" className="btn btn-p" disabled={scan.disabled || busy}
              onClick={scan.openCamera}>
              {busy && scan.source === "camera"
                ? <span className="spinner" aria-hidden="true" /> : <Icon name="cam" size={17} />}
              {busy && scan.source === "camera" ? copy.scan.reading : copy.scan.takePhoto}
            </button>
            <button type="button" className="btn btn-s" disabled={scan.disabled || busy}
              onClick={scan.openLibrary}>
              {busy && scan.source === "library"
                ? <span className="spinner" aria-hidden="true" /> : <Icon name="image" size={17} />}
              {busy && scan.source === "library" ? copy.scan.reading : copy.scan.upload}
            </button>

            {/* No "try again" beside the message: the two buttons above it are
                still enabled, and one of them is the retry. */}
            {scan.state === "error" ? <Failure>{scan.error ?? copy.scan.failed}</Failure> : null}

            <p style={{ fontSize: 12.5, color: "var(--ink-2)", margin: "6px 0 0", lineHeight: 1.45 }}>
              {copy.scan.blurb}
            </p>
            <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>
              {copy.scan.freeTier}
            </p>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}
