#!/usr/bin/env node
/**
 * `pnpm claim` — a name typed into the add row is filed by its plus and by
 * nothing else.
 *
 * Everything here is about the gap between typed and filed, which is the state
 * the add row exists to make ordinary (components/name-adder.tsx) and the one
 * nothing else can check: not arithmetic, not a command — a blur that must do
 * nothing, a plus that must refuse a name the list already holds, and a screen
 * whose button must not read intent out of a field nobody has pressed anything
 * on. All of it looks perfect in jsdom.
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
const plus = () => page.getByRole("button", { name: "Add", exact: true });

/**
 * Press a button by hand and **hold it**, the way a thumb does.
 *
 * Both halves are the check. `locator.click()` re-resolves the button and
 * quietly retries a press that missed, and an instant down-up is over before
 * React has re-rendered — so either one on its own reports a green on a build
 * where the press and the screen disagree about what is under the finger.
 */
async function press(button) {
  const box = await button.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
}

const arrived = () => page.waitForURL(/\/g\?id=/, { timeout: 8000 }).then(() => true, () => false);
const members = () => page.locator('[aria-label^="Remove "]').count();

// ---- the list you type -------------------------------------------------
await page.goto(`${base}/new`);
await page.locator("#g-name").fill("Trip");

report(await plus().isDisabled(), "an empty add row cannot file anything");

// Enter is the keyboard's press of that same plus.
await field().fill("Theo");
await page.waitForTimeout(80);
report(await page.locator(".addrow.editing").count() === 1,
  "a name being typed puts the row in a box: it is not on the list yet");
await page.keyboard.press("Enter");
await page.waitForFunction(() => document.querySelectorAll('[aria-label^="Remove "]').length === 1);
report(await page.locator(".addrow.editing").count() === 0, "filing it takes the box away");

// The finger's route: press the plus itself.
await field().fill("Marie");
await page.waitForTimeout(80);
await press(plus());
await page.waitForFunction(() => document.querySelectorAll('[aria-label^="Remove "]').length === 2);
report(await field().inputValue() === "", "pressing the plus files the name and empties the field");

// The whole point of the change: leaving the field files nothing.
await field().fill("Sam");
await page.locator("#g-name").click();
await page.waitForTimeout(150);
report(await members() === 2 && await field().inputValue() === "Sam",
  "leaving the field files nothing — the name waits in the box");

// A name the list already holds cannot be filed at all: the plus goes dead
// rather than warning after the press.
await field().fill("Marie");
await page.waitForTimeout(80);
report(await page.locator(".addwarn").count() === 1 && await plus().isDisabled(),
  "a name already on the list disables the plus and says why");
await field().fill("");
await page.waitForTimeout(80);

// ---- the question it ends on -------------------------------------------
await page.getByRole("button", { name: "Create" }).click();
await page.waitForSelector(".rows button.row");
report(await page.locator(".rows button.row").count() === 2, "Create asks which of the two you are");

// Nobody is ticked and a name is being typed, and the button must ignore it:
// it answers to the list, and this name is not on the list.
await field().fill("Nadia");
await page.waitForTimeout(80);
report(await page.getByRole("button", { name: "Pick your name" }).count() === 1,
  "the button ignores a name that has only been typed");

await press(plus());
await page.waitForFunction(() => document.querySelectorAll(".rows button.row").length === 3);
report(await page.locator(".rmark svg").count() === 1
  && await page.getByRole("button", { name: "Continue as Nadia" }).count() === 1,
  "filing it here picks it: the check mark moves to the row that arrives");

// The check mark is a shape, and a shape is not a sentence: the row itself has
// to say it is the chosen one, or the only thing naming the pick is the button
// at the foot of the screen.
const picked = page.locator('.rows button.row[aria-pressed="true"]');
report(await picked.count() === 1 && (await picked.innerText()).includes("Nadia"),
  "and the row says so to a screen reader, not only in ink");

await press(page.getByRole("button", { name: "Continue as Nadia" }));
const made = await arrived();
report(made, "and the button creates the group as her");
if (!made) { await browser.close(); close(); finish(); }
const g = new URL(page.url()).searchParams.get("id");

// ---- and again where joining ends --------------------------------------
// Same component, real members: the name is a Dexie write, so the row it adds
// arrives on its own schedule rather than in the tick that asked for it.
await page.goto(`${base}/g/claim?id=${g}`);
await page.waitForSelector(".rows button.row");
report(await page.locator(".rmark svg").count() === 1, "re-opening it ticks whoever this phone is");

await field("Add your name").fill("Ola");
await page.waitForTimeout(150);
report(await page.locator(".rmark svg").count() === 1
  && await page.getByRole("button", { name: "Continue as Nadia" }).count() === 1,
  "typing a name moves neither the tick nor the button");

await press(plus());
await page.waitForFunction(() => document.querySelectorAll(".rows button.row").length === 4);
report(await page.getByRole("button", { name: "Continue as Ola" }).count() === 1,
  "filing it does — a Dexie write away, the tick is on her");

await press(page.getByRole("button", { name: "Continue as Ola" }));
const claimed = await arrived();
report(claimed, "and the button claims her");

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
