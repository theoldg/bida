#!/usr/bin/env node
/**
 * `pnpm nav` — where the back arrow goes, and what it leaves on the stack.
 *
 * The arrow's destination is the easy half, and the one the other checks
 * already stumble over on their way somewhere else. The half nothing watched is
 * the **shape of the history behind it**: whether the screens you left are
 * still there, and so what the device's back button does on the next press.
 * Those two came apart silently — the same arrow on the same screen traversed
 * to its parent when the parent was on the stack and *replaced* it when it was
 * not, keeping what it left forward in the first case and erasing it in the
 * second, with nothing able to tell them apart (ADR-0007).
 *
 * So every assertion here reads `navigation.entries()`, never `location`.
 */
import { ensureBuild, launch, newPhone, openGroupsList, reporter, serveExport, settle }
  from "./lib/harness.mjs";

ensureBuild();
const { base, close } = await serveExport();
const browser = await launch();
const { report, finish } = reporter();

/**
 * The session's history as the device's back button sees it: which entry we are
 * standing on, and every entry's screen. Ids are masked — this is about shape,
 * and a group id changes every run.
 *
 * Installed in the page rather than passed to each `evaluate`, so the wait for
 * a shape and the reading of it are the same function and cannot drift.
 */
const SHAPE = () => {
  window.__shape = () => {
    const screen = (url) => {
      const u = new URL(url);
      return (u.pathname + u.search)
        .replace(/(\?|&)id=[^&]*/, "$1id=G").replace(/(\?|&)e=[^&]*/, "$1e=E")
        .replace(/(\?|&)title=[^&]*/, "").replace(/\/$/, "") || "/";
    };
    const nav = window.navigation;
    return { i: nav.currentEntry?.index, urls: nav.entries().map((e) => screen(e.url)) };
  };
};

const stack = (page) => page.evaluate(() => window.__shape());

/**
 * Wait for the history to read as `want`, then say whether it does — the
 * condition, not a duration, and the ceiling is only reached on a red run.
 */
async function is(page, label, want) {
  const wanted = JSON.stringify(want);
  await page.waitForFunction((w) => JSON.stringify(window.__shape()) === w, wanted).catch(() => {});
  const got = JSON.stringify(await stack(page));
  report(got === wanted, label, got === wanted ? "" : `wanted ${wanted}\n        got    ${got}`);
}

/** The screen's own back arrow. What follows waits for where it went. */
const arrow = (page) => page.locator(".topbar .iconbtn").first().click();

/**
 * A phone with nothing on it, so `/` is the groups list rather than the group
 * it would otherwise resume into (`lib/launch.ts`). The two sections that start
 * on the list get one each; the rest share a phone with groups on it.
 */
async function phone() {
  const ctx = await newPhone(browser);
  await ctx.addInitScript(SHAPE);
  return ctx;
}

const ctx = await phone();

// ---- 1. the walk in from the groups list -------------------------------
// Every door into a group is pushed from `/`, so the list is under the ledger
// and the device's back button climbs the app rather than leaving it.
//
// The group this makes is the one the rest of the sections stand on: building
// one is the most expensive thing here — a form, a picker and a claim — and
// these checks are only honest while they stay cheap to run
// ([testing.md](../docs/testing.md)).
const group = await (async () => {
  const page = await ctx.newPage();
  await page.goto(`${base}/`);
  await page.waitForSelector(".starttile");
  await page.locator("a[href='/new']").click();
  await page.waitForURL(/\/new/);
  await page.locator("#g-name").fill("Trip");
  for (const m of ["Theo", "Marie"]) {
    await page.getByLabel("Add someone").fill(m);
    await page.keyboard.press("Enter");
  }
  await page.getByRole("button", { name: "Create" }).click();
  await page.locator("button.row").filter({ hasText: "Theo" }).first().click();
  await page.getByRole("button", { name: "Continue as Theo" }).click();
  await page.waitForURL(/\/g\?id=/);
  await is(page, "/new replaces itself with the ledger, over the list", { i: 1, urls: ["/", "/g?id=G"] });

  // The two tabs are one screen: switching doesn't deepen the history, and the
  // arrow on balances puts the ledger back in its place rather than going back.
  await page.locator("a[href*='tab=balances']").first().click();
  await is(page, "the balances tab replaces the ledger", { i: 1, urls: ["/", "/g?id=G&tab=balances"] });
  await arrow(page);
  await is(page, "balances' arrow swaps the ledger back in", { i: 1, urls: ["/", "/g?id=G"] });
  const id = new URL(page.url()).searchParams.get("id");
  await page.close();
  return id;
})();

