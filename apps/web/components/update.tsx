"use client";

import { useSyncExternalStore } from "react";
import { copy } from "../lib/copy";
import { applyUpdate, subscribeUpdate, updateState, type UpdateState } from "../lib/update";
import { useInstallOffer } from "./install";

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribeUpdate, updateState, () => "none" as const);
}

/**
 * The offer to reload into a new build, at the foot of the groups list — the
 * app talking about itself, so it waits below whatever you came to read.
 *
 * **Only in the installed app.** A tab already has a reload button in the
 * browser's own chrome, and closing it is what lets the waiting worker
 * activate by itself; the standalone app has neither, which is the whole
 * reason this offer exists (lib/update.ts). Drawing it in a tab was the app
 * asking for a gesture the browser was already offering — and it put two
 * self-referential cards on the one screen that has to hold the groups list,
 * since `InstallNudge` shows on exactly the phones this now doesn't.
 *
 * It is a button rather than an automatic reload because the reload is the
 * price of activating safely (lib/update.ts), and a page that vanishes
 * mid-sentence to pay it is worse than an old build. Not dismissible: there is
 * nothing to remember — take it now or find it here next launch.
 */
export function UpdateNudge() {
  const state = useUpdateState();
  const installed = useInstallOffer() === "installed";
  if (state === "none" || !installed) return null;

  return (
    <div className="pad" style={{ paddingTop: 18, paddingBottom: 22 }}>
      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 600 }}>{copy.update.title}</div>
        <button className="btn btn-p" style={{ marginTop: 11 }}
          disabled={state === "applying"} onClick={applyUpdate}>
          {state === "applying" ? <span className="spinner" /> : null}{copy.update.act}
        </button>
      </div>
    </div>
  );
}
