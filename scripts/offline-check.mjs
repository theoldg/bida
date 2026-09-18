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
import { asInstalledApp, ensureBuild, OUT, serveExport, launch, newPhone, openGroupsList, reporter, newGroup }
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

await tap("groups list loads", () => openGroupsList(page, base), ".rows a.row");
await tap("tap a group", () => page.locator("a.row").first().click(), ".daylabel");
await tap("tap an entry", () => page.getByText("Dinner").first().click(), ".bignum");
await tap("in-app Back to the group",
  () => page.locator(".iconbtn[aria-label='Back']").first().click(), ".daylabel");
await tap("balances tab", () => page.locator("a[href*='tab=balances']").first().click(), ".bar");
await tap("tap a suggested transfer", () => page.locator("a.card").first().click(), ".transfer");
await tap("history", () => page.goto(`${base}/g/history?id=${g}`), ".tle");
await tap("members", () => page.goto(`${base}/g/members?id=${g}`), ".rows .row");
// The one switch that isn't in a group: light/dark, on the groups list.
// Reached by its words, not its position — twice now the bar has been
// rearranged under this check: "About bida" took the first slot and it
// quietly tapped a link to /about, and then both glyphs became rows in a
// kebab and it tapped the kebab itself. What identifies the toggle is what it
// says (`copy.groups.theme`), so that is what the check asks for.
await tap("theme toggle", async () => {
  await openGroupsList(page, base);
  await page.locator(".topbar button.iconbtn").first().click();
  // `menuitem`, not `button`: the rows carry an explicit role, which replaces
  // the implicit one the element would have had (components/row-menu.tsx).
  await page.getByRole("menuitem", { name: /Switch to (light|dark) mode/ }).click();
}, "html[data-theme]");

await tap("new entry form", () => page.goto(`${base}/g/entry/edit?id=${g}`), "input.amount");
// Reached only from the form, and only with a draft in hand — the one screen
// that can't be checked by typing its URL in.
// The door is held shut until there is an amount to divide, so give it one.
await page.locator("input.amount").fill("999");
await tap("who paid", () => page.getByRole("button", { name: /multi-payer/i }).click(), ".rows .row");
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
const cacheBefore = (await page.evaluate(() => caches.keys())).find((k) => k.startsWith("bida-shell-"));
blocked.add(ASSET_TO_DROP);
swRevision = "flakydeploy01";
/** `update()` resolves before the install settles, so watch the worker itself. */
const settled = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  await reg.update().catch(() => {});
  for (let i = 0; i < 60 && reg.installing; i++) await new Promise((ok) => setTimeout(ok, 500));
  return !reg.installing;
});
const afterFlaky = await page.evaluate(() => caches.keys());
report(settled && !afterFlaky.includes("bida-shell-flakydeploy01"),
  "an incomplete precache fails the install, and leaves nothing behind", afterFlaky.join(", "));
report(afterFlaky.includes(cacheBefore), "the working cache survives it");
// The worker activates the moment it installs, and activating is what deletes
// the caches it doesn't need — so a hole here would show on the very next launch.
await page.close();
page = await ctx.newPage();
await ctx.setOffline(true);
await tap("still loads offline on the next launch", () => openGroupsList(page, base), ".rows a.row");

// ---- a deploy that arrives by itself ------------------------------------
// The worker activates as soon as a new build is precached (public/sw.js): it
// used to wait for every client of the origin to close, which on iOS Safari
// meant killing the browser over and over to get a deploy. So four pages are
// open across it, and **the front door is the only screen a reload happens on**
// (lib/update.ts):
//
// - one untouched on the groups list, which takes the build at once;
// - one being used, in the installed app, which must not vanish under the
//   person and is offered the reload instead;
// - one untouched on a group, which stays put — untouched is not enough;
// - one on a group that is resumed, which stays on its own build (served from
//   that build's kept cache) until it reaches the list.
console.log("\nupdating:");
await ctx.setOffline(false);
blocked.delete(ASSET_TO_DROP);
swRevision = null;
const oldShell = (await page.evaluate(() => caches.keys())).find((k) => k.startsWith("bida-shell-"));

const mark = (p) => p.evaluate(() => { window.__beforeTheUpdate = true; });
const touch = (p) => p.evaluate(() => window.dispatchEvent(new PointerEvent("pointerdown")));
// Headless pages never go hidden, so a resume is played out by hand.
const resume = (p) => p.evaluate(() => {
  for (const state of ["hidden", "visible"]) {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  }
});
const reloaded = async (p) => {
  try {
    await p.waitForFunction(() => !window.__beforeTheUpdate, null, { timeout: 10000 });
    return true;
  } catch { return false; }
};

// The offer is drawn only in the installed app: a tab has a reload button already.
await asInstalledApp(page);
await openGroupsList(page, base);
await mark(page);
await touch(page);

