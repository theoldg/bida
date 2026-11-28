// Doc: docs/notifications.md#how-it-works

import { newsCount } from "./db/news";

/**
 * When each group's latest finished pull began. A notification shown before
 * that is about ops this phone holds; one shown after may be about ops still
 * on the server, and closing it would drop news nobody has seen.
 */
const pulledFrom = new Map<string, number>();

/** A pull of `groupId` begun at `from` has landed. */
export function pulled(groupId: string, from: number): void {
  pulledFrom.set(groupId, Math.max(from, pulledFrom.get(groupId) ?? 0));
  void closeSeen(groupId);
}

/**
 * Takes down a group's notifications once nothing in it is new. Opening the app
 * never does, and on Android a notification left in the tray is the dot on the
 * app's icon, standing after every change in it was seen. An untagged one (a
 * payload that wouldn't open) goes once any pull has landed after it.
 */
export async function closeSeen(groupId: string): Promise<void> {
  const from = pulledFrom.get(groupId);
  if (from === undefined || typeof window === "undefined" || !("serviceWorker" in navigator)
    || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.getNotifications) return;
    const [shown, news] = await Promise.all([registration.getNotifications(), newsCount(groupId)]);
    for (const n of shown) {
      // Not in TypeScript's DOM, and not in Safari: unknown age is never closed.
      const at = (n as Notification & { timestamp?: number }).timestamp;
      if (typeof at !== "number" || at >= from) continue;
      if (n.tag ? n.tag === groupId && news === 0 : true) n.close();
    }
  } catch {
    // The tray is a courtesy: a browser that won't say what it shows keeps it.
  }
}
