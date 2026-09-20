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
 * It also holds the other thing a phone keyboard does to a form: the confirm
 * key, which on a field drawn promising "next" has to leave the caret in the
 * field below it (`walkFields`, components/viewport.tsx). That half needs no
 * faking — a headless browser presses Enter like any other.
 *
 * There is no keyboard in a headless browser, so one is faked where the app
 * reads it — `visualViewport.height` — and the app answers as it would on a
 * phone: `gapOf` calls the gap a keyboard, `--kb` is paid, and the scroll that
 * follows is the app's own (components/viewport.tsx). Nothing here reaches past
 * that into the fix itself. The assertion is what a thumb cares about: the
 * field *and* the act still above the top of the keys.
 */
import { ensureBuild, serveExport, launch, newPhone, newGroup, PATIENCE, reporter, settle }
  from "./lib/harness.mjs";

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
  // The app answers a resize a frame later and scrolls the frame after that,
  // on purpose: the scroll has to read the padding that measurement pays for,
  // not the one before it (components/viewport.tsx). So wait for the measure
  // to have landed — `--kb` is the app saying there is a keyboard — and then
  // for the scroll it starts to stop moving. A pause in place of either was a
  // measurement taken before the app had answered, which reads as an act
  // behind the keys on a machine that is merely busy.
  await page.waitForFunction(
    () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--kb")) > 0,
    null, { timeout: PATIENCE },
  );
  await scrollSettled();
}

/** The scroller, two frames in a row without moving. */
const scrollSettled = () => page.waitForFunction(() => new Promise((ok) => {
  const scroll = document.querySelector(".scroll, .dialog");
  if (!scroll) return ok(true);
  const at = scroll.scrollTop;
  requestAnimationFrame(() => requestAnimationFrame(() => ok(scroll.scrollTop === at)));
}), null, { timeout: PATIENCE });

/** Put it away again, for a screen reached without a reload. */
async function closeKeyboard() {
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    delete window.visualViewport.height;
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await page.waitForFunction(
    () => !(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--kb")) > 0),
    null, { timeout: PATIENCE },
  );
  await scrollSettled();
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
await settle(page, 150);
await openKeyboard();
await clears("/new — and with a name still in the row", "button.btn-lg");

// ---- which one are you ---------------------------------------------------
await field().fill("");
await closeKeyboard();
await page.getByRole("button", { name: "Create" }).click();
// The screen this lands on, rather than a moment long enough to have reached it.
await page.waitForSelector(".rows button.row");
await openKeyboard();
await clears("which one are you — Continue is above the keys", ".pad .btn");

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

// ---- the confirm key ----------------------------------------------------
/**
 * Where the caret is, named the way a failure can be read: a field's id where
 * it has one, its label otherwise. `"nothing"` is a field put down, which is
 * what the end of a chain does.
 */
const caret = () => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return "nothing";
  return el.id || el.getAttribute("aria-label") || el.tagName.toLowerCase();
});

// The group name hands over to the row the people go in — two fields nothing
// else on that screen sits between.
await page.goto(`${base}/new`);
await page.locator("#g-name").focus();
await page.keyboard.press("Enter");
report(await caret() === "Add someone",
  "/new — the confirm key takes the caret from the name to the add row",
  `caret on ${await caret()}`);

// The entry form: the amount hands over to what it was for. The date between
// that and the split is a spinner the walk steps over.
await page.goto(`${base}/g/entry/edit?id=${groupId}`);
await page.locator("input.amount").focus();
await page.keyboard.press("Enter");
report(await caret() === "what", "the entry form — the amount hands the caret to the note",
  `caret on ${await caret()}`);

// The note is the end of that chain, not a way into the split underneath: the
// column of figures is the chain a thumb starts on purpose, by tapping a row.
await page.getByRole("button", { name: "As amounts" }).click();
await settle(page, 120);
await page.locator("#what").focus();
await page.keyboard.press("Enter");
report(await caret() === "nothing",
  "the entry form — the note folds the keyboard rather than entering the column",
  `caret on ${await caret()}`);

// A column of figures is the case this is for: one press per person, down the
// list, without a tap between any two of them.
await page.locator("input.splitin").first().focus();
const walked = [await caret()];
for (let i = 1; i < CROWD.length; i++) {
  await page.keyboard.press("Enter");
  walked.push(await caret());
}
report(new Set(walked).size === CROWD.length && walked.every((id) => id.startsWith("sp-")),
  "one press per person walks the whole column",
  `${walked.length} rows, ${new Set(walked).size} of them distinct`);

// And the last of them folds the keyboard — never a wrap round to the top of
// the list it has just been walked down.
await page.keyboard.press("Enter");
report(await caret() === "nothing", "the last row folds the keyboard",
  `caret on ${await caret()}, was ${walked[walked.length - 1]}`);

// The other column, on a screen of its own and with its own idea of which row
// is the last one: who actually paid.
await page.locator("input.amount").fill("60");
await page.locator(".pick-sub").click();
await page.waitForURL(/\/g\/payers/);
await page.locator("input.splitin").first().focus();
const payers = [await caret()];
for (let i = 1; i < CROWD.length; i++) {
  await page.keyboard.press("Enter");
  payers.push(await caret());
}
await page.keyboard.press("Enter");
report(new Set(payers).size === CROWD.length
  && payers.every((id) => id.startsWith("payer-"))
  && await caret() === "nothing",
  "payers — one press per person, and the last of them folds the keyboard",
  `${new Set(payers).size} distinct rows, ended on ${await caret()}`);

// Every other field on a screen is the end of a chain of one, and ends it the
// same way. The add row is the exception that must not change: it is a form,
// and its Enter files the name and hands the caret straight back.
await page.goto(`${base}/new`);
await page.locator("#g-name").fill("Trip");
await page.getByLabel("Add someone").fill("Ana");
await page.keyboard.press("Enter");
report(await caret() === "Add someone" && await page.locator(".rows .rtitle").count() === 1,
  "/new — the add row still files the name and keeps the caret",
  `caret on ${await caret()}`);

await browser.close();
close();
finish();
