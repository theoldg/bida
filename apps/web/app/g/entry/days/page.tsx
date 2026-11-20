"use client";
// Doc: docs/who-had-what.md#a-split-by-days

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { goBack } from "@/lib/nav";
import { BadLink, Blank, QueryBoundary } from "@/components/chrome";
import { StayGrid } from "@/components/stay-grid";
import { copy } from "@/lib/copy";
import { route } from "@/lib/group-link";
import { useClaimGate, useGroupData } from "@/lib/hooks";
import { getDraft, saveDraft, useDraft } from "@/lib/draft";

/**
 * Who stayed when: the Days tab's calendar, a detour off the entry form as
 * who-had-what is (`/g/entry/items`), and for the same reason — it is a grid,
 * and the tab under the form only reads it out.
 */
export default function DaysPage() {
  return <QueryBoundary><DaysScreen /></QueryBoundary>;
}

function DaysScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const unclaimed = useClaimGate(groupId, data);
  const draft = useDraft(groupId);

  // No draft: a reload or a bookmark. It is in memory only, so leave for the
  // group as `/g/entry/items` does.
  useEffect(() => {
    if (groupId && !data.loading && data.group && !unclaimed && !draft) {
      router.replace(route.group(groupId));
    }
  }, [groupId, data.loading, data.group, unclaimed, draft, router]);

  if (!groupId) return <BadLink />;
  if (!data.loading && !data.group) return <BadLink />;
  if (unclaimed || !data.group || !draft) {
    return <Blank title={copy.stay.title} back={route.group(groupId)} />;
  }

  const back = () => goBack(() => router.back(), (to) => router.replace(to));
  return (
    <StayGrid
      people={data.members}
      draft={draft}
      save={(change) => saveDraft(groupId, change(getDraft(groupId) ?? draft))}
      onDone={back}
      onBack={back} />
  );
}
