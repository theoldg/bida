#!/usr/bin/env node
/**
 * `pnpm offline` — does the built app actually work with the network cut?
 *
 * Seeds a group through the real UI over a local server, lets the service
 * worker install, pulls the plug, then walks every screen and saves an
 * expense. The data layer being offline-first isn't enough: if the precache
 * misses the RSC payloads Next fetches on every tap, a phone with no signal
 * gets a wall of `1:"$Sreact.fragment"`. Run it after touching public/sw.js
 * or apps/web/scripts/precache.mjs; it builds first if it has to.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { asInstalledApp, ensureBuild, OUT, PATIENCE, serveExport, launch, newPhone, openGroupsList,
  reporter, newGroup } from "./lib/harness.mjs";

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
  { timeout: PATIENCE });
await page.goto(`${base}/`);
// Control arrives with the document's load, but the property is read off the
// page — so wait for the property, not a pause.
const controlled = await page.waitForFunction(() => !!navigator.serviceWorker.controller, null,
  { timeout: PATIENCE }).then(() => true, () => false);
report(controlled, "service worker controls the page");

// ---- pull the plug ------------------------------------------------------
await ctx.setOffline(true);
console.log("\noffline:");

/** Every screen, reached the way a thumb reaches it: by tapping. */
async function tap(label, act, expect) {
  try {
    await act();
    await page.waitForSelector(expect, { timeout: PATIENCE });
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
await tap("the balance card", () => page.locator("a[href^='/g/balances']").first().click(), ".bar");
await tap("tap a suggested transfer", () => page.locator("button.card").first().click(), ".settle");
await page.keyboard.press("Escape");
await tap("history", () => page.goto(`${base}/g/history?id=${g}`), ".tle");
await tap("members", () => page.goto(`${base}/g/members?id=${g}`), ".rows .row");
// The one switch that isn't in a group: light/dark, on the groups list.
// Found by the sun or moon glyph, which nothing else in the menu carries
// (components/home-menu.tsx) — never by position or wording, which keep
// changing under this check.
await tap("theme toggle", async () => {
  await openGroupsList(page, base);
  await page.locator(".topbar button.iconbtn").first().click();
  // `[role=menuitem]`, not `button`: the rows carry an explicit role, which
  // replaces the implicit one the element would have had (row-menu.tsx).
  await page.locator('[role=menuitem]:has(use[href="#i-sun"], use[href="#i-moon"])').click();
}, "html[data-theme]");

await tap("new entry form", () => page.goto(`${base}/g/entry/edit?id=${g}`), "input.amount");
// Reached only from the form with a draft in hand, and the door stays shut
// until there is an amount to divide.
await page.locator("input.amount").fill("999");
await tap("who paid", () => page.getByRole("button", { name: /multi-payer/i }).click(), ".rows .row");
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
// Silent until later: `activate` deletes the previous cache, so a new worker
// allowed to install with holes in its own leaves an installed phone unable
// to paint the build it now has.
console.log("\nupdate over a flaky network:");
await ctx.setOffline(false);
const cacheBefore = (await page.evaluate(() => caches.keys())).find((k) => k.startsWith("bida-shell-"));
blocked.add(ASSET_TO_DROP);
swRevision = "flakydeploy01";
/**
 * `update()` resolves when the script is fetched, not when install finishes,
 * and on a loaded machine the worker isn't even `installing` yet — so "nothing
 * installing" is not "install over". A failed install ends one way: the worker
 * goes `redundant` after deleting its half-filled cache (public/sw.js). Wait
 * for that event, not a quiet moment.
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

// Put the lever back *here*, in this order. `setOffline` doesn't stop the
// browser's own `sw.js` update check, so the navigation below re-fetches it
// while the lever still says `flakydeploy01`; that install would then
// *succeed* once the asset is unblocked, as a build nothing deployed, and
// `activate` would hand it to every open page and delete their real caches.
swRevision = null;
// And the asset stays blocked until nothing is left installing, so an install
// already in flight can only end the way this section says it does.
await page.waitForFunction(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return !reg?.installing;
}, null, { timeout: PATIENCE });
blocked.delete(ASSET_TO_DROP);

// The worker activates the moment it installs, and activating is what deletes
// the caches it doesn't need — so a hole here would show on the very next launch.
await page.close();
page = await ctx.newPage();
await ctx.setOffline(true);
await tap("still loads offline on the next launch", () => openGroupsList(page, base), ".rows a.row");

// ---- a deploy that arrives by itself ------------------------------------
// The worker activates as soon as a new build is precached (public/sw.js), so
// four pages are open across it, and **the front door is the only screen a
// reload happens on** (lib/update.ts):
//
// - one untouched on the groups list, which takes the build at once;
// - one being used, in the installed app, which is offered the reload instead;
// - one untouched on a group, which stays put — untouched is not enough;
// - one on a group that is resumed, which stays on its own build (served from
//   that build's kept cache) until it reaches the list.
console.log("\nupdating:");
await ctx.setOffline(false);
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
    await p.waitForFunction(() => !window.__beforeTheUpdate, null, { timeout: PATIENCE });
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
await straggler.waitForSelector(".fab");
await mark(straggler);
await touch(straggler);
// A file only the old build's cache holds: which build answers is then visible.
await straggler.evaluate((name) =>
  caches.open(name).then((c) => c.put("/legacy-probe.txt", new Response("OLD"))), oldShell);

// Opened by URL, not by `openGroupsList`: its Back tap would count as a touch.
const fresh = await ctx.newPage();
await fresh.goto(`${base}/g?id=${g}`);
await fresh.waitForSelector(".fab");
await mark(fresh);

const reload = page.getByRole("button", { name: "Reload" });
await page.bringToFront();
// Only here: the browser rechecks `sw.js` on every navigation, so an earlier
// deploy would already be the build the pages above booted on.
swRevision = "gooddeploy01";
await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
await tap("a page in use is offered the new build", () => reload.waitFor({ state: "visible", timeout: PATIENCE }), ".card");
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
await straggler.locator("a[href^='/g/balances']").first().click().catch(() => {});
try {
  // Wait for the address to say the tap landed. A `waitForSelector` alone can
  // pass before it changes (both views draw a floating button), and every later step
  // would then be taken on a page still arriving.
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
  "and a resume on a group is not the moment either");

// The front door is. Walked to in-app — a `goto` would be a document load, and
// would take the new build by itself and prove nothing.
// Two taps, because back from balances is the ledger and only the ledger
// leaves the group (app/g/balances) — each waited out by the address it lands
// on rather than by a pause that was long enough on one machine.
for (const landed of [
  (url) => url.pathname === "/g",
  (url) => url.pathname === "/",
]) {
  await straggler.locator(".topbar a.iconbtn").first().click().catch(() => {});
  await straggler.waitForURL(landed, { timeout: PATIENCE }).catch(() => {});
}
await resume(straggler);
report(await reloaded(straggler), "and reloads onto the new build once it reaches the list",
  straggler.url().replace(base, ""));

try {
  await Promise.all([page.waitForNavigation({ timeout: PATIENCE }), reload.click()]);
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
// `fresh` sat on a group through one deploy and is still on its boot build.
// Handing every open page the newest cache would delete this page's own and
// serve it a stranger's `/g.txt` (unhashed, unlike chunks), naming chunks it
// can't fetch — a screen that never finishes drawing. The probe below catches
// that; holding out for the front door (lib/update.ts) depends on it.
console.log("\ndeploying again, over a page that never reloaded:");
swRevision = "gooddeploy02";
await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));

// The new cache appears at `install`; `activate` deletes on its own schedule
// after. So wait for the list to hold the new build *and stop changing* —
// sampling on arrival alone would pass before the deletion happens.
// Asked of `fresh`, not `page`: `page` is on the list and navigates the moment
// the build lands, and evaluating on a navigating page throws.
const after = await (async () => {
  const deadline = Date.now() + PATIENCE;
  let last = "";
  do {
    const now = (await fresh.evaluate(() => caches.keys()))
      .filter((k) => k.startsWith("bida-shell-")).sort().join(",");
    if (now === last && now.includes(`bida-shell-${swRevision}`)) break;
    last = now;
    await fresh.waitForTimeout(500);
  } while (Date.now() < deadline);
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
// Eviction or storage pressure can leave a page running a build nothing can
// serve. Handed *this* build's payload, Next hard-navigates to the response
// URL — the path-keyed cache key — dropping `?id=`, and the bare `/g` says
// "missing its password".
//
// The symptom needs two real builds; here one `out/` has two revisions and
// the build id never changes. So what is asserted is the cause's two halves:
// such a page is refused a payload, and the router's fallback navigation keeps
// its `?id=` (`payloadFor` in public/sw.js). `lib/sw.test.ts` covers the
// decision itself.
console.log("\nand with that page's build evicted under it:");
await fresh.evaluate((name) => caches.delete(name), oldShell);
const refused = await fresh.evaluate((id) =>
  fetch(`/g.txt?id=${id}&_rsc=probe`).then((r) => `answered ${r.status}`).catch(() => "refused"), g);
report(refused === "refused", "a payload it cannot be served is refused, not answered from this build", refused);

// And none of it must be felt: the app still navigates as it did.
await fresh.locator(`.topbar a[aria-label="Back"]`).click().catch(() => {});
try {
  // Back to the ledger, tapped from balances: again the address is what lands.
  await fresh.waitForURL((url) => url.pathname === "/g", { timeout: PATIENCE });
  await fresh.waitForSelector(".fab", { timeout: PATIENCE });
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
try {
  // Inside the try: this navigation goes through the worker's redirect and on
  // into the route, and a slow one taking the whole check out with a stack
  // trace loses every assertion above it as well as this one.
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
// And the point of all of it: the build it just took still works with no network.
// `page` is untouched on the front door, so the deploy above reloads it under
// us — and a network cut while that load is in flight is a blank screen this
// check would report as a build that cannot paint itself offline. So wait for
// it to be standing on the list again before pulling the plug.
await page.waitForSelector(".rows a.row", { timeout: PATIENCE });
await ctx.setOffline(true);
await tap("the new build loads offline too", () => openGroupsList(page, base), ".rows a.row");

await browser.close();
close();
finish();
