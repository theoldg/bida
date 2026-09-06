"use client";

import { useEffect } from "react";

/**
 * The part of `env(safe-area-inset-*)` that is permanent, as `--sat` / `--sab`.
 *
 * In fullscreen the phone's bars are hidden and a swipe brings them back for a
 * few seconds. Chrome reports that: outside its short-edges cutout mode — a
 * flag off by default — it reads the *visible* system bars, so the safe area
 * grows when a bar unfolds and collapses when it hides again. Anything padding
 * by the raw inset therefore moves under your thumb twice per glance at the
 * clock, which is what made fullscreen feel broken before.
 *
 * Only some of that inset is real estate we can never have: a display cutout is
 * physically in the way for good, while a transient bar is an overlay that goes
 * away on its own. Both arrive as one merged number, so tell them apart by
 * time — the *smallest* value seen this session is the one with no bar in it.
 * Track that, and the layout answers to the notch and ignores the bar, which is
 * free to draw over the top strip for its few seconds.
 *
 * Minimum, deliberately, not maximum: reserving the largest inset ever seen
 * would hand back the strip fullscreen exists to win, permanently, the first
 * time anyone checked the time. It also self-corrects, where a maximum could
 * not — an app launched while a bar happened to be up starts over-reserved and
 * settles the moment the bar hides.
 *
 * The probe rather than reading the custom property: `env()` substitution into
 * a custom property is not something every engine reports back as pixels, and
 * a `ResizeObserver` on a zero-sized box whose padding *is* the inset is both
 * exact and the only way to hear about a change that fires no other event.
 */
export function BarInset() {
  useEffect(() => {
    const root = document.documentElement;
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;"
      + "pointer-events:none;padding-top:env(safe-area-inset-top,0px);"
      + "padding-bottom:env(safe-area-inset-bottom,0px)";
    document.body.appendChild(probe);

    let top = Infinity;
    let bottom = Infinity;

    function measure() {
      const style = getComputedStyle(probe);
      const t = parseFloat(style.paddingTop);
      const b = parseFloat(style.paddingBottom);
      if (!Number.isFinite(t) || !Number.isFinite(b)) return;
      if (t < top) { top = t; root.style.setProperty("--sat", `${t}px`); }
      if (b < bottom) { bottom = b; root.style.setProperty("--sab", `${b}px`); }
    }

    // A rotation is a different phone as far as the insets go — a cutout on the
    // short edge in portrait is on the long one in landscape — so the floor
    // found for one says nothing about the other.
    const portrait = window.matchMedia("(orientation: portrait)");
    function reset() {
      top = Infinity;
      bottom = Infinity;
      root.style.removeProperty("--sat");
      root.style.removeProperty("--sab");
      measure();
    }

    const observer = new ResizeObserver(measure);
    observer.observe(probe, { box: "border-box" });
    measure();
    portrait.addEventListener("change", reset);
    return () => {
      observer.disconnect();
      portrait.removeEventListener("change", reset);
      probe.remove();
      root.style.removeProperty("--sat");
      root.style.removeProperty("--sab");
    };
  }, []);
  return null;
}
