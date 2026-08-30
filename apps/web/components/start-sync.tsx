"use client";

import { useEffect } from "react";
import { publishExistingClaims } from "../lib/db/commands";
import { db } from "../lib/db/dexie";
import { getDevice } from "../lib/db/device";
import { startSyncLoop } from "../lib/db/sync";
import { requestPersistence } from "../lib/persist";

/** Wires the background sync triggers once, for the life of the app. */
export function StartSync() {
  useEffect(() => {
    // Creates the device record on a fresh phone, and brings an old one up to
    // the current defaults. Every other reader watches the row live, so none
    // of them would trigger the migration on their own.
    void getDevice();
    // One-off: devices that claimed a member before identity was an op
    // (ADR-0011) have nothing on the log to explain their edits' `actor`.
    void publishExistingClaims();
    // Every start, not once: the browser's answer depends on how established
    // the app looks to it, so a phone refused before install is granted after.
    // Only once there is a group to lose — see lib/persist.ts.
    void db().groupKeys.count().then((n) => { if (n > 0) return requestPersistence(); });
    return startSyncLoop();
  }, []);
  return null;
}
