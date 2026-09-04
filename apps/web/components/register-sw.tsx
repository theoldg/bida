"use client";

import { useEffect } from "react";

/** Registers the app-shell service worker once, after first paint. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline precache is a nicety; a failed registration shouldn't be user-visible.
    });
  }, []);
  return null;
}
