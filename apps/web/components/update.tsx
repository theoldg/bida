"use client";

import { useSyncExternalStore } from "react";
import { copy } from "../lib/copy";
import { applyUpdate, subscribeUpdate, updateState, type UpdateState } from "../lib/update";

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribeUpdate, updateState, () => "none" as const);
}

/**
 * The offer to reload into a new build, at the foot of the groups list beside
 * the install nudge — the same place, for the same reason: it is the app
 * talking about itself, so it waits below whatever you came to read.
 *
 * It is a button rather than an automatic reload because the reload is the
 * price of activating safely (lib/update.ts), and a page that vanishes
 * mid-sentence to pay it is worse than an old build. Not dismissible: there is
 * nothing to remember — take it now or find it here next launch.
 */
export function UpdateNudge() {
  const state = useUpdateState();
  if (state === "none") return null;

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