// Untouched and at the front door: the one page an update takes by itself.
// Opened before the two below, which clear `leftOnList` and would send this one
// straight into a group (lib/launch.ts) — the assertion under it says so.
const doorstep = await ctx.newPage();
await doorstep.goto(`${base}/`);
await doorstep.waitForSelector(".rows a.row");
await mark(doorstep);

const straggler = await ctx.newPage();
await straggler.goto(`${base}/g?id=${g}`);
await straggler.waitForSelector(".bottomnav a");
await mark(straggler);
await touch(straggler);
// A file only the old build's cache holds: which build answers is then visible.
await straggler.evaluate((name) =>
  caches.open(name).then((c) => c.put("/legacy-probe.txt", new Response("OLD"))), oldShell);

// Opened by URL, not by `openGroupsList`: its Back tap would count as a touch.
const fresh = await ctx.newPage();
await fresh.goto(`${base}/g?id=${g}`);
await fresh.waitForSelector(".bottomnav a");
await mark(fresh);

const reload = page.getByRole("button", { name: "Reload" });
await page.bringToFront();
// Only now: the browser rechecks `sw.js` on every navigation, so a deploy served
// any earlier would already be the build the three pages above booted on.
swRevision = "gooddeploy01";
await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
await tap("a page in use is offered the new build", () => reload.waitFor({ state: "visible", timeout: 20000 }), ".card");
report(new URL(doorstep.url()).pathname === "/" && await reloaded(doorstep),
  "an untouched page on the groups list reloads onto it by itself", doorstep.url().replace(base, ""));
report(await page.evaluate(() => !!window.__beforeTheUpdate), "a page in use is not reloaded under the person");
report(await fresh.evaluate(() => !!window.__beforeTheUpdate),
  "a page on a group is not reloaded, untouched or not");

// Next refuses a payload from a build it didn't boot with and navigates to the
// bare route, dropping the `?id=` — a group screen that became "No group". So
// until it reloads, the old page is served its own build.
const legacyAnswer = await straggler.evaluate(() =>
  fetch("/legacy-probe.txt").then((r) => r.text()).catch(() => "failed"));
report(legacyAnswer === "OLD", "a page still on the old build is served from that build's cache", legacyAnswer);
await straggler.locator("a[href*='tab=balances']").first().click().catch(() => {});
try {
  await straggler.waitForSelector(".bottomnav a", { timeout: 8000 });
  const kept = new URL(straggler.url()).searchParams.get("id") === g;
  report(kept && await straggler.locator(".bottomnav a").count() === 2,
    "and still knows which group it is on", straggler.url().replace(base, ""));
} catch {
  report(false, "and still knows which group it is on", straggler.url().replace(base, ""));
}
await resume(straggler);
report(await straggler.evaluate(() => !!window.__beforeTheUpdate),
  "and a resume on a group is not the moment either");

// The front door is. Walked to in-app — a `goto` would be a document load, and
// would take the new build by itself and prove nothing.
for (let i = 0; i < 2 && new URL(straggler.url()).pathname !== "/"; i++) {
  await straggler.locator(".topbar a.iconbtn").first().click().catch(() => {});
  await straggler.waitForTimeout(400);
}
await resume(straggler);
report(await reloaded(straggler), "and reloads onto the new build once it reaches the list",
  straggler.url().replace(base, ""));

try {
  await Promise.all([page.waitForNavigation({ timeout: 15000 }), reload.click()]);
  await openGroupsList(page, base);
  await page.waitForSelector(".rows a.row", { timeout: 8000 });
  report(true, "tapping the offer reloads onto the new build");
} catch {
  report(false, "tapping the offer reloads onto the new build", `at ${page.url().replace(base, "")}`);
}

const shells = (await page.evaluate(() => caches.keys())).filter((k) => k.startsWith("bida-shell-"));
report(shells.includes(`bida-shell-${swRevision}`), "the new build's cache is the live one", shells.join(", "));
report(shells.length === 2 && shells.includes(oldShell),
  "and the previous one is kept, for pages still running it", shells.join(", "));
report(await page.evaluate(() => !!navigator.serviceWorker.controller), "the new worker controls the page");
report(await reload.count() === 0, "the offer is spent");
// A reloaded page is the new build's, and must never be answered from the old
// cache: that is an old `/g.txt` naming chunks this build doesn't have.
const probe = await page.evaluate(async () => {
  const cache = await caches.open("bida-shell-stale");
  await cache.put("/stale-probe.txt", new Response("STALE"));
  const stale = await fetch("/stale-probe.txt").then((r) => r.status).catch(() => 0);
  await caches.delete("bida-shell-stale");
  const legacy = await fetch("/legacy-probe.txt").then((r) => r.status).catch(() => 0);
  return `${stale}/${legacy}`;
});
report(probe === "404/404", "a page on the new build never reads another cache", `answered ${probe}`);

