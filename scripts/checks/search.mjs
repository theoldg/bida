#!/usr/bin/env node
/**
 * `pnpm verify search` — the ledger's search bar, through each of its states.
 *
 * What is found is `searchLedger`'s, and unit-tested (`lib/ledger.test.ts`).
 * This is the other half, which no unit test reaches: where the bar is, and
 * where the list is put under it (components/ledger-search.tsx) — away at the
 * head, out with the scroll a pixel for a pixel, out whole from the group
 * menu with the list glided to the base state, standing in the column over
 * results, back at the base state when cleared, and away again when let go of.
 *
 * Every wait is on the state itself — the scroller's offset, how much of the
 * bar is drawn — since each move is a glide or a slide on the app's own clock.
 */
import { onePhone, newPhone, newGroup, openDemo, PATIENCE, settle } from "../lib/harness.mjs";

const { base, close, browser, report, finish } = await onePhone();

/** Everything a section asserts on, read in one go. */
const read = (page) => page.evaluate(() => {
  const box = document.querySelector(".scroll");
  const dock = document.querySelector(".searchdock");
  const bar = dock.querySelector(".searchbar");
  const field = bar.querySelector("input");
  const rows = box.querySelector(".lrows");
  const first = rows.firstElementChild;
  const top = (el) => Math.round(el.getBoundingClientRect().top);
  // How much of the bar shows under the clip, 0 to 1, off the screen rather
  // than off `--shown`: what is drawn is what a thumb sees.
  const clip = dock.querySelector(".searchclip").getBoundingClientRect();
  const drawn = bar.getBoundingClientRect();
  const visible = getComputedStyle(bar).visibility !== "hidden";
  return {
    top: Math.round(box.scrollTop),
    // The `scrollTop` that puts the first row at the bar's foot.
    base: Math.max(0, Math.round(box.scrollTop + rows.getBoundingClientRect().top - box.getBoundingClientRect().top - bar.offsetHeight)),
    shown: visible ? Math.round(100 * Math.max(0, drawn.bottom - clip.top) / drawn.height) / 100 : 0,
    on: dock.hasAttribute("data-on"),
    room: dock.hasAttribute("data-room"),
    caret: document.activeElement === field,
    query: field.value,
    // How far the first thing in the list sits under the bar's foot.
    gap: first ? top(first) - Math.round(drawn.bottom) : null,
    head: document.querySelector(".mysum")?.checkVisibility() ?? false,
    labels: [...rows.querySelectorAll(".daylabel")].map((el) => el.textContent),
    titles: [...rows.querySelectorAll(".rtitle")].map((el) => el.textContent),
    clear: bar.querySelector(".searchclear") !== null,
  };
});

/** Wait for a reading, then hand it back; a miss reports what was there instead. */
async function until(page, test, timeout = PATIENCE) {
  const end = Date.now() + timeout;
  for (;;) {
    const now = await read(page);
    if (test(now) || Date.now() > end) return now;
    await settle(page, 30);
  }
}

/**
 * How much of the bar is drawn, frame by frame, from now until `watched`: a
 * slide is recorded rather than sampled, since it is over in a few frames.
 */
const watch = (page) => page.evaluate(() => {
  const bar = document.querySelector(".searchbar");
  const clip = document.querySelector(".searchclip");
  window.__seen = [];
  const tick = () => {
    const b = bar.getBoundingClientRect();
    const drawn = getComputedStyle(bar).visibility === "hidden" ? 0 : (b.bottom - clip.getBoundingClientRect().top) / b.height;
    window.__seen.push(Math.min(1, Math.max(0, drawn)));
    window.__watch = requestAnimationFrame(tick);
  };
  tick();
});
const watched = (page) => page.evaluate(() => { cancelAnimationFrame(window.__watch); return window.__seen; });

/**
 * The same, across a way back: each frame finds the bar afresh, since the
 * screen it was on is gone, and frames without the ledger are left out. Each
 * reading is taken after that frame's layout, just before it is painted: an
 * observer made to fire every frame runs last, after every frame callback.
 */
