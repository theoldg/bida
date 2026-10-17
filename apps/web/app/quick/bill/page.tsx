"use client";
// Doc: docs/receipt-scanning.md#typing-a-bill-in

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { goBack } from "@/lib/nav";
import { Blank } from "@/components/chrome";
import { BillEditor } from "@/components/bill-editor";
import { copy } from "@/lib/copy";
import { useDraft } from "@/lib/draft";
import { route } from "@/lib/group-link";
import { useScanCredential } from "@/lib/scan/credential";

/**
 * A quick split's bill typed by hand (ADR-0035). Done goes back to `/quick`,
 * as a scan stays there: the way on to the grid is that screen's to refuse.
 */
export default function QuickBillPage() {
  const router = useRouter();
  const cred = useScanCredential();
  const draft = useDraft(cred?.id);

  useEffect(() => {
    if (cred && !draft) router.replace(route.quick());
  }, [cred, draft, router]);

  if (!cred || !draft) return <Blank title={copy.scan.byHand.title} />;

  const back = () => goBack(() => router.back(), (to) => router.replace(to));
  return <BillEditor draftKey={cred.id} draft={draft} onSaved={back} onBack={back} />;
}
