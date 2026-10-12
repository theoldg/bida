"use client";
// Doc: docs/navigation.md#one-navigation

import { useRouter } from "next/navigation";
import { MenuButton, type SheetAction } from "./row-menu";
import { copy } from "../lib/copy";
import { route } from "../lib/group-link";
import { usePrefetch } from "../lib/prefetch";

/**
 * Everything the groups list can be asked for that isn't a group, behind one
 * button — the same card the group screen's kebab opens (`GroupMenu`), so the
 * app has one menu everywhere. **Labels, not glyphs**: "About bida" says what
 * it is. The phone's switches are behind Settings, not in the menu.
 */
export function HomeMenu() {
  const router = useRouter();
  usePrefetch([route.import(), route.settings(), route.about()]);
  const actions: SheetAction[] = [
    // First: it is an act, and the other two are screens.
    { label: copy.importData.title, icon: "import", onSelect: () => router.push(route.import()) },
    { label: copy.groups.settings, icon: "sliders", onSelect: () => router.push(route.settings()) },
    // Last: the readout everyone can use, while Settings is for changing
    // something, and a menu reads top-down.
    { label: copy.groups.about, icon: "info", onSelect: () => router.push(route.about()) },
  ];

  return <MenuButton icon="more" label={copy.groups.menu} actions={actions} />;
}
