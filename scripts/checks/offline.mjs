#!/usr/bin/env node
// Doc: docs/testing.md
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { asInstalledApp, ensureBuild, OUT, PATIENCE, serveExport, launch, newPhone, openGroupsList,
  reporter, newGroup } from "../lib/harness.mjs";

ensureBuild();

// Levers for a deploy over a dying signal: one asset goes missing, and the worker
// comes back claiming to be a new build.
let swRevision = null;
let swOnce = false;
const blocked = new Set();

const { base, close } = await serveExport({
  async intercept(path, res) {
    if (blocked.has(path)) { res.writeHead(503); res.end(); return true; }
    if (path === "/sw.js" && swRevision) {
      const src = await readFile(join(OUT, "sw.js"), "utf8");
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(src.replace(/const REVISION = "[^"]*"/, `const REVISION = "${swRevision}"`));
      if (swOnce) { swRevision = null; swOnce = false; }
      return true;
    }
    return false;
  },
});

/**
 * A payload, never a hashed chunk: the forged build copies every chunk from the
 * old cache (`reuseFromEarlierBuilds`), but a payload is always fetched.
 */
const ASSET_TO_DROP = JSON.parse(
  (await readFile(join(OUT, "sw.js"), "utf8")).match(/const ASSETS = (\[[\s\S]*?\]);/)[1],
).find((a) => a.endsWith(".txt"));

const browser = await launch();
const ctx = await newPhone(browser);
let page = await ctx.newPage();
const { report, finish } = reporter();

// ---- seed, online -------------------------------------------------------
const g = await newGroup(page, base, { name: "Marrakech", me: "Theo", members: ["Marie", "Sam"] });
for (const [amount, what] of [["4800", "Riad"], ["6200", "Dinner"], ["900", "Taxi"]]) {
  await page.goto(`${base}/g/entry/edit?id=${g}`);
  await page.locator("input.amount").fill(amount);
  await page.locator("#what").fill(what);
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\?id=/);
}

await page.goto(`${base}/`);
await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => !!r?.active), null,
  { timeout: PATIENCE });
await page.goto(`${base}/`);
const controlled = await page.waitForFunction(() => !!navigator.serviceWorker.controller, null,
  { timeout: PATIENCE }).then(() => true, () => false);
report(controlled, "service worker controls the page");

// ---- pull the plug ------------------------------------------------------
await ctx.setOffline(true);
console.log("\noffline:");

async function tap(label, act, expect) {
  try {
    await act();
    await page.waitForSelector(expect, { timeout: PATIENCE });
    report(true, label);
  } catch (e) {
    const url = page.url().replace(base, "");
    const body = (await page.evaluate(() => document.body.innerText).catch(() => "")).slice(0, 100);
    const stack = await page.evaluate(() => navigation.entries().map((e, i) =>
      `${i === navigation.currentEntry.index ? "*" : ""}${new URL(e.url).pathname}`).join(" ")).catch(() => "");
    report(false, label, `at ${url} — ${body.replace(/\s+/g, " ")}\n        stack: ${stack}`);
  }
}

await tap("groups list loads", () => openGroupsList(page, base), ".rows a.row");
await tap("tap a group", () => page.locator("a.row").first().click(), ".daylabel");
await tap("tap an entry", async () => {
  await page.getByText("Dinner").first().click();
  await page.waitForURL(/\/g\/entry\?/, { timeout: PATIENCE });
}, ".bignum");
// Waits for the traversal itself: one later than `SWALLOWED_MS` is repaired by a
// replace, and a next tap before it lands is taken back off the screen
// (docs/browser-checks.md#writing-a-check-that-holds).
await tap("in-app Back to the group", async () => {
  const from = await page.evaluate(() => navigation.currentEntry.index);
  await page.locator(".iconbtn[aria-label='Back']").first().click();
  await page.waitForFunction((i) => navigation.currentEntry.index < i, from, { timeout: PATIENCE });
}, ".daylabel");
await tap("the balance card", () => page.locator("a[href^='/g/balances']").first().click(), ".bar");
await tap("tap a suggested transfer", () => page.locator("button.card").first().click(), ".settle");
await page.keyboard.press("Escape");
await tap("history", () => page.goto(`${base}/g/history?id=${g}`), ".tle");
await tap("members", () => page.goto(`${base}/g/members?id=${g}`), ".rows .row");
await tap("theme toggle", async () => {
  await page.goto(`${base}/settings`);
  await page.locator('.settings .seg').first().locator('button[aria-pressed="false"]').click();
}, "html[data-theme]");

