#!/usr/bin/env node
/**
 * `pnpm offline` — does the built app actually work with the network cut?
 *
 * Seeds a group through the real UI over a local server, lets the service
 * worker install, pulls the plug, and then walks every screen and saves an
 * expense. It exists because "offline-first" was true of the data layer and
 * false of the app: the shell precache missed the RSC payloads Next fetches on
 * every tap, so a phone with no signal got a wall of `1:"$Sreact.fragment"`.
 * Run it after touching public/sw.js or apps/web/scripts/precache.mjs; it
 * builds first if it has to.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureBuild, OUT, serveExport, launch, newPhone, reporter, newGroup }
  from "./lib/harness.mjs";

ensureBuild();

// Levers for the "a deploy installed over a dying signal" case at the end: one
// asset goes missing, and the worker comes back claiming to be a new build.
let swRevision = null;
const blocked = new Set();

const { base, close } = await serveExport({
  async intercept(path, res) {
    if (blocked.has(path)) { res.writeHead(503); res.end(); return true; }
    if (path === "/sw.js" && swRevision) {
      const src = await readFile(join(OUT, "sw.js"), "utf8");
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(src.replace(/const REVISION = "[^"]*"/, `const REVISION = "${swRevision}"`));
      return true;
    }
    return false;
  },
});

/** Any one precached file will do; a hashed chunk is the realistic casualty. */
const ASSET_TO_DROP = JSON.parse(
  (await readFile(join(OUT, "sw.js"), "utf8")).match(/const ASSETS = (\[[\s\S]*?\]);/)[1],
).find((a) => a.startsWith("/_next/static/chunks/"));

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

// The worker takes over on the next launch, never mid-session — so reload once,
// exactly as closing and reopening the app would.
await page.goto(`${base}/`);
await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => !!r?.active), null,
  { timeout: 20000 });
await page.goto(`${base}/`);
await page.waitForTimeout(500);
report(await page.evaluate(() => !!navigator.serviceWorker.controller), "service worker controls the page");

// ---- pull the plug ------------------------------------------------------
await ctx.setOffline(true);
console.log("\noffline:");

/** Every screen, reached the way a thumb reaches it: by tapping. */
async function tap(label, act, expect) {
  try {
    await act();
    await page.waitForSelector(expect, { timeout: 8000 });
    report(true, label);
  } catch (e) {
    const url = page.url().replace(base, "");
    const body = (await page.evaluate(() => document.body.innerText).catch(() => "")).slice(0, 100);
    report(false, label, `at ${url} — ${body.replace(/\s+/g, " ")}`);
  }
}

await tap("groups list loads", () => page.goto(`${base}/`), ".rows a.row");
await tap("tap a group", () => page.locator("a.row").first().click(), ".daylabel");
await tap("tap an entry", () => page.getByText("Dinner").first().click(), ".bignum");
await tap("in-app Back to the group",
  () => page.locator(".iconbtn[aria-label='Back']").first().click(), ".daylabel");
await tap("balances tab", () => page.locator("a[href*='tab=balances']").first().click(), ".bar");
await tap("tap a suggested transfer", () => page.locator("a.card").first().click(), ".transfer");
await tap("history", () => page.goto(`${base}/g/history?id=${g}`), ".tle");
await tap("members", () => page.goto(`${base}/g/members?id=${g}`), ".rows .row");
// The one switch that isn't in a group: light/dark, on the groups list.
await tap("theme toggle", async () => {
  await page.goto(`${base}/`);
  await page.locator(".topbar .iconbtn").first().click();
}, "html[data-theme]");

await tap("new entry form", () => page.goto(`${base}/g/entry/edit?id=${g}`), "input.amount");
// Reached only from the form, and only with a draft in hand — the one screen
// that can't be checked by typing its URL in.
await tap("who paid", () => page.getByRole("link", { name: /multi-payer/i }).click(), ".rows .row");
await tap("back to the form",
  () => page.locator(".iconbtn[aria-label='Back']").first().click(), "input.amount");
try {
  await page.locator("input.amount").fill("999");
  await page.locator("#what").fill("Offline beer");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\?id=/, { timeout: 8000 });
  await page.waitForSelector("text=Offline beer", { timeout: 8000 });
  report(true, "save an expense, land back on the ledger with it in the list");
} catch {
  report(false, "save an expense, land back on the ledger with it in the list",
    `at ${page.url().replace(base, "")} — ${(await page.evaluate(() => document.body.innerText)).slice(0, 100).replace(/\s+/g, " ")}`);
}