const watchArrival = (page) => page.evaluate(() => {
  window.__seen = [];
  const probe = document.body.appendChild(document.createElement("div"));
  probe.style.cssText = "position: fixed; left: -9px; top: 0; height: 1px";
  const read = new ResizeObserver(() => {
    const bar = document.querySelector(".searchbar");
    if (!bar || !document.querySelector(".lrows .row")) return;
    const clip = document.querySelector(".searchclip").getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    const drawn = getComputedStyle(bar).visibility === "hidden" ? 0 : (b.bottom - clip.top) / b.height;
    window.__seen.push({ shown: Math.round(100 * Math.min(1, Math.max(0, drawn))) / 100, top: Math.round(document.querySelector(".scroll").scrollTop) });
  });
  read.observe(probe);
  let odd = false;
  const tick = () => {
    probe.style.width = (odd = !odd) ? "2px" : "1px";
    window.__watch = requestAnimationFrame(tick);
  };
  tick();
  window.__unwatch = () => { read.disconnect(); probe.remove(); };
});
const arrived = (page) => page.evaluate(() => { cancelAnimationFrame(window.__watch); window.__unwatch(); return window.__seen; });
/** Out by the back arrow, with what each frame of the way in drew. */
async function wayBack(page, row) {
  const left = await read(page);
  await row.click();
  await page.waitForURL(/\/g\/entry\?/);
  await page.waitForSelector(".topbar .iconbtn");
  await watchArrival(page);
  await page.locator(".topbar .iconbtn").first().click();
  await page.waitForURL(/\/g\?id=/);
  await page.waitForSelector(".lrows .row");
  await settle(page, 400);
  return { left, seen: await arrived(page) };
}
/** The frames of a way in that did not draw the bar whole, or the list where it was left. */
const astray = ({ left, seen }) => seen.filter((f) => f.shown !== 1 || f.top !== left.top);
/** Frames that drew the bar part-way. */
const partWay = (seen) => seen.filter((v) => v > 0.02 && v < 0.98).length;

const scrollTo = (page, y) => page.evaluate((to) => { document.querySelector(".scroll").scrollTop = to; }, y);
const field = (page) => page.locator(".searchbar input");
const summon = async (page) => {
  await page.locator(".topbar .iconbtn[aria-haspopup='menu']").click();
  // By its icon: the word is copy's to change.
  await page.locator(".rowmenu-item:has(use[href='#i-search'])").click();
};
const say = (state) => JSON.stringify(state);

// A short phone: the demo's ledger scrolls on it, and needs no form to make.
const short = await newPhone(browser, { viewport: { width: 390, height: 480 } });
const page = await short.newPage();
page.on("pageerror", (e) => report(false, "uncaught page error", e.message));
await openDemo(page, base);
await page.waitForSelector(".rows a.row");
await page.waitForSelector(".skelveil", { state: "detached" });

// ---- 1. the scroll's door -------------------------------------------------
{
  let now = await read(page);
  report(!now.on && now.shown === 0, "at the head of the list the bar is away, and not drawn", say(now));
  const whole = now.base;

  // Half a bar short of the base state, half the bar: tied to the scroll.
  await scrollTo(page, whole - 25);
  now = await until(page, (s) => s.shown === 0.5);
  report(now.shown === 0.5 && now.on, "half a bar short of the base state, half of it shows", say(now));

  await scrollTo(page, whole);
  now = await until(page, (s) => s.shown === 1);
  report(now.shown === 1 && now.gap === 0, "at the base state it is whole, the first row at its foot", say(now));

  await scrollTo(page, whole + 300);
  now = await until(page, (s) => s.shown === 1 && s.top === whole + 300);
  report(now.shown === 1, "and stays whole further down the list", say(now));

  await scrollTo(page, 0);
  now = await until(page, (s) => !s.on);
  report(!now.on && now.shown === 0, "back at the head it is away again", say(now));

  // A fling: the list is past the base state in one frame, and the bar is not.
  await watch(page);
  await scrollTo(page, whole + 300);
  await until(page, (s) => s.shown === 1);
  let seen = await watched(page);
  report(partWay(seen) > 0, "a fling gets a slide, not a bar appearing whole", `${partWay(seen)} frames part-way of ${seen.length}`);
  await watch(page);
  await scrollTo(page, 0);
  await until(page, (s) => !s.on);
  seen = await watched(page);
  report(partWay(seen) > 0, "and it slides away behind a fling back", `${partWay(seen)} frames part-way of ${seen.length}`);
}