/** That group's ledger, as a cold load: the stack starts here and nowhere else. */
async function onLedger() {
  const page = await ctx.newPage();
  await page.goto(`${base}/g?id=${group}`);
  await page.waitForSelector(".fab, .empty, .rows");
  return page;
}

// ---- 2. an entry, and the arrow that climbs out of it -------------------
{
  const page = await onLedger();
  await page.locator(".fab").last().click();
  await page.waitForURL(/\/g\/entry\/edit/);
  await page.locator("#what").fill("Dinner");
  await page.locator(".amountfield input, input.amount").first().fill("20");
  await is(page, "the form is pushed onto the ledger", { i: 1, urls: ["/g?id=G", "/g/entry/edit?id=G"] });
  await page.getByRole("button", { name: "Save" }).click();
  await is(page, "Save goes back to the ledger, and leaves the form forward",
    { i: 0, urls: ["/g?id=G", "/g/entry/edit?id=G"] });

  await page.waitForSelector(".rows a.row");
  await page.locator(".rows a.row").first().click();
  await page.waitForURL(/\/g\/entry\?/);
  await arrow(page);
  await is(page, "an entry's arrow goes back to the ledger",
    { i: 0, urls: ["/g?id=G", "/g/entry?id=G&e=E"] });
  await page.close();
}

// ---- 3. the tip jar: a screen the form is opened from -------------------
// Saving lands on the balances the tip screen was reached from — past the tip
// screen as well as the form, since stopping there is stopping on a screen
// nobody asked to see again.
{
  const page = await ctx.newPage();
  // In through the list, so the shape under the ledger is the one a thumb makes.
  await openGroupsList(page, base);
  await page.locator(".grouprow").first().click();
  await page.waitForURL(/\/g\?id=/);
  await page.locator("a[href*='tab=balances']").first().click();
  await page.waitForURL(/tab=balances/);
  await page.locator(".fab").last().click();
  await page.waitForURL(/\/g\/tip/);
  await page.locator("a[href*='/g/entry/edit']").first().click();
  await page.waitForURL(/\/g\/entry\/edit/);
  await page.locator(".amountfield input, input.amount").first().fill("5");
  const before = await stack(page);
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/tab=balances/);
  const after = await stack(page);
  const landed = after.urls[after.i];
  report(landed === "/g?id=G&tab=balances", "the tip's Save lands on balances",
    landed === "/g?id=G&tab=balances" ? "" : `on ${landed}`);
  report(after.i === before.i - 2, "past the tip screen as well as the form",
    after.i === before.i - 2 ? "" : `i went ${before.i} -> ${after.i}`);
  const kept = JSON.stringify(after.urls) === JSON.stringify(before.urls);
  report(kept, "and leaves both of them forward rather than erasing them",
    kept ? "" : `${JSON.stringify(before.urls)}\n        became ${JSON.stringify(after.urls)}`);
  await page.close();
}

// ---- 4. a cold load, with nothing behind it -----------------------------
// A shared link opens the document on the screen itself, so the parent was
// never visited. The arrow puts it in this screen's place — which is the whole
// of the degradation, and the ordinary case of it rather than a rare one.
{
  const cold = await onLedger();
  await is(cold, "a cold ledger has nothing behind it", { i: 0, urls: ["/g?id=G"] });
  await arrow(cold);
  await is(cold, "its arrow swaps the list in rather than going back", { i: 0, urls: ["/"] });
  await cold.close();
}