await tap("new entry form", () => page.goto(`${base}/g/entry/edit?id=${g}`), "input.amount");
await page.locator("input.amount").fill("999");
await tap("who paid", async () => {
  await page.locator("#paidby").click();
  await page.getByRole("option", { name: "Multiple people" }).click();
}, ".rows .row");
await tap("back to the form",
  () => page.locator(".iconbtn[aria-label='Back']").first().click(), "input.amount");
try {
  await page.locator("input.amount").fill("999");
  await page.locator("#what").fill("Offline beer");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\?id=/, { timeout: PATIENCE });
  await page.waitForSelector("text=Offline beer", { timeout: PATIENCE });
  report(true, "save an expense, land back on the ledger with it in the list");
} catch {
  report(false, "save an expense, land back on the ledger with it in the list",
    `at ${page.url().replace(base, "")} — ${(await page.evaluate(() => document.body.innerText)).slice(0, 100).replace(/\s+/g, " ")}`);
}

// ---- a deploy that installs over a dying signal --------------------------
// `activate` deletes the previous cache, so a worker installed with holes in its
// own leaves a phone unable to paint the build it has.
console.log("\nupdate over a flaky network:");
await ctx.setOffline(false);
const cacheBefore = (await page.evaluate(() => caches.keys())).find((k) => k.startsWith("bida-shell-"));
blocked.add(ASSET_TO_DROP);
swRevision = "flakydeploy01";
swOnce = true;
/**
 * `update()` resolves when the script is fetched, not when install finishes. A
 * failed install ends with the worker `redundant`: wait for that event.
 */
const settled = await page.evaluate(async (patience) => {
  const reg = await navigator.serviceWorker.getRegistration();
  const ended = new Promise((resolve) => {
    const watch = () => {
      const sw = reg.installing;
      if (!sw) return false;
      const ends = () => { if (sw.state === "redundant" || sw.state === "activated") resolve(sw.state); };
      sw.addEventListener("statechange", ends);
      ends();
      return true;
    };
    if (!watch()) reg.addEventListener("updatefound", watch);
  });
  await reg.update().catch(() => {});
  return await Promise.race([
    ended,
    new Promise((ok) => { setTimeout(() => ok("never settled"), patience); }),
  ]) === "redundant";
}, PATIENCE);
const afterFlaky = await page.evaluate(() => caches.keys());
report(settled && !afterFlaky.includes("bida-shell-flakydeploy01"),
  "an incomplete precache fails the install, and leaves nothing behind", afterFlaky.join(", "));
report(afterFlaky.includes(cacheBefore), "the working cache survives it");

// Put the lever back *here*: `setOffline` doesn't stop the browser's own `sw.js`
// check, which would install the forged build once the asset is unblocked.
swRevision = null;
await page.waitForFunction(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return !reg?.installing;
}, null, { timeout: PATIENCE });
blocked.delete(ASSET_TO_DROP);

await page.close();
page = await ctx.newPage();
await ctx.setOffline(true);
await tap("still loads offline on the next launch", () => openGroupsList(page, base), ".rows a.row");

// ---- a deploy that arrives by itself ------------------------------------
// Only the front door reloads at once (lib/update.ts).
console.log("\nupdating:");
await ctx.setOffline(false);
const oldShell = (await page.evaluate(() => caches.keys())).find((k) => k.startsWith("bida-shell-"));

const mark = (p) => p.evaluate(() => { window.__beforeTheUpdate = true; });
const touch = (p) => p.evaluate(() => window.dispatchEvent(new PointerEvent("pointerdown")));
// Headless pages never go hidden, so a resume is played out by hand.
const resume = (p, awayMs = 0) => p.evaluate((away) => {
  const show = (state) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  show("hidden");
  const real = Date.now;
  Date.now = () => real() + away;
  show("visible");
}, awayMs);
const reloaded = async (p) => {
  try {
    await p.waitForFunction(() => !window.__beforeTheUpdate, null, { timeout: PATIENCE });
    return true;
  } catch { return false; }
};

await asInstalledApp(page);
await openGroupsList(page, base);
await page.goto(`${base}/settings`);
await page.waitForSelector(".verrow");
await mark(page);
await touch(page);

