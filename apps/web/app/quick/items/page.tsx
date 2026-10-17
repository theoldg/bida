"use client";
// Doc: docs/who-had-what.md

import { useRouter } from "next/navigation";
import { goBack, goUp } from "@/lib/nav";
import { useEffect, useRef } from "react";
import { Blank } from "@/components/chrome";
import { WhoHadWhat } from "@/components/who-had-what";
import { copy } from "@/lib/copy";
import { saveDraft, useDraft } from "@/lib/draft";
import { bare } from "@/lib/format";
import { route } from "@/lib/group-link";
import { useQuickPeople } from "@/lib/quick";
import { useScanCredential } from "@/lib/scan/credential";
import { usePrefetch } from "@/lib/prefetch";

/**
 * Who had what, on a bill that belongs to no group (ADR-0035). The same grid
 * the entry form's detour wears (`components/who-had-what.tsx`) — the columns
 * are the people typed on `/quick`, the figures are bare because nothing here
 * converts, and Done goes forward to the answer rather than back to a form.
 * Back keeps the bill and the ticks: `/quick` behind is where the people are
 * changed, and it opens back onto this grid.
 */
export default function QuickItemsPage() {
  const router = useRouter();
  usePrefetch([route.quickResult()]);
  const cred = useScanCredential();
  const people = useQuickPeople();
  const draft = useDraft(cred?.id);
  // Two people, as `/quick` asks before opening this: Forward can still arrive
  // after somebody was taken off the list behind.
  const ready = draft !== undefined && (draft.receiptItems?.length ?? 0) > 0 && people.length >= 2;

  // Nothing to assign means this screen was reached by a reload or a
  // bookmark, and a quick split does not survive either: the bill and the
  // people are in memory only. Back to `/quick` rather than draw an empty grid
  // — unwinding, so a `/quick` behind isn't doubled, and once: a second
  // unwind would step back past it.
  const sent = useRef(false);
  useEffect(() => {
    if (!cred || ready || sent.current) return;
    sent.current = true;
    goUp(route.quick(), (to) => router.replace(to));
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
      fixedTable={true}
      onBack={() => goBack(() => router.back(), (to) => router.replace(to))} />
  );
}
