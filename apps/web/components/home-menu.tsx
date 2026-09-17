"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { applyTheme, type Theme } from "./theme";
import { MenuButton, type SheetAction } from "./row-menu";
import { updateDevice } from "../lib/db/device";
import { copy } from "../lib/copy";
import { route } from "../lib/group-link";

/**
 * Everything the groups list can be asked for that isn't a group, behind one
 * button — the same card the group screen's kebab opens (`GroupMenu`), so the
 * app has one menu everywhere. These were two unlabelled glyphs in the bar,
 * and a sun is not a sentence: the theme switch now says which way it goes,
 * and "About bida" says what it is rather than leaving an ⓘ to be guessed.
 *
 * The theme is read from the DOM rather than from the device record:
 * `<html data-theme>` is set before first paint by the script in ./theme.tsx,
 * while Dexie is still opening, so this is the only source that is right on
 * the very first render. The record stays the durable copy — `applyTheme`
 * writes through to localStorage, and this writes through to Dexie.
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

export function HomeMenu() {
  const router = useRouter();
  // The static export is rendered light; a phone in dark mode corrects itself
  // on the first client render, which is a word in a closed menu, not a flash
  // of page.
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  const next: Theme = dark ? "light" : "dark";

  function flip() {
    applyTheme(next);
    for (const notify of listeners) notify();
    void updateDevice({ theme: next });
  }

  const actions: SheetAction[] = [
    {
      label: dark ? copy.groups.theme.toLight : copy.groups.theme.toDark,
      icon: dark ? "sun" : "moon",
      onSelect: flip,
    },
    { label: copy.groups.about, icon: "info", onSelect: () => router.push(route.about()) },
  ];

  return <MenuButton icon="more" label={copy.groups.menu} actions={actions} />;
}