const doorstep = await ctx.newPage();
await doorstep.goto(`${base}/`);
await doorstep.waitForSelector(".rows a.row");
await mark(doorstep);

const straggler = await ctx.newPage();
await straggler.goto(`${base}/g?id=${g}`);
await straggler.waitForSelector(".fab");
await mark(straggler);
await touch(straggler);
await straggler.evaluate((name) =>
  caches.open(name).then((c) => c.put("/legacy-probe.txt", new Response("OLD"))), oldShell);

const fresh = await ctx.newPage();
await fresh.goto(`${base}/g?id=${g}`);
await fresh.waitForSelector(".fab");
await mark(fresh);

const reload = page.getByRole("button", { name: "Reload" });
await page.bringToFront();
swRevision = "gooddeploy01";
await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
await tap("a page in use is offered the new build", () => reload.waitFor({ state: "visible", timeout: PATIENCE }), ".verrow");
report(new URL(doorstep.url()).pathname === "/" && await reloaded(doorstep),
  "an untouched page on the groups list reloads onto it by itself", doorstep.url().replace(base, ""));
report(await page.evaluate(() => !!window.__beforeTheUpdate), "a page in use is not reloaded under the person");
report(await fresh.evaluate(() => !!window.__beforeTheUpdate),
  "a page on a group is not reloaded, untouched or not");

// Next refuses a payload from another build and navigates to the bare route,
// dropping the `?id=`. So the old page is served its own build.
const legacyAnswer = await straggler.evaluate(() =>
  fetch("/legacy-probe.txt").then((r) => r.text()).catch(() => "failed"));
report(legacyAnswer === "OLD", "a page still on the old build is served from that build's cache", legacyAnswer);
await straggler.locator("a[href^='/g/balances']").first().click().catch(() => {});
try {
  await straggler.waitForURL((url) => url.pathname === "/g/balances", { timeout: PATIENCE });
  await straggler.waitForSelector(".fab", { timeout: PATIENCE });
  const kept = new URL(straggler.url()).searchParams.get("id") === g;
  report(kept && await straggler.locator(".fab").count() > 0,
    "and still knows which group it is on", straggler.url().replace(base, ""));
} catch {
  report(false, "and still knows which group it is on", straggler.url().replace(base, ""));
}
await resume(straggler);
report(await straggler.evaluate(() => !!window.__beforeTheUpdate),
  "and a quick switch away and back is not the moment either");

await resume(straggler, 2 * 60_000);
report(await reloaded(straggler), "and a return after a long absence reloads it onto the new build",
  straggler.url().replace(base, ""));

let spent = false;
try {
  await Promise.all([page.waitForNavigation({ timeout: PATIENCE }), reload.click()]);
  await page.waitForSelector(".verrow", { timeout: PATIENCE });
  spent = await reload.count() === 0;
  await openGroupsList(page, base);
  await page.waitForSelector(".rows a.row", { timeout: PATIENCE });
  report(true, "tapping the offer reloads onto the new build");
} catch {
  report(false, "tapping the offer reloads onto the new build", `at ${page.url().replace(base, "")}`);
}

const shells = (await page.evaluate(() => caches.keys())).filter((k) => k.startsWith("bida-shell-"));
report(shells.includes(`bida-shell-${swRevision}`), "the new build's cache is the live one", shells.join(", "));
report(shells.length === 2 && shells.includes(oldShell),
  "and the previous one is kept, for pages still running it", shells.join(", "));
report(await page.evaluate(() => !!navigator.serviceWorker.controller), "the new worker controls the page");
report(spent, "the offer is spent");
// A reloaded page must never get the old cache's `/g.txt`, which names chunks
// this build doesn't have.
const probe = await page.evaluate(async () => {
  const cache = await caches.open("bida-shell-stale");
  await cache.put("/stale-probe.txt", new Response("STALE"));
  const stale = await fetch("/stale-probe.txt").then((r) => r.status).catch(() => 0);
  await caches.delete("bida-shell-stale");
  const legacy = await fetch("/legacy-probe.txt").then((r) => r.status).catch(() => 0);
  return `${stale}/${legacy}`;
});
report(probe === "404/404", "a page on the new build never reads another cache", `answered ${probe}`);
const answeredAt = await page.evaluate((id) =>
  fetch(`/g.txt?id=${id}&_rsc=probe`).then((r) => new URL(r.url).search).catch(() => "failed"), g);
