"use client";

import { useEffect } from "react";
import { startSyncLoop } from "../lib/db/sync";

/** Wires the background sync triggers once, for the life of the app. */
export function StartSync() {
  useEffect(() => startSyncLoop(), []);
  return null;
}
