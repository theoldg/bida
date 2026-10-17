"use client";
// Doc: docs/receipt-scanning.md#typing-a-bill-in

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { goBack } from "@/lib/nav";
import { BadLink, Blank, QueryBoundary } from "@/components/chrome";
import { BillEditor } from "@/components/bill-editor";
import { copy } from "@/lib/copy";
import { route } from "@/lib/group-link";
import { useClaimGate, useGroupData } from "@/lib/hooks";
import { useDraft } from "@/lib/draft";

/**
 * The bill typed by hand, a detour off the entry form's Items tab like the
 * grid (`app/g/entry/items`). Both ways off it are back onto the form.
 */
export default function BillPage() {
  return <QueryBoundary><BillScreen /></QueryBoundary>;
}

function BillScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const unclaimed = useClaimGate(groupId, data);
  const draft = useDraft(groupId);

  // No draft: a reload or a bookmark, and a draft is memory only. As the grid does.
  useEffect(() => {
    if (groupId && !data.loading && data.group && !unclaimed && !draft) {
      router.replace(route.group(groupId));
    }
  }, [groupId, data.loading, data.group, unclaimed, draft, router]);

  if (!groupId) return <BadLink />;
  if (!data.loading && !data.group) return <BadLink />;
  if (unclaimed || !data.group || !draft) {
    return <Blank title={copy.scan.byHand.title} back={route.group(groupId)} />;
  }

  const back = () => goBack(() => router.back(), (to) => router.replace(to));
  return <BillEditor draftKey={groupId} draft={draft} onSaved={back} onBack={back} />;
}
