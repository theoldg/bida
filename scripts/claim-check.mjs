#!/usr/bin/env node
/**
 * `pnpm claim` — does the screen that ends both ways into a group take the
 * name that is still in the add row?
 *
 * Everything here is about a name typed and not yet filed, which is the state
 * the add row exists to make ordinary (components/name-adder.tsx) and the one
 * nothing else can check: not arithmetic, not a command — a blur, a screen
 * that rewrites itself between a press and its release, and a button that has
 * to mean what its label says. "Continue as Nadia" filed Nadia and then never
 * fired, because filing her is what took the button out from under the finger,
 * and every part of that looks perfect in jsdom.
 *
 * Both doors are walked, because their add rows differ where it matters: on
 * `/new` the list is state and grows in the same tick, on `/g/claim` it is a
 * Dexie write and the row arrives whenever it arrives.
 */
import { ensureBuild, serveExport, launch, newPhone, reporter } from "./lib/harness.mjs";

ensureBuild();
const { base, close } = await serveExport();
const browser = await launch();
const ctx = await newPhone(browser);
const page = await ctx.newPage();
const { report, finish } = reporter(page);

/** The add row. The two screens place it under different words. */
const field = (label = "Add someone") => page.getByLabel(label);

/**
 * Press a button by hand and **hold it**, the way a thumb does.
 *
 * Both halves are the check. `locator.click()` re-resolves the button and
 * quietly retries a press that missed, and an instant down-up is over before
 * React has re-rendered — so either one on its own reports a green on the
 * build where this is broken. A tenth of a second is all the screen needs.
 */
async function press(button) {
  const box = await button.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
}

const arrived = () => page.waitForURL(/\/g\?id=/, { timeout: 8000 }).then(() => true, () => false);

// ---- the list you type -------------------------------------------------
await page.goto(`${base}/new`);
await page.locator("#g-name").fill("Trip");
for (const who of ["Theo", "Marie"]) {
  await field().fill(who);
  await page.keyboard.press("Enter");
}

// The tap route to a second name: a phone has no Enter worth reaching for and
// nowhere neutral to tap, so the next row appears while the name is fileable.
await field().fill("Sam");
await page.waitForTimeout(80);
report(await page.locator(".addnext").count() === 1, "a fileable name draws the next add row under it");
await page.locator(".addnext").click();
await page.waitForFunction(() => document.querySelectorAll('[aria-label^="Remove "]').length === 3);
report(await field().inputValue() === "" && await page.locator(".addnext").count() === 0,
  "tapping it files the name, empties the field and takes itself away");

// A name the list already holds is refused, so there is nothing to file and no
// row offering to file it.
await field().fill("Marie");
await page.waitForTimeout(80);
report(await page.locator(".addwarn").count() === 1 && await page.locator(".addnext").count() === 0,
  "a name already on the list warns instead, and draws no row");
await page.getByRole("button", { name: "Clear" }).click();

// ---- the question it ends on -------------------------------------------
await page.getByRole("button", { name: "Create" }).click();
await page.waitForSelector(".rows button.row");
report(await page.locator(".rows button.row").count() === 3, "Create asks which of the three you are");

// Nobody is ticked, so the button has nothing to fall back on: filing the name
// on the blur this press causes empties the field and disables the button
// mid-press, and a disabled button gets no click.
await field().fill("Nadia");
await page.waitForTimeout(80);
report(await page.getByRole("button", { name: "Continue as Nadia" }).count() === 1,
  "the button offers to continue as what is being typed");
await press(page.getByRole("button", { name: "Continue as Nadia" }));
const made = await arrived();
report(made, "one press files the typed name and creates the group as them");
if (!made) { await browser.close(); close(); finish(); }
const g = new URL(page.url()).searchParams.get("id");

// ---- and again where joining ends --------------------------------------
// Same component, real members: the name is a Dexie write, so the row it adds
// arrives on its own schedule rather than in the tick that asked for it.
await page.goto(`${base}/g/claim?id=${g}`);
await page.waitForSelector(".rows button.row");
report(await page.locator(".rmark svg").count() === 1, "re-opening it ticks whoever this phone is");

await field("Add your name").fill("Ola");
await page.waitForTimeout(80);
report(await page.locator(".rmark svg").count() === 0, "and typing a name takes that tick back off");
report(await page.getByRole("button", { name: "Continue as Ola" }).count() === 1,
  "the button follows the field rather than the tick");

await press(page.getByRole("button", { name: "Continue as Ola" }));
const claimed = await arrived();
report(claimed, "one press files the typed name and claims it");

if (claimed) {
  await page.goto(`${base}/g/members?id=${g}`);
  await page.waitForSelector(".rows .row");
  report(await page.getByRole("button", { name: "Remove Ola" }).count() === 0
    && await page.getByRole("button", { name: "Remove Nadia" }).count() === 1,
    "and the phone is her: her row carries the check, not a trash");
}

await browser.close();
close();
finish();