// ---- a deploy that installs over a dying signal --------------------------
// The failure this guards against is silent and only bites later: `activate`
// deletes the previous cache, so a new worker allowed to install with holes in
// its own leaves an installed phone unable to paint the build it now has.
console.log("\nupdate over a flaky network:");
await ctx.setOffline(false);
const cacheBefore = (await page.evaluate(() => caches.keys())).find((k) => k.startsWith("hajsik-shell-"));
blocked.add(ASSET_TO_DROP);
swRevision = "flakydeploy01";
/** `update()` resolves before the install settles, so watch the worker itself. */
const waiting = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  await reg.update().catch(() => {});
  for (let i = 0; i < 60 && !reg.waiting; i++) {
    if (reg.installing?.state === "redundant") return null;
    await new Promise((ok) => setTimeout(ok, 500));
  }
  return reg.waiting?.state ?? null;
});
report(waiting === null, "an incomplete precache fails the install", waiting && `a worker is ${waiting}`);
report((await page.evaluate(() => caches.keys())).includes(cacheBefore), "the working cache survives it");
// The damage would only show one launch later: a waiting worker activates when
// the last page closes, and activating is what deletes the good cache.
await page.close();
page = await ctx.newPage();
await ctx.setOffline(true);
await tap("still loads offline on the next launch", () => page.goto(`${base}/`), ".rows a.row");

// ---- a deploy the person is offered, and takes ---------------------------
// The worker never activates on its own while a page is open (public/sw.js), so
// a client that outlives the app — a forgotten tab on the same origin — pins
// the old build indefinitely, which is how an installed phone gets stuck on a
// build with nothing on screen to say so. `components/update.tsx` is the way
// out, and only if the tap really activates the worker and lands on its cache.
console.log("\nupdating on demand:");
await ctx.setOffline(false);
blocked.delete(ASSET_TO_DROP);
swRevision = "gooddeploy01";
await page.goto(`${base}/`);
// A second client of the *old* worker, open across the tap: the case that made
// waiting-forever possible. It must not hold the update up.
const straggler = await ctx.newPage();
await straggler.goto(`${base}/`);
await page.bringToFront();

const restart = page.getByRole("button", { name: "Restart" });
await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
await tap("a waiting worker is offered on the groups list",
  () => restart.waitFor({ state: "visible", timeout: 20000 }), ".card");

try {
  await Promise.all([page.waitForNavigation({ timeout: 15000 }), restart.click()]);
  await page.waitForSelector(".rows a.row", { timeout: 8000 });
  report(true, "tapping it reloads onto the new build");
} catch {
  report(false, "tapping it reloads onto the new build", `at ${page.url().replace(base, "")}`);
}

const shells = (await page.evaluate(() => caches.keys())).filter((k) => k.startsWith("hajsik-shell-"));
report(shells.includes(`hajsik-shell-${swRevision}`), "the new build's cache is the live one",
  shells.join(", "));
report(shells.length === 1, "and the old one is gone with it", shells.join(", "));
report(await page.evaluate(() => !!navigator.serviceWorker.controller),
  "the new worker controls the page");
// Nothing is waiting any more, so there is nothing left to offer.
report(await restart.count() === 0, "the offer is spent");
// A worker may only read its own cache. `activate` runs *after* the reload the
// tap asks for, so the previous build's cache is still there while that reload
// is being served — and an unscoped `caches.match` searched it, handing the new
// worker an old shell or an old `/g.txt` and drawing a screen with pieces of it
// missing. A cache the precache has never heard of stands in for it: anything
// but a 404 means this worker read a cache that isn't CACHE_NAME.
const probe = await page.evaluate(async () => {
  const cache = await caches.open("hajsik-shell-stale");
  await cache.put("/stale-probe.txt", new Response("STALE"));
  const status = await fetch("/stale-probe.txt").then((r) => r.status).catch(() => 0);
  await caches.delete("hajsik-shell-stale");
  return status;
});
report(probe === 404, "a stale cache is never read from", `/stale-probe.txt answered ${probe}`);
await straggler.close();
// And the point of all of it: the build it just took still works with no network.
await ctx.setOffline(true);
await tap("the new build loads offline too", () => page.goto(`${base}/`), ".rows a.row");

await browser.close();
close();
finish();