report(answeredAt.includes(`id=${g}`), "a payload is answered under the URL it was asked for", answeredAt);

// ---- and a second deploy over the page that never reloaded ---------------
console.log("\ndeploying again, over a page that never reloaded:");
swRevision = "gooddeploy02";
await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));

// Wait for the set expected, not for the list to stop changing: two samples can
// agree before `activate`'s deletion runs. Asked of `fresh`: `page` navigates the
// moment the build lands.
const after = await (async () => {
  const deadline = Date.now() + PATIENCE;
  let last = "";
  do {
    const now = (await fresh.evaluate(() => caches.keys()))
      .filter((k) => k.startsWith("bida-shell-")).sort().join(",");
    last = now;
    const keys = now.split(",");
    if (keys.length === 3 && keys.includes(oldShell) && keys.includes(`bida-shell-${swRevision}`)) break;
    await fresh.waitForTimeout(250);
  } while (Date.now() < deadline);
  return last ? last.split(",") : [];
})();
report(after.includes(oldShell), "the cache of the page two builds back is kept", after.join(", "));
report(after.length === 3, "one cache per build a window is on, and no more", after.join(", "));
const stillOld = await fresh.evaluate(() =>
  fetch("/legacy-probe.txt").then((r) => r.text()).catch(() => "failed"));
report(stillOld === "OLD", "that page is still served its own build", stillOld);
const oldAnsweredAt = await fresh.evaluate((id) =>
  fetch(`/g.txt?id=${id}&_rsc=probe`).then((r) => new URL(r.url).search).catch(() => "failed"), g);
report(oldAnsweredAt.includes(`id=${g}`), "under the URL it asked for, not the cache key", oldAnsweredAt);
await fresh.locator("a[href^='/g/balances']").first().click().catch(() => {});
try {
  await fresh.waitForURL((url) => url.pathname === "/g/balances", { timeout: PATIENCE });
  await fresh.waitForSelector(".fab", { timeout: PATIENCE });
  report(new URL(fresh.url()).searchParams.get("id") === g && await fresh.locator(".fab").count() > 0,
    "and can still draw a screen it taps to", fresh.url().replace(base, ""));
} catch {
  report(false, "and can still draw a screen it taps to", fresh.url().replace(base, ""));
}

// ---- and when that page's own build is gone from the cache ---------------
// A page running a build nothing can serve must keep its `?id=` on the router's
// fallback navigation (`payloadFor`).
console.log("\nand with that page's build evicted under it:");
await fresh.evaluate((name) => caches.delete(name), oldShell);
const refused = await fresh.evaluate((id) =>
  fetch(`/g.txt?id=${id}&_rsc=probe`).then((r) => `answered ${r.status}`).catch(() => "refused"), g);
report(refused === "refused", "a payload it cannot be served is refused, not answered from this build", refused);

await fresh.locator(`.topbar a[aria-label="Back"]`).click().catch(() => {});
try {
  await fresh.waitForURL((url) => url.pathname === "/g", { timeout: PATIENCE });
  await fresh.waitForSelector(".fab", { timeout: PATIENCE });
  const kept = new URL(fresh.url()).searchParams.get("id") === g;
  report(kept && await fresh.locator(".keyless").count() === 0,
    "and a tap still lands on the group, not on \"missing its password\"", fresh.url().replace(base, ""));
} catch {
  report(false, "and a tap still lands on the group, not on \"missing its password\"",
    fresh.url().replace(base, ""));
}

try {
  await fresh.goto(`${base}/g.txt?id=${g}&_rsc=probe`);
  await fresh.waitForSelector(".fab", { timeout: PATIENCE });
  report(fresh.url() === `${base}/g?id=${g}` && await fresh.locator(".keyless").count() === 0,
    "and a navigation to a payload lands on the group, at its own address",
    fresh.url().replace(base, ""));
} catch {
  report(false, "and a navigation to a payload lands on the group, at its own address",
    fresh.url().replace(base, ""));
}

await page.bringToFront();
await straggler.close();
await fresh.close();
// `page` is reloaded by the deploy under us, and cutting the network mid-load is
// a blank screen: wait for the list before pulling the plug.
await page.waitForSelector(".rows a.row", { timeout: PATIENCE });
await ctx.setOffline(true);
await tap("the new build loads offline too", () => openGroupsList(page, base), ".rows a.row");

await browser.close();
close();
finish();
