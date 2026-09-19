"use client";

import { useSyncExternalStore } from "react";
import { copy } from "../lib/copy";
import { applyUpdate, subscribeUpdate, updateState, type UpdateState } from "../lib/update";
import { useInstallOffer } from "./install";

function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribeUpdate, updateState, () => "none" as const);
}

/**
 * The offer to reload into a new build, at the foot of the groups list — the
 * app talking about itself, so it waits below whatever you came to read.
 *
 * A page reloads onto a new build by itself (lib/update.ts): at once if
 * untouched, otherwise when it is next resumed. This is for the stretch in
 * between, and **only in the installed app** — a tab has the browser's own
 * reload button, and `InstallNudge` shows on exactly the phones this doesn't,
 * so the two self-referential cards never share the one screen that has to hold
 * the groups list. Not dismissible: there is nothing to remember.
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
