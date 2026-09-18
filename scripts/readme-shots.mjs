#!/usr/bin/env node
/**
 * `pnpm readme-shots` — the six pictures in README.md.
 *
 * Separate from `pnpm shots`, which photographs every screen for us and leans
 * on states worth catching: a split that doesn't add up, a payer who overpaid,
 * a server that can't be reached. Those are the right shots for an agent
 * checking its work and the wrong ones for a stranger deciding whether to open
 * the app, so this walks the same UI to a deliberately unremarkable place — a
 * trip that adds up, in prices a person might actually pay — and writes only
 * what the README shows.
 *
 * Two rows of three, and the rows are the pitch: the top one is the app a
 * Tricount user already expects (a ledger, who owes whom, adding an expense)
 * and the bottom one is the part they came for (photograph the bill, tap who
 * had what, read it back line by line).
 *
 * It serves the real Worker rather than the static export, which costs ~10s of
 * `wrangler dev` boot and buys the one thing the export cannot fake: pushes
 * that land. Against a 404 the ledger wears "Can't reach the server", and that
 * banner is the first thing a reader would see.
 *
 * Output is committed (shots/ is gitignored; docs/media/ is not), so run this
 * when a photographed screen changes and commit what moves.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, ensureBuild, serveWorker, launch, newPhone, pick, newGroup }
  from "./lib/harness.mjs";
import { PHOTO, stubScan } from "./lib/receipts.mjs";

const MEDIA = join(ROOT, "docs/media");

/**
 * A long weekend for three, in euros and the dirhams it was spent in.
 *
 * Every figure is one a reader can check against their own last trip: the
 * ledger's job in a screenshot is to be legible, and five-figure dinners read
 * as test data whatever else they demonstrate.
 */
async function seed(page, base) {
  const groupId = await newGroup(page, base, {
    name: "Marrakech", me: "Theo", members: ["Marie", "Sam"],
  });
  const add = (opts) => addEntry(page, base, groupId, opts);

  await add({ amount: "510", what: "Riad Jnane, two nights" });
  // Split between two payers, so the ledger shows the "+ 1 other" that a
  // single-payer ledger never does.
  await add({ amount: "62", what: "Dinner", coSponsor: "20" });
  await add({ amount: "24", what: "Taxi", paidBy: "Marie" });
  // Spent in dirhams: the row carries the converted figure over the original,
  // which is the whole reason the rate registry exists. Named for the souk and
  // not the café, because the bill the scan photographs later is the café's and
  // two rows under one name is a ledger nobody can read.
  await add({ amount: "620", what: "Souk stall", currency: "MAD", rate: "0.0921" });
  // One row that is nothing to do with you, so the personal column has a
  // "not yours" to show next to the reds and greens.
  await add({ amount: "45", what: "Marie's sunglasses", paidBy: "Marie", exclude: "Theo" });
  // The other two kinds an entry can be (ADR-0010), so the ledger shot is not
  // six expenses in a row: money coming back, and money moving between two
  // people without being an expense at all.
  await add({ kind: "Income", amount: "150", what: "Deposit back" });
  await addTransfer(page, base, groupId, { amount: "80", from: "Sam", to: "Theo" });
  return groupId;
}

async function addEntry(
  page, base, groupId, { kind, amount, what, coSponsor, paidBy, exclude, currency, rate },
) {
  await page.goto(`${base}/g/entry/edit?id=${groupId}`);
  if (kind) await pick(page, '[aria-label="What kind of entry"]', kind);
  // Currency before amount: a currency the group has no rate for opens the
  // rate dialog on the spot, over the form.
  if (currency) {
    await pick(page, '[aria-label="Currency"]', currency);
    const dialog = page.locator("dialog.scrim");
    if (await dialog.count() > 0) {
      await page.getByRole("textbox", { name: `Rate, ${currency} to EUR` }).fill(rate);
      await page.getByRole("button", { name: "Save" }).last().click();
      await page.waitForTimeout(200);
    }
  }
  await page.locator("input.amount").fill(amount);
  await page.locator("#what").fill(what);
  if (paidBy) await pick(page, "#paidby", paidBy);
  if (exclude) await page.getByRole("button", { name: `Leave ${exclude} out` }).click();
  if (coSponsor) {
    await page.getByRole("button", { name: "Multi-payer" }).click();
    await page.waitForURL(/\/g\/payers/);
    // Major units, the same as every other amount field in the app.
    await page.locator(".rows .row").filter({ hasText: "Marie" })
      .getByLabel(/contribution/).fill(coSponsor);
    await page.locator(".rows .row").filter({ hasText: "Theo" })
      .getByRole("button", { name: /the rest$/i }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForURL(/entry\/edit/);
  }
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\?id=/);
}

