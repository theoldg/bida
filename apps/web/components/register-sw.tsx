"use client";

import { useEffect } from "react";
import { recordAppVersion } from "../lib/app-version";

/**
 * Registers the app-shell service worker once, after first paint — and notes
 * whether the build it is serving is one this phone hasn't run before, which is
 * the date the groups list shows (lib/app-version.ts). Both belong here: this
 * is the one place that owns the app's relationship with its worker.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline precache is a nicety; a failed registration shouldn't be user-visible.
    });
    void recordAppVersion();
  }, []);
  return null;
}
