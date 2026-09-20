"use client";

import { useRouter } from "next/navigation";
import { goBack } from "@/lib/nav";
import { useEffect } from "react";
import { Blank } from "@/components/chrome";
import { WhoHadWhat } from "@/components/who-had-what";
import { copy } from "@/lib/copy";
import { saveDraft, useDraft } from "@/lib/draft";
import { bare } from "@/lib/format";
import { route } from "@/lib/group-link";
import { useQuickPeople, useScanCredential } from "@/lib/quick";

/**
 * Who had what, on a bill that belongs to no group (ADR-0035). The same grid
 * the entry form's detour wears (`components/who-had-what.tsx`) — the columns
 * are the people typed on `/quick`, the figures are bare because nothing here
 * converts, and Done goes forward to the answer rather than back to a form.
 */
export default function QuickItemsPage() {
  const router = useRouter();
  const cred = useScanCredential();
  const people = useQuickPeople();
  const draft = useDraft(cred?.id);
  const ready = draft !== undefined && (draft.receiptItems?.length ?? 0) > 0 && people.length > 0;

  // Nothing to assign means this screen was reached by a reload or a
  // bookmark, and a quick split does not survive either: the bill and the
  // people are in memory only. Start again rather than draw an empty grid.
  useEffect(() => {
    if (cred && !ready) router.replace(route.quick());
  }, [cred, ready, router]);

  if (!cred || !draft || !ready) return <Blank title={copy.items.title} />;

  return (
    <WhoHadWhat
      title={copy.items.title}
      people={people}
      draft={draft}
      save={(next) => saveDraft(cred.id, next)}
      format={(minor) => bare(minor, draft.currency)}
      saysCurrency={false}
      onDone={() => router.push(route.quickResult())}
      onBack={() => goBack(() => router.back())} />
  );
}