async function addTransfer(page, base, groupId, { amount, from, to }) {
  await page.goto(`${base}/g/entry/edit?id=${groupId}&kind=transfer`);
  await page.waitForSelector(".transfer");
  await page.locator("input.amount").fill(amount);
  await pick(page, '[aria-label="Who sent it"]', from);
  await pick(page, '[aria-label="Who received it"]', to);
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\?id=/);
}

/**
 * Wait until the ledger has nothing to complain about.
 *
 * Seeding outruns the push queue, so the group page draws the "stuck on this
 * phone" banner for a moment even against a server that is answering. The
 * banner is the only thing on the screen that says whether the queue has
 * drained, so it is what gets waited on.
 */
async function settled(page) {
  await page.waitForFunction(() => !document.querySelector(".banner"), null, { timeout: 30_000 });
  await page.waitForTimeout(250);
}

/**
 * Stop the scan's progress bar partway across, and hold it there.
 *
 * The bar is a CSS animation on a wall clock (`components/receipt-scan.tsx`),
 * so photographing it means catching a moment — and a moment caught by
 * `waitForTimeout` is a different fraction on every machine. Pausing the
 * animation and setting its own time is the same picture every run. The
 * negative delay the component uses to resume a sweep is part of the sum: the
 * local time that renders progress `p` is `p · duration + delay`.
 */
async function freezeScanBar(page, p) {
  const bar = page.locator(".scanbar");
  await bar.waitFor();
  await page.evaluate((at) => {
    const el = document.querySelector(".scanbar");
    for (const a of el.getAnimations()) {
      const { duration, delay } = a.effect.getComputedTiming();
      a.pause();
      a.currentTime = at * Number(duration) + Number(delay);
    }
  }, p);
}

/** Tap a cell in the who-had-what grid. A line printed ×n reads "had all n". */
function tap(page, who, label) {
  return page.getByRole("button", {
    name: new RegExp(`^${who} had (all \\d+ )?${label}`),
  }).first().click();
}