// ---- 2. the menu's door, and letting go -----------------------------------
{
  await watch(page);
  await summon(page);
  let now = await until(page, (s) => s.caret && s.top === s.base && s.shown === 1);
  report(now.caret && now.top === now.base && now.top > 0 && now.shown === 1 && now.gap === 0,
    "Search in the menu puts the caret in the bar and glides the list to the base state", say(now));
  let seen = await watched(page);
  report(partWay(seen) > 0, "the bar eases out for it", `${partWay(seen)} frames part-way of ${seen.length}`);

  // The confirm key lets go; empty at the base state, the list goes home.
  await watch(page);
  await page.keyboard.press("Enter");
  now = await until(page, (s) => s.top === 0 && !s.on);
  report(now.top === 0 && !now.on && !now.caret, "let go of empty, the list glides back to its head and the bar goes with it", say(now));
  seen = await watched(page);
  report(partWay(seen) > 0, "as the scroll's: it leaves part by part", `${partWay(seen)} frames part-way of ${seen.length}`);
}

// ---- 3. a search, cleared -------------------------------------------------
{
  await summon(page);
  await until(page, (s) => s.caret && s.top === s.base);
  await field(page).fill("passage");
  let now = await until(page, (s) => s.labels.length === 1 && s.top === 0 && s.shown === 1);
  const hits = now.titles.length;
  report(hits > 0 && now.titles.every((t) => /passage/i.test(t)) && now.labels.length === 1,
    "typing narrows the rows, under one line saying where the word was found", say(now));
  report(!now.head && now.top === 0 && now.gap === 0 && now.shown === 1 && now.clear,
    "the head is gone and the bar stands in the column, results from its foot", say(now));

  // One more letter than anything holds.
  await field(page).fill("passagez");
  now = await until(page, (s) => s.titles.length === 0);
  report(now.titles.length === 0 && await page.locator(".searchroom .empty, .searchroom [class*='empty']").count() > 0,
    "a search that finds nothing says so", say(now));

  // A space alone finds everything, and still counts as searching.
  await field(page).fill(" ");
  now = await until(page, (s) => s.titles.length > hits);
  report(now.titles.length > hits && !now.head, "a space alone lists the whole ledger with the head still away", say(now));

  await field(page).fill("passage");
  await until(page, (s) => s.titles.length === hits);
  await page.locator(".searchclear").tap();
  now = await until(page, (s) => s.query === "" && s.top === s.base && s.head);
  // Not the caret: with no keyboard up, as here, a press on any button puts
  // a field down (`HoldCaret`, components/viewport.tsx).
  report(now.query === "" && !now.clear, "the cross empties the field, and goes with what it cleared", say(now));
  report(now.top === now.base && now.top > 0 && now.shown === 1 && now.gap === 0 && now.head,
    "and the list is at the base state: whole ledger, first row at the bar's foot", say(now));

  // The slide a cleared search must not show: watched, not sampled.
  await field(page).fill("passage");
  await until(page, (s) => s.titles.length === hits);
  await watch(page);
  await page.locator(".searchclear").tap();
  await until(page, (s) => s.query === "" && s.top === s.base);
  await settle(page, 400);
  const least = Math.min(...await watched(page));
  report(least > 0.98, "the bar never draws part-way back while a search is cleared", `least shown ${least.toFixed(2)}`);
}

// ---- 4. a finger on the list ----------------------------------------------
{
  // The caret in the empty bar, at the base state the clear above left.
  await field(page).focus();
  let now = await until(page, (s) => s.caret);
  await page.evaluate(() => {
    const box = document.querySelector(".scroll");
    box.dispatchEvent(new Event("touchmove", { bubbles: true }));
  });
  await settle(page, 600);
  now = await read(page);
  report(!now.caret && now.top === now.base && now.shown === 1,
    "a drag on the list lets go of the field, and nothing glides: the finger is driving", say(now));
  await scrollTo(page, 0);
  await until(page, (s) => !s.on);
}

