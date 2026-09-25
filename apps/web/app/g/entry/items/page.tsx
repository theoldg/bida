"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { goBack } from "@/lib/nav";
import { BadLink, Blank, Body, Empty, QueryBoundary, Screen, TopBar } from "@/components/chrome";
import { WhoHadWhat } from "@/components/who-had-what";
import { copy } from "@/lib/copy";
import { money } from "@/lib/format";
import { parseEntrySource, route } from "@/lib/group-link";
import { useClaimGate, useGroupData } from "@/lib/hooks";
import { saveDraft, useDraft } from "@/lib/draft";

/**
 * Who had what, filled from a receipt scan and reopenable later via "Edit
 * who-had-what" (ADR-0016). Its own screen rather than a mode inside the
 * split editor — a different question ("who ate this") from "how does the
 * total divide" — and it ends by writing the grid onto the draft, so nothing
 * downstream needs to know a scan was involved.
 *
 * The grid itself is `components/who-had-what.tsx`, which the quick-split
 * flow wears too (ADR-0035). What is left here is this door's own business:
 * the group, the claim gate, and a bill with no lines on it.
 */
export default function ItemsPage() {
  return <QueryBoundary><ItemsScreen /></QueryBoundary>;
}

function ItemsScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  // Held, not read: this screen is a detour off the entry form, and the form's
  // `via` has to survive it or saving lands somewhere else than it would have
  // (lib/group-link.ts).
  const via = parseEntrySource(params.get("via"));
  const data = useGroupData(groupId);
  const unclaimed = useClaimGate(groupId, data);
  const draft = useDraft(groupId);

  // No draft at all: reached by a reload, a bookmark, or a forward press onto
  // an entry since saved. A draft is in memory only (lib/draft.ts), so nothing
  // is coming back — **leave for the group** rather than sit as a titled blank
  // over a back arrow a cold load has nowhere to take. The quick split's grid
  // does the same one route over (app/quick/items).
  useEffect(() => {
    if (groupId && !data.loading && data.group && !unclaimed && !draft) {
      router.replace(route.group(groupId));
    }
  }, [groupId, data.loading, data.group, unclaimed, draft, router]);

  // The id check every screen under `/g` makes (docs/navigation.md#routing):
  // `data.group` is `undefined` while the read is in flight and again when
  // there is no such group, and only the second of those is a bad link.
  if (!groupId) return <BadLink />;
  if (!data.loading && !data.group) return <BadLink />;
  if (unclaimed || !data.group || !draft) {
    return <Blank title={copy.items.title} back={route.group(groupId)} />;
  }

  if ((draft.receiptItems?.length ?? 0) === 0) {
    return (
      <Screen><Body>
        <TopBar title={copy.items.title}
          back={draft.entryId ? route.editEntry(groupId, draft.entryId, via)
            : route.addEntry(groupId, draft.kind, via)} />
        <Empty title={copy.items.none.title}>{copy.items.none.body}</Empty>
      </Body></Screen>
    );
  }

  return (
    <WhoHadWhat
      title={copy.items.title}
      people={data.members}
      draft={draft}
      save={(next) => saveDraft(groupId, next)}
      format={(minor) => money(minor, draft.currency)}
      // Both ways off this screen are the way back onto the form, which is
      // where it was opened from: only what has been written down differs.
      onDone={() => goBack(() => router.back(), (to) => router.replace(to))}
      onBack={() => goBack(() => router.back(), (to) => router.replace(to))} />
  );
}
