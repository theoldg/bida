"use client";
// Doc: docs/who-had-what.md#a-split-by-days

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { settleRest } from "@bida/core";
import { editExpense } from "@/lib/db/commands";
import { goBack, goUp } from "@/lib/nav";
import { BadLink, Blank, QueryBoundary } from "@/components/chrome";
import { StayGrid } from "@/components/stay-grid";
import { copy } from "@/lib/copy";
import { parseEntrySource, route } from "@/lib/group-link";
import { useClaimGate, useGroupData } from "@/lib/hooks";
import { clearDraft, getDraft, saveDraft, splitSeed, useDraft } from "@/lib/draft";

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
  // Saving from the details screen's Edit: the draft goes once this screen does,
  // not before, or it would blank and send itself to the group on the way out.
  const leaving = useRef(false);
  useEffect(() => () => { if (leaving.current && groupId) clearDraft(groupId); }, [groupId]);

  // No draft: a reload or a bookmark. It is in memory only, so leave for the
  // group as `/g/entry/items` does.
  useEffect(() => {
    if (groupId && !data.loading && data.group && !unclaimed && !draft && !leaving.current) {
      router.replace(route.group(groupId));
    }
  }, [groupId, data.loading, data.group, unclaimed, draft, router]);

  if (!groupId) return <BadLink />;
  if (!data.loading && !data.group) return <BadLink />;
  if (unclaimed || !data.group || !draft) {
    return <Blank title={copy.stay.title} back={route.group(groupId)} />;
  }

  const back = () => goBack(() => router.back(), (to) => router.replace(to));
  // Opened by the details screen's Edit, back skips the form it passed through
  // and returns there; Done still lands on the form, which saves.
  const up = params.get("from") === "stay" && draft.entryId
    ? route.stay(groupId, draft.entryId, parseEntrySource(params.get("via"))) : undefined;
  return (
    <StayGrid
      people={data.members}
      draft={draft}
      save={(change) => saveDraft(groupId, change(getDraft(groupId) ?? draft))}
      up={up}
      doneLabel={up ? copy.act.save : undefined}
      onDone={up ? async () => {
        // The entry written here, as the form's Save would, then up to the details.
        const latest = getDraft(groupId);
        const saved = data.expenses.find((e) => e.id === latest?.entryId);
        if (leaving.current || !latest?.stay || !saved || !data.me) return;
        leaving.current = true;
        try {
          await editExpense(groupId, data.me, saved.id, {
            split: settleRest(saved.amountMinor, latest.stay, { tiebreakSeed: splitSeed(latest) }),
          });
        } catch { leaving.current = false; return; }
        goUp(up, (to) => router.replace(to));
      } : back}
      onBack={up ? () => goUp(up, (to) => router.replace(to)) : back} />
  );
}