// ---- 5. a way back draws the bar where it was from its first frame --------
{
  // Out with the scroll, not held: placed only by where the list is put back.
  const whole = (await read(page)).base;
  await scrollTo(page, whole + 120);
  await until(page, (s) => s.shown === 1 && s.top === whole + 120);
  // A row already on the screen, so nothing scrolls it there first.
  const row = page.locator(".rows a.row").filter({ visible: true }).nth(1);
  const trip = await wayBack(page, row);
  report(trip.seen.length > 0 && astray(trip).length === 0,
    "back from an entry, the bar is out from the ledger's first frame",
    `${astray(trip).length} of ${trip.seen.length} frames astray, first ${say(trip.seen[0])}, left ${trip.left.top}`);
  await scrollTo(page, 0);
  await until(page, (s) => !s.on);
}

// ---- 6. a query is kept for the way back, and only for that --------------
{
  await summon(page);
  await until(page, (s) => s.caret && s.top === s.base);
  await field(page).fill("passage");
  const before = await until(page, (s) => s.labels.length === 1 && s.titles.length > 0);
  await page.locator(".rows a.row").first().click();
  await page.waitForURL(/\/g\/entry\?/);
  await page.locator(".topbar .iconbtn").first().click();
  await page.waitForURL(/\/g\?id=/);
  await page.waitForSelector(".searchbar");
  let now = await until(page, (s) => s.query === "passage" && s.titles.length === before.titles.length && s.shown === 1);
  report(now.query === "passage" && now.titles.join() === before.titles.join() && !now.head && now.shown === 1,
    "back from a result, the search is as it was left", say(now));

  // Up to the list and in again by a tap: a fresh visit.
  await page.locator(".topbar .iconbtn").first().click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.locator(".rows a.row, .rows button.row").first().click();
  await page.waitForURL(/\/g\?id=/);
  await page.waitForSelector(".rows a.row");
  now = await until(page, (s) => s.query === "" && s.head && !s.on);
  report(now.query === "" && now.head && !now.on && now.top === 0, "a tap into the group starts blank, at the top", say(now));
}
await short.close();

// ---- 7. a list too short to scroll ----------------------------------------
{
  const ctx = await newPhone(browser);
  const tall = await ctx.newPage();
  tall.on("pageerror", (e) => report(false, "uncaught page error", e.message));
  await newGroup(tall, base, { name: "Trip", me: "Ana", members: ["Bo"] });
  // One row: an empty ledger has no first row to bring to the bar's foot.
  await tall.locator("a.fab:not(.fab-2)").click();
  await tall.locator("input.amount").fill("12");
  await tall.locator("#what").fill("Taxi");
  await tall.getByRole("button", { name: "Save" }).click();
  await tall.waitForURL(/\/g\?id=/);
  await tall.waitForSelector(".rows a.row");
  // The saved row's wash is the list's to finish first.
  await tall.waitForFunction(() => !document.querySelector(".rows .saved"), null, { timeout: PATIENCE });
  await tall.waitForSelector(".skelveil", { state: "detached" });
  await summon(tall);
  // The bar's ease outlasts the shortest glide: wait for both.
  let now = await until(tall, (s) => s.caret && s.top === s.base && s.top > 0 && s.shown === 1);
  report(now.caret && now.top === now.base && now.top > 0 && now.room && now.shown === 1,
    "a list too short to scroll is lent the room to reach the base state", say(now));
  // Lent room is lent again on the way back, or the list could not be put
  // back where it was left: it would stop short, with the bar away.
  const trip = await wayBack(tall, tall.locator(".rows a.row").first());
  report(trip.left.top > 0 && trip.seen.length > 0 && astray(trip).length === 0,
    "and back from its one entry, the list is at the base state again with the bar out",
    `${astray(trip).length} of ${trip.seen.length} frames astray, first ${say(trip.seen[0])}, left ${trip.left.top}`);
  await field(tall).focus();
  await until(tall, (s) => s.caret);
  await tall.keyboard.press("Enter");
  now = await until(tall, (s) => s.top === 0 && !s.on && !s.room);
  report(now.top === 0 && !now.on && !now.room, "and gives it back once it is at its head with the bar away", say(now));
  await ctx.close();
}

await browser.close();
close();
finish();
