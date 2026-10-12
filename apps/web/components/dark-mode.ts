"use client";
// Doc: docs/design-system.md — read it whole before changing this file.

import { useSyncExternalStore } from "react";
import { updateDevice } from "../lib/db/device";
import { applyTheme, type Theme } from "./theme";

/**
 * Whether the app is drawn dark right now: forced either way, or following
 * the phone. **Read from the DOM, not the device record**: `<html data-theme>`
 * is set before first paint by `ThemeScript` (./theme.tsx), while Dexie is still
 * opening, so it is the only source right on the first render.
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

/** The static export is rendered light; a phone in dark mode corrects itself on hydration. */
export function useDark(): boolean {
  return useSyncExternalStore(subscribe, isDark, () => false);
}

/**
 * Settings' Theme. **Two ways, with the phone as the default**: nothing is
 * forced until it is pressed, and after that it says what it says. The record
 * stays the durable copy — `applyTheme` writes through to localStorage, this to
 * Dexie.
 */
export function setDark(dark: boolean): void {
  const theme: Theme = dark ? "dark" : "light";
  applyTheme(theme);
  for (const notify of listeners) notify();
  void updateDevice({ theme });
}
