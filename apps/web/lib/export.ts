import { emptyGroupState, groupToCsv, type GroupState } from "@bida/core";
import { dateInputValue } from "./format";
import { iosHomeScreenApp } from "./install";
import type { GroupData } from "./hooks";

/**
 * Getting a group off the phone. The file is `core/export.ts`; this is the
 * platform part — its name, and how to hand it over.
 */

/**
 * The group as one CSV, in the base currency at current rates.
 *
 * From `memberById`, which keeps tombstones: a removed member named on a live
 * entry still carries a balance and needs a column for the file to add up.
 *
 * No rate registry: `useGroupData` has already repriced every entry
 * (`atCurrentRates`), and repricing twice is how screens disagree (ADR-0005).
 */
export function groupCsv(data: GroupData): string {
  const state: GroupState = {
    ...emptyGroupState(),
    group: data.group,
    members: Object.fromEntries([...data.memberById.values()].map((m) => [m.id, m])),
    expenses: Object.fromEntries(data.expenses.map((e) => [e.id, e])),
    settlements: Object.fromEntries(data.settlements.map((s) => [s.id, s])),
  };
  // The local day, the only honest one: an expense added at 23:00 must not
  // export as tomorrow. Same function the date field shows. The clock is read
  // here rather than passed in because it only dates the foot.
  return groupToCsv(state, { formatDay: dateInputValue, exportedAt: Date.now() });
}

/** `bida-marrakech-2026-09-17.csv` — the group and the day it left. */
export function exportFilename(groupName: string, now: number): string {
  const slug = groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `bida${slug ? `-${slug}` : ""}-${dateInputValue(now)}.csv`;
}

/**
 * What became of the file. `cancelled` is somebody closing the share sheet,
 * not a failure — never answer it with a fallback. Only `unavailable` means
 * nothing was handed over.
 */
type Handoff = "shared" | "downloaded" | "cancelled" | "unavailable";

/** How this browser can be asked to take a file. */
export type HandoffPlan = "share" | "download" | "text";

/**
 * Which rung of the ladder this browser is on.
 *
 * 1. **The share sheet** (`navigator.share` with a file) — the only way out of
 *    an iOS home-screen app, and the nicest anywhere. `text/csv` is allowed as
 *    a shared file; `application/json` isn't.
 * 2. **A download** — **never in an iOS home-screen app**, where (iOS 18.4)
 *    it replaces the app with an "Open in …" screen with no way back
 *    (docs/ios.md). An iOS *tab* is fine, hence `iosHomeScreenApp`.
 * 3. **The text**, on a screen (`/g/export`).
 *
 * Takes facts as arguments, like `offerFrom`.
 */
export function handoffPlan({ canShare, iosApp }: {
  canShare: boolean; iosApp: boolean;
}): HandoffPlan {
  if (canShare) return "share";
  return iosApp ? "text" : "download";
}

/**
 * Which rung this browser is on, without building a file. `/g/export` asks,
 * since a browser that could take a file can still land there.
 */
export function fileHandoff(): HandoffPlan {
  const probe = new File([""], "probe.csv", { type: "text/csv" });
  return handoffPlan({
    canShare: navigator.canShare?.({ files: [probe] }) ?? false,
    iosApp: iosHomeScreenApp(),
  });
}

/**
 * Hand the file over by the best means this browser has.
 *
 * **A rung is tried when the one above is unavailable, never as a retry after
 * it failed**: on iOS a download after a failed share strands somebody outside
 * the app. The exception is a share never delivered at all (below).
 */
export async function handOffCsv(filename: string, csv: string): Promise<Handoff> {
  const file = new File([csv], filename, { type: "text/csv" });
  const iosApp = iosHomeScreenApp();
  const canShare = navigator.canShare?.({ files: [file] }) ?? false;

  if (handoffPlan({ canShare, iosApp }) === "share") {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (err) {
      // Cancelling the sheet is an answer, not a fault: following it with a
      // fallback screen would be the app insisting after somebody said no.
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      // Anything else and the sheet never opened — a gesture it judged stale,
      // a platform that advertised the file type and then declined it. Nothing
      // was handed over, so carry on from the rung below.
    }
  }

  if (handoffPlan({ canShare: false, iosApp }) === "download") {
    download(filename, csv);
    return "downloaded";
  }
  return "unavailable";
}

function download(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Never revoked in the same turn: a browser that hasn't started reading the
  // blob cancels the download instead. No event says when it has, so this is a
  // timer, and the cost of it being wrong is one held blob.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
