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
import { ensureBuild, launch, newPhone, newGroup, openGroupsList, reporter, serveExport, settle }
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

const ctx = await newPhone(browser);
await ctx.addInitScript(SHAPE);

// ---- 1. the walk in from the groups list -------------------------------
// Every door into a group is pushed from `/`, so the list is under the ledger
// and the device's back button climbs the app rather than leaving it.
{
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
  await page.close();
}

// ---- 2. an entry, and the arrow that climbs out of it -------------------
{
  const page = await ctx.newPage();
  await newGroup(page, base, { name: "Trip", me: "Theo", members: ["Marie"] });
  await page.waitForURL(/\/g\?id=/);
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
  await newGroup(page, base, { name: "Trip", me: "Theo", members: ["Marie"] });
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
  const page = await ctx.newPage();
  const g = await newGroup(page, base, { name: "Trip", me: "Theo", members: ["Marie"] });
  const cold = await ctx.newPage();
  await cold.goto(`${base}/g?id=${g}`);
  await cold.waitForSelector(".topbar .iconbtn");
  await is(cold, "a cold ledger has nothing behind it", { i: 0, urls: ["/g?id=G"] });
  await arrow(cold);
  await is(cold, "its arrow swaps the list in rather than going back", { i: 0, urls: ["/"] });
  await page.close();
  await cold.close();
}

// ---- 5. the quick split -------------------------------------------------
{
  const page = await ctx.newPage();
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
  const page = await ctx.newPage();
  await newGroup(page, base, { name: "Trip", me: "Theo", members: ["Marie"] });
  await page.waitForURL(/\/g\?id=/);
  await page.locator(".fab").last().click();
  await page.waitForURL(/\/g\/entry\/edit/);
  await page.locator("#what").fill("Half-typed");
  const before = await stack(page);
  // `page.goBack()` is what the device's button is: Chromium reports it
  // `userInitiated` and `cancelable`, which is the pair the guard reads. A
  // keyboard shortcut is not — headless Chromium binds none, and
  // `Alt+ArrowLeft` fires no `navigate` at all, so a check written with it
  // passes by never pressing anything.
  await page.goBack().catch(() => {});
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

await browser.close();
close();
finish();