// ---- and a second deploy over the page that never reloaded ---------------
// `fresh` has sat on a group through one deploy and is still on the build it
// booted with. The worker used to keep one cache — whichever was newest after
// this one — and hand it to every page open at the time, which is right exactly
// once: here it would delete this page's own cache and point it at a build it
// had never run. Chunk names are hashed and would simply miss, but `/g` and
// `/g.txt` are not, so it was served a stranger's payload — which is what the
// probe below catches, the two revisions here being one build. In the field
// that payload names chunks the page cannot fetch, and the screen never
// finishes drawing. Holding out for the front door (lib/update.ts) is only
// affordable because this no longer happens.
console.log("\ndeploying again, over a page that never reloaded:");
swRevision = "gooddeploy02";
await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));

// The new build's cache appears at `install`, and `activate` — which is what
// decides who keeps what — runs after it and deletes on its own schedule. So
// wait for the list to hold the new build *and stop changing*: sampling on the
// cache's arrival alone passed against the worker this replaced, because the
// deletion it would have made had not happened yet.
// Asked of `fresh`, not of `page`: `page` is untouched on the groups list, so
// it takes this build the moment it lands, and an evaluate on a page that is
// navigating throws.
const after = await (async () => {
  let last = "";
  for (let i = 0; i < 24; i++) {
    const now = (await fresh.evaluate(() => caches.keys()))
      .filter((k) => k.startsWith("bida-shell-")).sort().join(",");
    if (now === last && now.includes(`bida-shell-${swRevision}`)) break;
    last = now;
    await fresh.waitForTimeout(500);
  }
  return last ? last.split(",") : [];
})();
report(after.includes(oldShell), "the cache of the page two builds back is kept", after.join(", "));
// One per build somebody is on — this one, the one the three reloaded pages
// took, and `fresh`'s — and no more. Eviction itself is the `shells.length === 2`
// above: nothing accumulates for a build nothing is left running.
report(after.length === 3, "one cache per build a window is on, and no more", after.join(", "));
const stillOld = await fresh.evaluate(() =>
  fetch("/legacy-probe.txt").then((r) => r.text()).catch(() => "failed"));
report(stillOld === "OLD", "that page is still served its own build", stillOld);
await fresh.locator("a[href*='tab=balances']").first().click().catch(() => {});
try {
  await fresh.waitForSelector(".bottomnav a", { timeout: 8000 });
  report(new URL(fresh.url()).searchParams.get("id") === g && await fresh.locator(".bottomnav a").count() === 2,
    "and can still draw a screen it taps to", fresh.url().replace(base, ""));
} catch {
  report(false, "and can still draw a screen it taps to", fresh.url().replace(base, ""));
}

// ---- and when that page's own build is gone from the cache ---------------
// The report this came from: "a link is missing its password" while walking
// through the app. Storage pressure, a lost record, a cache the browser evicted
// — however it goes, a page can be left running a build nothing can serve. It
// used to be handed *this* build's payload, and Next answers a build id that is
// not its own by hard-navigating to the response's URL, which for anything out
// of a cache is the cache key, and payloads are keyed by path. So the `?id=`
// naming the group was gone before the browser saw it, and the bare `/g` that
// loaded could only say the link had no password.
//
// The symptom needs two real builds, and the deploys here are one `out/` under
// two revisions — the build id never changes, so Next never does that
// navigation. What is asserted is the two halves of the cause: such a page is
// refused a payload rather than handed this build's, and the navigation the
// router falls back to lands on the route with its `?id=` intact (`payloadFor`
// in public/sw.js). `lib/sw.test.ts` covers the decision itself.
console.log("\nand with that page's build evicted under it:");
await fresh.evaluate((name) => caches.delete(name), oldShell);
const refused = await fresh.evaluate((id) =>
  fetch(`/g.txt?id=${id}&_rsc=probe`).then((r) => `answered ${r.status}`).catch(() => "refused"), g);
report(refused === "refused", "a payload it cannot be served is refused, not answered from this build", refused);

// And none of it must be felt: the app still navigates as it did.
await fresh.locator(".bottomnav a").first().click().catch(() => {});
try {
  await fresh.waitForSelector(".bottomnav a", { timeout: 8000 });
  const kept = new URL(fresh.url()).searchParams.get("id") === g;
  report(kept && await fresh.locator(".keyless").count() === 0,
    "and a tap still lands on the group, not on \"missing its password\"", fresh.url().replace(base, ""));
} catch {
  report(false, "and a tap still lands on the group, not on \"missing its password\"",
    fresh.url().replace(base, ""));
}

// The other half, and the last thing standing between the refusal above and a
// person: the router hands the payload URL it asked for to the browser as a
// navigation, and what must load is the route — at the route's own address,
// since every back arrow in the app is a path (lib/nav.ts) and `/g.txt` is not
// one. Driven directly, because a navigation is the one request `fetch` cannot
// make.
await fresh.goto(`${base}/g.txt?id=${g}&_rsc=probe`);
try {
  await fresh.waitForSelector(".bottomnav a", { timeout: 8000 });
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
// And the point of all of it: the build it just took still works with no network.
await ctx.setOffline(true);
await tap("the new build loads offline too", () => openGroupsList(page, base), ".rows a.row");

await browser.close();
close();
finish();
