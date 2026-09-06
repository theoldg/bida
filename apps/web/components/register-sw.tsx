"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "../lib/update";

/**
 * Registers the app-shell service worker once, after first paint — and, with
 * it, the watch for the next build (lib/update.ts). Drawing what that watch
 * finds is `components/update.tsx`, on the groups list.
 */
export function RegisterServiceWorker() {
  useEffect(registerServiceWorker, []);
  return null;
}
