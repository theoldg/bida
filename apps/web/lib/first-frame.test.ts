import { DEMO_GROUP_ID } from "@bida/core";
import { describe, expect, it } from "vitest";
import { firstFrame, firstFrameScript, type FirstFrame } from "./first-frame";
import { formatInvites, parseInvites } from "./group-link";
import { looksIos, offerFrom } from "./install";
import { isLaunchFrom, launchPlan } from "./launch";
import { pushStateFrom } from "./push";

interface Env {
  hint?: string | null;
  launched?: boolean;
  path?: string;
  hash?: string;
  nav?: string;
  standalone?: boolean;
  ua?: string;
  platform?: string;
  touch?: number;
  push?: boolean;
  permission?: NotificationPermission;
}

/** Run the script before paint in a made-up browser; the marks it leaves on `<html>`. */
function marks(env: Env): Record<string, string> {
  const dataset: Record<string, string> = {};
  const win: Record<string, unknown> = env.push ? { PushManager: {}, Notification: { permission: env.permission } } : {};
  const nav: Record<string, unknown> = {
    userAgent: env.ua ?? "Android", platform: env.platform ?? "Linux", maxTouchPoints: env.touch ?? 5,
    ...(env.push ? { serviceWorker: {} } : {}),
  };
  const storage: Record<string, string | null> = {
    "bida.resume": env.hint ?? null, "bida.launched": env.launched ? "1" : null,
  };
  new Function("performance", "location", "localStorage", "navigator", "matchMedia", "window", "Notification", "document",
    firstFrameScript)(
    { getEntriesByType: () => [{ type: env.nav ?? "navigate" }] },
    { pathname: env.path ?? "/", hash: env.hash ?? "" },
    { getItem: (key: string) => storage[key] ?? null },
    nav,
    () => ({ matches: env.standalone ?? false }),
    win,
    win.Notification,
    { documentElement: { dataset } },
  );
  return dataset;
}

/** The banner the ledger's real cards would draw. */
function banner(env: Env): string {
  if (env.hint === DEMO_GROUP_ID) return "demo";
  const offer = offerFrom({
    standalone: env.standalone ?? false, hasPrompt: false,
    ios: looksIos(env.ua ?? "Android", env.platform ?? "Linux", env.touch ?? 5),
  });
  const push = pushStateFrom({ supported: env.push ?? false, permission: env.push ? env.permission : undefined });
  if (offer === "installed") return push === "ask" ? "notify" : "";
  return offer === "manual" ? "manual" : "";
}

const SECRET = "s3cr3tS3cr3tS3cr3t";
/** Carried fragments: none, one unnamed, one named, several, and junk. */
const HASHES = [
  "",
  `#${formatInvites([{ groupId: "g1", secret: SECRET }])}`,
  `#${formatInvites([{ groupId: "g1", secret: SECRET, me: "m1" }])}`,
  `#${formatInvites([{ groupId: "g1", secret: SECRET }, { groupId: "g2", secret: SECRET }])}`,
  "#not a fragment",
];
const NAVS = [undefined, "navigate", "reload", "back_forward"];

describe("firstFrame", () => {
  it("on `/`, marks the ledger exactly when `isLaunchFrom` calls it a launch and a group is hinted", () => {
    for (const path of ["/", "/index.html", "/join", "/g"]) for (const nav of NAVS)
      for (const hint of [null, "g1"]) for (const standalone of [false, true]) {
        const want = isLaunchFrom(nav, `https://bida.bid${path}`) && hint ? "ledger" : undefined;
        expect(firstFrame(path, nav, standalone, hint, false, ""), JSON.stringify({ path, nav, hint }))
          .toBe(want);
      }
  });

  it("on `/install`, foresees `launchPlan` — joining only on the icon's first launch, with one group nobody is named in", () => {
    for (const hash of HASHES) for (const launched of [false, true]) for (const hint of [null, "g9"]) {
      // A first launch holds nothing: the plan sees empty storage.
      const plan = launchPlan(parseInvites(hash), new Set(), new Set(), {});
      const want: FirstFrame = !launched && plan.kind === "join" ? "join" : hint ? "ledger" : "list";
      expect(firstFrame("/install", "navigate", true, hint, launched, hash), JSON.stringify({ hash, launched, hint }))
        .toBe(want);
    }
  });

  it("leaves `/install` alone in a tab, and on a reload in the app", () => {
    expect(firstFrame("/install", "navigate", false, "g1", false, HASHES[1]!)).toBeUndefined();
    expect(firstFrame("/install", "reload", true, "g1", false, HASHES[1]!)).toBeUndefined();
  });
});

describe("firstFrameScript", () => {
  it("marks what `firstFrame` answers, the same function run before paint", () => {
    for (const path of ["/", "/install", "/join"]) for (const hash of HASHES) for (const nav of NAVS)
      for (const hint of [null, "g1"]) for (const launched of [false, true]) for (const standalone of [false, true]) {
        const env = { path, hash, nav, hint, launched, standalone };
        expect(marks(env).frame, JSON.stringify(env))
          .toBe(firstFrame(path, nav, standalone, hint, launched, hash));
      }
  });

  it("names the ledger's banner exactly as the real cards would decide it, and only on a ledger", () => {
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
        expect(marks(env).banner, JSON.stringify(env)).toBe(banner(env));
      }
    expect(marks({ path: "/install", standalone: true }).banner).toBeUndefined();
  });
});
