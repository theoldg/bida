#!/usr/bin/env node
/**
 * `pnpm nav` — where the back arrow goes, and what it leaves on the stack.
 *
 * The destination is the easy half. The half that fails silently is the
 * **shape of the history behind it** — what the device's back button does
 * next. The same arrow traverses to a parent that is on the stack and
 * *replaces* into one that isn't, keeping forward entries in one case and
 * erasing them in the other (ADR-0007).
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
 * The session's history as the device's back button sees it: the current
 * entry and every entry's screen, ids masked (shape only). Installed in the
 * page so the wait for a shape and its reading are one function.
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
// Every door into a group is pushed from `/`, so the device's back button
// climbs the app rather than leaving it.
//
// The group made here is reused by every later section: building one (form,
// picker, claim) is the most expensive step, and these checks must stay cheap
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

  // The balance card is pressed into, so balances is pushed over the ledger
  // and its arrow goes back to it, leaving balances forward.
  await page.locator("a[href*='tab=balances']").first().click();
  await is(page, "the balance card pushes balances", { i: 2, urls: ["/", "/g?id=G", "/g?id=G&tab=balances"] });
  await arrow(page);
  await is(page, "balances' arrow goes back to the ledger", { i: 1, urls: ["/", "/g?id=G", "/g?id=G&tab=balances"] });
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
  // `page.goBack()` is the device's button: Chromium reports it
  // `userInitiated` and `cancelable`, which the guard reads. A keyboard
  // shortcut isn't — headless Chromium binds none, so `Alt+ArrowLeft` fires no
  // `navigate` and passes by pressing nothing.
  //
  // Not awaited: the press is meant to be cancelled, so no navigation lands and
  // awaiting would sit out the whole navigation ceiling. Await the dialog.
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
// `showModal()` registers a close watcher. A close request the browser won't
// let us refuse (on Android, the next back press after the one that opened
// the dialog) fires no `cancel` — the element just closes. If the screen
// doesn't hear it, `/new` keeps believing its dialog is up: its state is
// already `"discard"`, so every further press renders nothing and both back
// and the arrow go dead (components/dialog.tsx).
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

// ---- 8. and the recorder has the taps it was given ---------------------
// "It refused a bunch of taps" is a phone-only report with many possible
// causes in one short sequence — a lift on the card after a press on the
// button, a click that never came, a card over the keyboard. Guessing is
// unreliable, so the sequence is recorded while a dialog is up and /diag
// carries it (lib/press-trace.ts).
{
  const page = await (await phone()).newPage();
  await page.goto(`${base}/`);
  await page.waitForSelector(".starttile");
  await page.locator("a[href='/new']").click();
  await page.waitForURL(/\/new/);
  await page.locator("#g-name").fill("Trip");
  void page.goBack().catch(() => {});
  await page.waitForSelector(".scrim[open]").catch(() => {});

  // A run of taps that lands on the card and does nothing — the shape of the
  // report, and far more steps than either end of the line holds.
  for (let i = 0; i < 8; i++) await page.locator(".scrim .dtitle").click();
  // Then the one that works. Cancel is the left half of the row, so `btn0`.
  await page.locator(".scrim .drow .btn-s").click();
  await page.waitForFunction(() => !document.querySelector("dialog.scrim")).catch(() => {});

  await page.goto(`${base}/diag`);
  await page.waitForSelector("pre");
  const head = (await page.locator("pre").innerText()).split("---- this page")[0];
  const line = head.split("\n").find((l) => l.includes("dialog  ")) ?? "";
  report(/menus and dialogs, newest first:/.test(head),
    "a dialog's presses ride in the head of /diag, where a cut-short paste keeps them");
  report(/pointerdown@card/.test(line), "and a tap is named by the part it landed on",
    line || "no dialog trace at all");
  report(/card \d+-\d+ visible \d+-\d+ of \d+/.test(line),
    "with where the card was against what was on screen, which no event says", line);

  // Both ends, which is the whole point of the shape: a run of refused taps
  // must not push the one that worked off the end of the line.
  report(/…\d+ more…/.test(line), "a long run drops out of the middle, counted", line);
  report(/open guards=0 Discard/.test(line), "the head still holds the opening", line);
  report(/click@btn0/.test(line) && /gone dismissed/.test(line),
    "and the tail still holds the tap that ended it", line);
  await page.close();
}

// ---- 9. the traversal that never came, and the act happening anyway -------
// `history.go` can be called and not move — on Android, from an act tapped in
// a modal dialog, and from any act once a back press this app *refused* has
// left the phone holding an undelivered traversal. Stubbed to a no-op here,
// which is all the phone does.
//
// Two things must survive it: the card comes down (leaving closes any dialog
// *before* the going), and the act happens anyway — the going checks its
// traversal landed and otherwise puts the destination in this screen's place
// (lib/nav.ts). The latch not being left armed is `lib/nav.test.ts`'s.
//
// **The stuck moment in between is deliberately not asserted** — a read
// after a fixed pause is a bet on the repair's window (docs/testing.md). With
// `history.go` stubbed, landing at the parent at all proves the repair did it.
{
  const page = await (await phone()).newPage();
  await page.goto(`${base}/`);
  await page.waitForSelector(".starttile");
  await page.locator("a[href='/new']").click();
  await page.waitForURL(/\/new/);
  await page.locator("#g-name").fill("Trip");
  void page.goBack().catch(() => {});
  await page.waitForSelector(".scrim[open]");

  await page.evaluate(() => { window.history.go = () => {}; });
  await page.locator(".scrim .drow button").nth(1).click();
  await page.waitForFunction(() => !document.querySelector("dialog.scrim")).catch(() => {});
  report(await page.locator("dialog.scrim").count() === 0,
    "an act that cannot travel still takes its dialog down with it");

  // And then the check fires and the parent takes this screen's place, so the
  // button a phone read as dead does what it says after all.
  await page.waitForURL((url) => new URL(url).pathname === "/", { timeout: 4000 })
    .then(() => {}, () => {});
  const after = await stack(page);
  const landed = new URL(after.urls[after.i] ?? "http://x/nowhere", base).pathname === "/";
  report(landed, "and then the parent takes its place, so Discard is not dead after all",
    landed ? "" : `still at ${after.urls[after.i]}`);
  await page.close();
}

// ---- 10. Discard on a form one entry above the ledger --------------------
// A cold ledger is index 0, so the form is 1 and Discard traverses to 0 —
// which Android doesn't deliver after a refused press. `goBack` reads the
// entry behind it off the stack, so it has a destination to put in this
// screen's place (lib/nav.ts).
//
// The draft must not be thrown away before the going: a screen that failed
// to leave would then look like a fresh blank entry ("New" bar, no form).
{
  const page = await onLedger();
  await page.locator(".fab").last().click();
  await page.waitForURL(/\/g\/entry\/edit/);
  await page.locator("#what").fill("Half-typed");
  await is(page, "the form sits one entry above a cold ledger",
    { i: 1, urls: ["/g?id=G", "/g/entry/edit?id=G"] });

  void page.goBack().catch(() => {});
  await page.waitForSelector(".scrim[open]");

  // Recorded rather than sampled: the repair is quicker than a round trip to
  // ask, so a check that looks for the blank after the fact never sees it.
  await page.evaluate(() => {
    window.__blanked = false;
    const look = () => {
      const bar = document.querySelector(".topbar h3");
      if (bar?.textContent === "New" && !document.querySelector("#what")) window.__blanked = true;
    };
    new MutationObserver(look).observe(document.body, { childList: true, subtree: true });
  });

  // What the phone does, and the whole of it: `history.back` returns, nothing
  // moves, and no `navigate` ever comes to say so.
  await page.evaluate(() => { window.history.back = () => {}; });
  await page.locator(".scrim .drow button").nth(1).click();
  await page.waitForURL((url) => new URL(url).pathname === "/g", { timeout: 4000 })
    .then(() => {}, () => {});
  const after = await stack(page);
  const landed = /^\/g\?/.test(after.urls[after.i] ?? "");
  report(landed, "Discard leaves a form the traversal cannot carry out of",
    landed ? "" : `still at ${after.urls[after.i]}`);
  report(await page.evaluate(() => window.__blanked) === false,
    "and never draws the blank \"New\" that made this read as a fresh entry");
  await page.close();
}

await browser.close();
close();
finish();
