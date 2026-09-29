import { DEMO_GROUP_ID } from "@bida/core";
import { describe, expect, it } from "vitest";
import { looksIos, offerFrom } from "./install";
import { pushStateFrom } from "./push";
import { resumeScript } from "./resume-hint";

interface Env {
  hint: string | null;
  path?: string;
  nav?: string;
  standalone?: boolean;
  ua?: string;
  platform?: string;
  touch?: number;
  push?: boolean;
  permission?: NotificationPermission;
}

/** Run the script before paint in a made-up browser; what it marks `<html>` with. */
function run(env: Env): string | undefined {
  const dataset: Record<string, string> = {};
  const win: Record<string, unknown> = env.push ? { PushManager: {}, Notification: { permission: env.permission } } : {};
  const nav: Record<string, unknown> = {
    userAgent: env.ua ?? "Android", platform: env.platform ?? "Linux", maxTouchPoints: env.touch ?? 5,
    ...(env.push ? { serviceWorker: {} } : {}),
  };
  new Function("performance", "location", "localStorage", "navigator", "matchMedia", "window", "Notification", "document",
    resumeScript)(
    { getEntriesByType: () => [{ type: env.nav ?? "navigate" }] },
    { pathname: env.path ?? "/" },
    { getItem: () => env.hint },
    nav,
    () => ({ matches: env.standalone ?? false }),
    win,
    win.Notification,
    { documentElement: { dataset } },
  );
  return dataset.resuming;
}

/** The same answer, from the functions the ledger's cards really ask. */
function expected(env: Env): string {
  if (env.hint === DEMO_GROUP_ID) return "demo";
  const offer = offerFrom({
    standalone: env.standalone ?? false, hasPrompt: false,
    ios: looksIos(env.ua ?? "Android", env.platform ?? "Linux", env.touch ?? 5),
  });
  const push = pushStateFrom({ supported: env.push ?? false, permission: env.push ? env.permission : undefined });
  if (offer === "installed") return push === "ask" ? "notify" : "";
  return offer === "manual" ? "manual" : "";
}

describe("resumeScript", () => {
  it("marks nothing without a hint, or on anything but a launch onto the list", () => {
    expect(run({ hint: null })).toBeUndefined();
    expect(run({ hint: "g1", nav: "reload" })).toBeUndefined();
    expect(run({ hint: "g1", nav: "back_forward" })).toBeUndefined();
    expect(run({ hint: "g1", path: "/join" })).toBeUndefined();
    expect(run({ hint: "g1", path: "/index.html" })).toBe("");
  });

  it("names the ledger's banner exactly as the real cards would decide it", () => {
    const uas = [
      { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)", platform: "iPhone" },
      { ua: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", touch: 5 },
      { ua: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", touch: 0 },
      { ua: "Mozilla/5.0 (Linux; Android 15)", platform: "Linux" },
    ];
    const perms: (NotificationPermission | undefined)[] = ["default", "granted", "denied"];
    for (const hint of ["g1", DEMO_GROUP_ID]) for (const standalone of [false, true])
      for (const u of uas) for (const push of [false, true]) for (const permission of perms) {
        const env = { hint, standalone, push, permission, ...u };
        expect(run(env), JSON.stringify(env)).toBe(expected(env));
      }
  });
});
