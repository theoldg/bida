"use client";
// Doc: docs/pwa.md

import { useSyncExternalStore } from "react";
import { subscribeUpdate, updateState, type UpdateState } from "../lib/update";

/**
 * Whether a new build is waiting, for Settings' Version section — the one
 * place the app offers it (app/settings). The app takes it by itself on the
 * next return to the front (lib/update.ts); the offer is for not waiting.
 */
export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribeUpdate, updateState, () => "none" as const);
}
