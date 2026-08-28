"use client";

import { useEffect } from "react";
import { publishExistingClaims } from "../lib/db/commands";
import { startSyncLoop } from "../lib/db/sync";

/** Wires the background sync triggers once, for the life of the app. */
export function StartSync() {
  useEffect(() => {
    // One-off: devices that claimed a member before identity was an op
    // (ADR-0011) have nothing on the log to explain their edits' `actor`.
    void publishExistingClaims();
    return startSyncLoop();
  }, []);
  return null;
}