// ---- 5. the quick split -------------------------------------------------
{
  // Its own phone: `/` on one that has been in a group resumes into it.
  const page = await (await phone()).newPage();
  await page.goto(`${base}/`);
  await page.waitForSelector(".starttile");
  await page.locator("a[href='/quick']").click();
  await page.waitForURL(/\/quick$/);
  await is(page, "/quick is pushed onto the list", { i: 1, urls: ["/", "/quick"] });
  await arrow(page);
  await is(page, "and its arrow goes back to the list", { i: 0, urls: ["/", "/quick"] });
  await page.close();
}

// ---- 6. the press guard, on a screen holding typed work -----------------
// The one thing plain navigation cannot do: a back press that is a question,
// not a navigation. Cancelled outright — the dialog is the whole of the answer
// and the screen stays put (ADR-0007).
{
  const page = await onLedger();
  await page.locator(".fab").last().click();
  await page.waitForURL(/\/g\/entry\/edit/);
  await page.locator("#what").fill("Half-typed");
  const before = await stack(page);
  // `page.goBack()` is what the device's button is: Chromium reports it
  // `userInitiated` and `cancelable`, which is the pair the guard reads. A
  // keyboard shortcut is not — headless Chromium binds none, and
  // `Alt+ArrowLeft` fires no `navigate` at all, so a check written with it
  // passes by never pressing anything.
  //
  // Not awaited, because the whole point is that the press is cancelled: no
  // navigation ever lands, so the call sits out the navigation ceiling — a
  // minute of this check's life, spent waiting for the one thing it asserts
  // will not happen. What is awaited is the dialog.
  void page.goBack().catch(() => {});
  const asked = await page.waitForSelector(".scrim").then(() => true, () => false);
  report(asked, "a back press on a half-typed form asks before leaving");
  // The one wait with no condition to wait for: the assertion is that the
  // screen did *not* move, and a cancelled press has nothing to announce.
  await settle(page, 300);
  const after = await stack(page);
  const stayed = after.i === before.i && /entry\/edit/.test(after.urls[after.i] ?? "");
  report(stayed, "and the press is cancelled outright — the screen stays put",
    stayed ? "" : `moved to ${after.urls[after.i]}`);
  await page.close();
}

// ---- 7. the dialog the platform shuts by itself ------------------------
// The press guard answers with a dialog, and `showModal()` registers a close
// watcher with it. A close request the browser will not let us refuse — on
// Android the next back press, since the one that opened the dialog spent the
// document's history-action activation — fires no `cancel`: the element just
// closes. If the screen does not hear that, it goes on believing its dialog is
// up, and on `/new` that belief is the answer every further press gets: the
// state is already `"discard"`, so setting it renders nothing, and the back
// button and the arrow both go dead with nothing on screen
// (components/dialog.tsx).
{
  const page = await (await phone()).newPage();
  await page.goto(`${base}/`);
  await page.waitForSelector(".starttile");
  await page.locator("a[href='/new']").click();
  await page.waitForURL(/\/new/);
  await page.locator("#g-name").fill("Trip");
  void page.goBack().catch(() => {});
  await page.waitForSelector(".scrim").catch(() => {});
  report(await page.locator(".scrim[open]").count() === 1, "a back press on a half-typed /new asks too");

  // What the close watcher does, done to the element directly: closed, with no
  // `cancel` to hear it by. Driving the real one takes an Android back press.
  await page.evaluate(() => document.querySelector("dialog.scrim")?.close());
  await page.waitForFunction(() => !document.querySelector("dialog.scrim")).catch(() => {});
  const heard = await page.locator("dialog.scrim").count() === 0;
  report(heard, "the screen hears the platform shut it, and stops drawing it",
    heard ? "" : "the element is still mounted — the screen thinks its dialog is up");

  void page.goBack().catch(() => {});
  const again = await page.waitForSelector(".scrim[open]").then(() => true, () => false);
  report(again, "so the next press asks again rather than being swallowed");
  await settle(page, 200);
  const here = await stack(page);
  report(/\/new/.test(here.urls[here.i] ?? ""), "and the typed group is still on screen");
  await page.close();
}

await browser.close();
close();
finish();
