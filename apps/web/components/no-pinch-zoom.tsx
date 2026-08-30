"use client";

import { useEffect } from "react";

/**
 * iOS Safari in a tab ignores `user-scalable=no` and lets `touch-action` stop
 * only double-tap, so a two-finger pinch still zooms the page there — leaving
 * the fixed bottom bar off-screen with no gesture that obviously brings it
 * back. Its own `gesture*` events are the remaining lever, and preventing them
 * is what actually holds the scale at 1.
 *
 * Touch only: `gesture*` are WebKit touch events, so a desktop browser's zoom —
 * keyboard, menu, trackpad — is untouched, and the app stays as legible as the
 * reader needs it.
 */
export function NoPinchZoom() {
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    // Listeners have to be non-passive or preventDefault is ignored; Safari
    // defaults these to passive on document.
    const opts = { passive: false } as const;
    document.addEventListener("gesturestart", block, opts);
    document.addEventListener("gesturechange", block, opts);
    document.addEventListener("gestureend", block, opts);
    return () => {
      document.removeEventListener("gesturestart", block);
      document.removeEventListener("gesturechange", block);
      document.removeEventListener("gestureend", block);
    };
  }, []);
  return null;
}