async function main() {
  ensureBuild();
  await mkdir(MEDIA, { recursive: true });
  const { base, close } = await serveWorker({ state: join(ROOT, ".drive/readme-d1") });
  const browser = await launch();
  try {
    /**
     * A European phone, at dinner time.
     *
     * Both are costume, and the clock was wrong before anyone looked: left at
     * Playwright's default, the café bill was stamped 00:11 — the hour the
     * container happened to be at, which is a different silly hour every run.
     * The app is right to follow the phone's clock (`lib/format.ts`); the
     * phone in the photograph is the thing to set.
     */
    const context = await newPhone(browser, {
      deviceScaleFactor: 2, colorScheme: "light",
      locale: "en-GB", timezoneId: "Europe/Paris",
    });
    // Resumed immediately: a frozen clock would stop the scan's bar dead, and
    // an HLC only ever takes the larger of its own physical time and this one
    // (`core/src/hlc.ts`), so starting it in the past costs nothing.
    await context.clock.install({ time: new Date("2026-09-12T20:34:00+02:00") });
    await context.clock.resume();
    const page = await context.newPage();
    const groupId = await seed(page, base);
    const shot = async (name) => {
      await page.screenshot({ path: join(MEDIA, `${name}.png`) });
      process.stdout.write(`${name} `);
    };

    /* ---- the top row: the app a Tricount user already expects ---------- */

    await page.goto(`${base}/g?id=${groupId}`);
    await settled(page);
    await shot("ledger");

    await page.goto(`${base}/g?id=${groupId}&tab=balances`);
    await settled(page);
    await shot("balances");

    // Adding an expense, typed rather than scanned: an amount, what it was,
    // who paid, and the split underneath adding up. `pnpm shots` photographs
    // the shortfall instead, because that is the line worth catching; this one
    // is the happy path, which is what the form is in almost all of the time.
    await page.goto(`${base}/g/entry/edit?id=${groupId}`);
    await page.locator("input.amount").fill("120");
    await page.locator("#what").fill("Hammam");
    await page.waitForTimeout(300);
    await shot("expense");

    /* ---- the bottom row: the bill, the grid, and the answer ------------ */

    // Mid-scan: the control filled partway, which is the only state that shows
    // the app doing the one thing it does that takes a visible moment. The
    // request is routed into a hole rather than answered, so the bar is still
    // sweeping when the shutter falls.
    await page.route("**/api/groups/*/scan", () => { /* never answered */ });
    await page.goto(`${base}/g/scan?id=${groupId}`);
    await page.getByRole("button", { name: "Upload" }).waitFor();
    await page.locator('input[aria-label="Upload a receipt photo"]')
      .setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PHOTO });
    await freezeScanBar(page, 0.55);
    await shot("scan");
    await page.unroute("**/api/groups/*/scan");

    // ...and what the scan comes back as. The draft lives in memory, so the
    // grid is reached by really uploading a photo, with the model's answer
    // stubbed from the same canned bill `pnpm drive` uses (`lib/receipts.mjs`).
    await stubScan(page, "cafe-clock");
    await page.goto(`${base}/g/entry/edit?id=${groupId}`);
    await page.locator('input[aria-label="Upload a receipt photo"]')
      .setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PHOTO });
    // A scan fills the form and stops there — the grid is the tap after it,
    // never a place the scan sends you (docs/receipt-scanning.md).
    await page.getByRole("link", { name: /(Assign|Edit) who.had.what/ }).click();
    await page.waitForURL(/entry\/items/);
    // A dinner three people actually ate: the salads and the tea shared, a main
    // each, and the water Sam alone drank. Enough taps that the grid in the
    // shot is a filled-in bill rather than an empty one, and not so many that
    // every column looks the same.
    await tap(page, "Theo", "Moroccan salad");
    await tap(page, "Marie", "Moroccan salad");
    await tap(page, "Theo", "Chicken tagine");
    await tap(page, "Marie", "Lamb couscous");
    await tap(page, "Sam", "Lamb couscous");
    await tap(page, "Theo", "Mint tea");
    await tap(page, "Marie", "Mint tea");
    await tap(page, "Sam", "Mint tea");
    await tap(page, "Theo", "Flatbread");
    await tap(page, "Sam", "Flatbread");
    await tap(page, "Sam", "Olives");
    await tap(page, "Sam", "Bottled water");
    await tap(page, "Theo", "Orange juice");
    await tap(page, "Marie", "Orange juice");
    await tap(page, "Marie", "Chocolate pastilla");
    await page.waitForTimeout(250);
    await shot("items");

    // Saved, then reopened: the same bill read back as what each person owes,
    // with one row opened onto the lines behind their figure (ADR-0016). This
    // is the shot that says the grid is not a one-way trip.
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForURL(/entry\/edit/);
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/\/g\?id=/);
    await settled(page);
    await page.getByText("Café Clock").first().click();
    await page.waitForURL(/\/g\/entry\?/);
    await page.getByRole("button", { name: /^Theo/ }).click();
    await page.waitForTimeout(250);
    await shot("summary");

    console.log(`\nwritten to ${MEDIA}`);
    await context.close();
  } finally {
    await browser.close();
    close();
  }
}

await main();
