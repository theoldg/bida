#!/usr/bin/env node
/**
 * `pnpm keyboard` — the act a list of names is typed for survives the keyboard.
 *
 * Four screens ask for people in the same add row, and each ends on the act
 * those people are for: `/new`'s Create, the picker's "Continue as …", the
 * quick split's scan pair, the people menu's "Change who you are". All four put
 * that act *below* the row, on the scroll rather than in a pinned foot
 * (design-system) — so the scroll that lifts the field over the keyboard is the
 * same one that can leave the act under it. What keeps them together is one
 * number, `--act-below`, and nothing else here would notice it going stale: a
 * button gains a line, a row gains padding, and the fix is quietly a few pixels
 * short on a phone nobody in this repo is holding.
 *
 * There is no keyboard in a headless browser, so one is faked where the app
 * reads it — `visualViewport.height` — and the app answers as it would on a
 * phone: `gapOf` calls the gap a keyboard, `--kb` is paid, and the scroll that
 * follows is the app's own (components/viewport.tsx). Nothing here reaches past
 * that into the fix itself. The assertion is what a thumb cares about: the
 * field *and* the act still above the top of the keys.
 */
import { ensureBuild, serveExport, launch, newPhone, newGroup, reporter } from "./lib/harness.mjs";

ensureBuild();
const { base, close } = await serveExport();
const browser = await launch();
const ctx = await newPhone(browser);
const page = await ctx.newPage();
const { report, finish } = reporter(page);

/** A phone keyboard, roughly: iOS with its accessory bar over a 844pt screen. */
const KB = 336;

const field = () => page.getByLabel("Add someone");

/**
 * Enough people that the list outgrows the screen — which is the only state
 * this is about. A group of three fits above the keyboard whatever the scroll
 * does, and a check that green-lights the fix being deleted is worse than none.
 */
const CROWD = ["Ana", "Bo", "Cy", "Dee", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jo"];

/**
 * Open the keyboard on the add row, the way a thumb does: the caret first —
 * which is what makes a gap a keyboard at all (`lib/viewport.ts`) — and then
 * the strip it covers.
 */
async function openKeyboard() {
  await field().focus();
  await page.evaluate((kb) => {
    const view = window.visualViewport;
    Object.defineProperty(view, "height", {
      configurable: true, get: () => window.innerHeight - kb,
    });
    view.dispatchEvent(new Event("resize"));
  }, KB);
  // The app answers a resize two frames later, on purpose: the scroll has to
  // read the padding that measurement pays for, not the one before it.
  await page.waitForTimeout(250);
}

/** Put it away again, for a screen reached without a reload. */
async function closeKeyboard() {
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    delete window.visualViewport.height;
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(250);
}

/**
 * What is left above the keys once the app has done its scrolling. Both the
 * field and the act have to clear them; the margin each clears by is the
 * detail a failure needs.
 */
async function clears(label, actSelector) {
  const seen = await page.evaluate((selector) => {
    const input = document.querySelector(".addname");
    const act = document.querySelector(selector);
    const scroll = document.querySelector(".scroll");
    if (!input || !act || !scroll) return { missing: !input ? "add row" : !act ? selector : ".scroll" };
    const kb = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--kb"));
    // The top of the keys. The scroller ends behind them, so its own bottom
    // edge says nothing on its own.
    const keys = scroll.getBoundingClientRect().bottom - kb;
    return {
      kb,
      act: Math.round(keys - act.getBoundingClientRect().bottom),
      field: Math.round(keys - input.getBoundingClientRect().bottom),
    };
  }, actSelector);
  const ok = !seen.missing && seen.kb > 0 && seen.act >= 0 && seen.field >= 0;
  report(ok, label, seen.missing
    ? `no ${seen.missing} on this screen`
    : `keyboard ${seen.kb}px, act ${seen.act}px above the keys, field ${seen.field}px`);
}

// ---- creating a group ---------------------------------------------------
await page.goto(`${base}/new`);
await page.locator("#g-name").fill("Trip");
for (const who of CROWD) {
  await field().fill(who);
  await page.keyboard.press("Enter");
}
await openKeyboard();
await clears("/new — Create is above the keys", "button.btn-lg");

// The row is a box while a name sits unfiled in it, and a box is the taller of
// the two states: what clears the keys empty has to clear them drawn.
await field().fill("Di");
await page.waitForTimeout(150);
await openKeyboard();
await clears("/new — and with a name still in the row", "button.btn-lg");

// ---- which one is you ---------------------------------------------------
await field().fill("");
await closeKeyboard();
await page.getByRole("button", { name: "Create" }).click();
await page.waitForTimeout(250);
await openKeyboard();
await clears("which one is you — Continue is above the keys", ".pad .btn");

// ---- the quick split ----------------------------------------------------
await page.goto(`${base}/quick`);
await page.waitForSelector(".addname");
for (const who of CROWD) {
  await field().fill(who);
  await page.keyboard.press("Enter");
}
await openKeyboard();
await clears("quick split — the scan pair is above the keys", ".btn-pair");

// ---- the people menu ----------------------------------------------------
const [me, ...others] = CROWD;
const groupId = await newGroup(page, base, { name: "Trip", me, members: others });
await page.goto(`${base}/g/members?id=${groupId}`);
await page.waitForSelector(".ghostrow");
await openKeyboard();
await clears("people — changing who you are is above the keys", ".ghostrow");

await browser.close();
close();
finish();
