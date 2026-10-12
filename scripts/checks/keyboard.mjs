#!/usr/bin/env node
/**
 * `pnpm verify keyboard` — the act docked under a list of names (`.whodock`)
 * survives the keyboard, and the confirm key walks the fields. Headless browsers
 * have no keyboard, so one is faked where the app reads it: iOS's shrunken
 * `visualViewport`, or Android's page shrunk whole.
 */
import { onePhone, newGroup, PATIENCE, settle }
  from "../lib/harness.mjs";

const { base, close, browser, ctx, page, report, finish } = await onePhone();

const KB = 336;

const field = () => page.getByLabel(/^Add (someone|your name)$/);

/**
 * Only a list that outgrows the screen tests anything: three names fit above the
 * keyboard whatever the scroll does.
 */
const CROWD = ["Ana", "Bo", "Cy", "Dee", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jo"];

/** The caret first — which is what makes a gap a keyboard at all. */
async function openKeyboard() {
  await field().focus();
  await page.evaluate((kb) => {
    const view = window.visualViewport;
    Object.defineProperty(view, "height", {
      configurable: true, get: () => window.innerHeight - kb,
    });
    view.dispatchEvent(new Event("resize"));
  }, KB);
  // Wait for `--kb`, then for the scroll to stop: a fixed pause measures before
  // the app has answered.
  await page.waitForFunction(
    () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--kb")) > 0,
    null, { timeout: PATIENCE },
  );
  await scrollSettled();
}

const scrollSettled = () => page.waitForFunction(() => new Promise((ok) => {
  const scroll = document.querySelector(".scroll, .dialog");
  if (!scroll) return ok(true);
  const at = scroll.scrollTop;
  requestAnimationFrame(() => requestAnimationFrame(() => ok(scroll.scrollTop === at)));
}), null, { timeout: PATIENCE });

async function shrinkForKeyboard() {
  await field().focus();
  const { width, height } = page.viewportSize();
  await page.setViewportSize({ width, height: height - KB });
  await page.waitForFunction(() => document.documentElement.hasAttribute("data-kb"), null, { timeout: PATIENCE });
  await scrollSettled();
  return async () => {
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.setViewportSize({ width, height });
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-kb"), null, { timeout: PATIENCE });
  };
}

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

async function clears(label, actSelector) {
  const seen = await page.evaluate((selector) => {
    const input = document.querySelector(".addname");
    const act = document.querySelector(selector);
    if (!input || !act) return { missing: !input ? "add row" : selector };
    const kb = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--kb"));
    // The foot of what is visible, not the shell's foot less `--kb`, which would
    // check the app against its own arithmetic.
    const view = window.visualViewport;
    const keys = view.offsetTop + view.height;
    return {
      kb, up: document.documentElement.hasAttribute("data-kb"),
      act: Math.round(keys - act.getBoundingClientRect().bottom),
      field: Math.round(keys - input.getBoundingClientRect().bottom),
    };
  }, actSelector);
  // `data-kb`, not `--kb`: Android pays none.
  const ok = !seen.missing && seen.up && seen.act >= 0 && seen.field >= 0;
  report(ok, label, seen.missing
    ? `no ${seen.missing} on this screen`
    : `keys ${seen.up ? "up" : "NOT SEEN"}, ${seen.kb}px paid, act ${seen.act}px above them, field ${seen.field}px`);
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

// A box is the taller of the row's two states.
await field().fill("Di");
await settle(page, 150);
await openKeyboard();
await clears("/new — and with a name still in the row", "button.btn-lg");
await closeKeyboard();
const unshrink = await shrinkForKeyboard();
await clears("/new — on Android, where the page shrinks for the keys", "button.btn-lg");
await unshrink();

// ---- which one are you ---------------------------------------------------
await field().fill("");
await closeKeyboard();
await page.getByRole("button", { name: "Create" }).click();
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
await page.waitForSelector(".pad .btn");
await openKeyboard();
await clears("people — changing who you are is above the keys", ".pad .btn");

// ---- the confirm key ----------------------------------------------------
const caret = () => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return "nothing";
  return el.id || el.getAttribute("aria-label") || el.tagName.toLowerCase();
});

await page.goto(`${base}/new`);
await page.locator("#g-name").focus();
await page.keyboard.press("Enter");
report(await caret() === "Add someone",
  "/new — the confirm key takes the caret from the name to the add row",
  `caret on ${await caret()}`);

await page.goto(`${base}/g/entry/edit?id=${groupId}`);
await page.locator("input.amount").focus();
await page.keyboard.press("Enter");
report(await caret() === "what", "the entry form — the amount hands the caret to the note",
  `caret on ${await caret()}`);

await page.getByRole("button", { name: "As amounts" }).click();
await settle(page, 120);
await page.locator("#what").focus();
await page.keyboard.press("Enter");
report(await caret() === "nothing",
  "the entry form — the note folds the keyboard rather than entering the column",
  `caret on ${await caret()}`);

await page.locator("input.splitin").first().focus();
const walked = [await caret()];
for (let i = 1; i < CROWD.length; i++) {
  await page.keyboard.press("Enter");
  walked.push(await caret());
}
report(new Set(walked).size === CROWD.length && walked.every((id) => id.startsWith("sp-")),
  "one press per person walks the whole column",
  `${walked.length} rows, ${new Set(walked).size} of them distinct`);

// The last folds the keyboard, never wrapping round to the top.
await page.keyboard.press("Enter");
report(await caret() === "nothing", "the last row folds the keyboard",
  `caret on ${await caret()}, was ${walked[walked.length - 1]}`);

await page.getByRole("button", { name: "As parts" }).click();
await settle(page, 120);
await page.locator("input.partsin").first().focus();
const parted = [await caret()];
for (let i = 1; i < CROWD.length; i++) {
  await page.keyboard.press("Enter");
  parted.push(await caret());
}
await page.keyboard.press("Enter");
report(new Set(parted).size === CROWD.length
  && parted.every((id) => id.startsWith("sp-"))
  && await caret() === "nothing",
  "as parts — one press per person, and the last of them folds the keyboard",
  `${new Set(parted).size} distinct rows, ended on ${await caret()}`);

await page.locator("input.amount").fill("60");
await page.locator("#paidby").click();
await page.getByRole("option", { name: "Multiple people" }).click();
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

// The add row is the exception: its Enter files the name and hands the caret
// straight back.
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
