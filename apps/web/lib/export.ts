// Doc: docs/import-export.md#getting-a-group-off-the-phone
import { groupToCsv, stateFromRows } from "@bida/core";
import { dateInputValue } from "./format";
import { iosHomeScreenApp } from "./install";
import type { GroupData } from "./hooks";

/**
 * From `memberById`, which keeps tombstones: a removed member on a live entry
 * still needs a column for the file to add up. No repricing (ADR-0005).
 */
export function groupCsv(data: GroupData): string {
  const state = stateFromRows({
    group: data.group,
    members: [...data.memberById.values()],
    expenses: data.expenses,
    settlements: data.settlements,
  });
  // The local day: an expense added at 23:00 must not export as tomorrow.
  return groupToCsv(state, { formatDay: dateInputValue, exportedAt: Date.now() });
}

export function exportFilename(groupName: string, now: number): string {
  const slug = groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `bida${slug ? `-${slug}` : ""}-${dateInputValue(now)}.csv`;
}

/**
 * `cancelled` is somebody closing the share sheet — never answer it with a
 * fallback.
 */
type Handoff = "shared" | "downloaded" | "cancelled" | "unavailable";

export type HandoffPlan = "share" | "download" | "text";

/**
 * Never a download in an iOS home-screen app, where it replaces the app with an
 * "Open in …" screen with no way back (docs/ios.md).
 */
export function handoffPlan({ canShare, iosApp }: {
  canShare: boolean; iosApp: boolean;
}): HandoffPlan {
  if (canShare) return "share";
  return iosApp ? "text" : "download";
}

export function fileHandoff(): HandoffPlan {
  const probe = new File([""], "probe.csv", { type: "text/csv" });
  return handoffPlan({
    canShare: navigator.canShare?.({ files: [probe] }) ?? false,
    iosApp: iosHomeScreenApp(),
  });
}

/**
 * A rung is tried when the one above is unavailable, never as a retry after it
 * failed: on iOS a download after a failed share strands somebody outside the
 * app.
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
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      // Anything else and the sheet never opened, so nothing was handed over.
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
  // blob cancels the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
