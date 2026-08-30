"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "./icons";
import { applyTheme, type Theme } from "./theme";
import { updateDevice } from "../lib/db/device";

/**
 * Light or dark, in one tap, on the one screen that is about this phone rather
 * than about a group (ADR-0007).
 *
 * It reads the DOM rather than the device record: `<html data-theme>` is set
 * before first paint by the script in ./theme.tsx, while Dexie is still
 * opening, so this is the only source that is right on the very first render.
 * The record stays the durable copy — `applyTheme` writes through to
 * localStorage, and this writes through to Dexie.
 */
const QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  const mq = window.matchMedia?.(QUERY);
  mq?.addEventListener("change", notify);
  return () => {
    listeners.delete(notify);
    mq?.removeEventListener("change", notify);
  };
}

function isDark(): boolean {
  const forced = document.documentElement.dataset.theme;
  if (forced === "dark" || forced === "light") return forced === "dark";
  return window.matchMedia?.(QUERY).matches === true;
}

export function ThemeToggle() {
  // The static export is rendered light; a phone in dark mode corrects itself
  // on the first client render, which is a glyph swapping, not a flash of page.
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  const next: Theme = dark ? "light" : "dark";

  function flip() {
    applyTheme(next);
    for (const notify of listeners) notify();
    void updateDevice({ theme: next });
  }

  return (
    <button className="iconbtn" onClick={flip}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
      <Icon name={dark ? "sun" : "moon"} size={18} />
    </button>
  );
}
