import { emptyGroupState, groupToCsv, type GroupState } from "@bida/core";
import { dateInputValue } from "./format";
import { iosHomeScreenApp } from "./install";
import type { GroupData } from "./hooks";

/**
 * Getting a group off the phone.
 *
 * The file itself is `core/export.ts`; this is the part with a platform in it —
 * what to call it, and how to hand it to somebody.
 */

/**
 * The group as one CSV, in the group's base currency at the registry's
 * current rates.
 *
 * Built from `memberById` rather than `members`, because that map is the one
 * that keeps tombstones: a removed member still named on a live entry still
 * carries a balance, and needs the column that makes the file add up.
 * `core`'s `alive()` filters the rest back out.
 *
 * The rate registry is deliberately not passed along. `useGroupData` has
 * already repriced every entry it hands over (`atCurrentRates`), so the
 * figures here are the ones on screen — and a second repricing is the way one
 * screen ends up disagreeing with another (ADR-0005).
 */
export function groupCsv(data: GroupData): string {
  const state: GroupState = {
    ...emptyGroupState(),
    group: data.group,
    members: Object.fromEntries([...data.memberById.values()].map((m) => [m.id, m])),
    expenses: Object.fromEntries(data.expenses.map((e) => [e.id, e])),
    settlements: Object.fromEntries(data.settlements.map((s) => [s.id, s])),
  };
  // The local day, which is the only honest one: an expense added at 23:00
  // must not export as tomorrow. Same function the date field shows. The clock
  // is read here rather than taken as an argument because it only dates the
  // foot — nothing on a screen depends on it, and both callers would pass
  // `Date.now()`.
  return groupToCsv(state, { formatDay: dateInputValue, exportedAt: Date.now() });
}

/** `bida-marrakech-2026-09-17.csv` — the group and the day it left. */
export function exportFilename(groupName: string, now: number): string {
  const slug = groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `bida${slug ? `-${slug}` : ""}-${dateInputValue(now)}.csv`;
}

/**
 * What became of the file.
 *
 * `cancelled` is not a failure and must not be treated as one: it is somebody
 * closing the share sheet, and answering that with a fallback screen is the
 * app insisting. Only `unavailable` means nothing was handed over.
 */
type Handoff = "shared" | "downloaded" | "cancelled" | "unavailable";

/** How this browser can be asked to take a file. */
export type HandoffPlan = "share" | "download" | "text";

/**
 * Which rung of the ladder this browser is on.
 *
 * 1. **The share sheet** (`navigator.share` with a file). The only way to save
 *    a file out of an iOS home-screen app, and the nicest way anywhere: the
 *    sheet holds Save to Files, Mail and every messaging app, and it comes
 *    back to bida afterwards. `text/csv` is on the permitted list for a shared
 *    file; `application/json` is not, which is one of the reasons the export
 *    is a CSV and nothing else.
 * 2. **A download** — but never in an iOS home-screen app. There it is not
 *    merely unsupported: as of iOS 18.4 it replaces the app with a full-screen
 *    "Open in …" that has no way back, so a phone that tried it would lose the
 *    app rather than gain a file (docs/ios.md). An iOS *tab* is fine, Safari
 *    having a real download manager, so the gate is `iosHomeScreenApp` and not
 *    "is this an iPhone".
 * 3. **The text**, on a screen (`/g/export`).
 *
 * Taken as facts rather than read here, like `offerFrom`'s: the whole of this
 * decision is three lines of table, and it is worth being able to state them.
 */
export function handoffPlan({ canShare, iosApp }: {
  canShare: boolean; iosApp: boolean;
}): HandoffPlan {
  if (canShare) return "share";
  return iosApp ? "text" : "download";
}

/**
 * Which rung this browser is on, without building a file to find out.
 *
 * `/g/export` asks, because it is an ordinary route and so can be arrived at
 * by a browser that could have taken a file perfectly well — and a screen that
 * tells that person their browser can't save one is simply wrong.
 */
export function fileHandoff(): HandoffPlan {
  const probe = new File([""], "probe.csv", { type: "text/csv" });
  return handoffPlan({
    canShare: navigator.canShare?.({ files: [probe] }) ?? false,
    iosApp: iosHomeScreenApp(),
  });
}

/**
 * Hand the file over by the best means this browser actually has.
 *
 * A rung is tried when the one above is *unavailable*, never as a retry after
 * it failed — on iOS, dropping to the download after a share that went wrong
 * is precisely how somebody ends up stranded outside the app with no way back.
 * The one exception is a share that was never delivered at all (below), which
 * leaves us exactly where an absent share sheet would have.
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
  // Not revoked in the same turn: a browser that hasn't started reading the
  // blob yet cancels the download instead. There is no event that says it has,
  // so this is a timer, and the cost of it being wrong is one held blob.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
