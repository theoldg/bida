#!/usr/bin/env node
// Doc: docs/shots.md#pnpm-readme-shots--the-six-pictures-in-the-readme
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, ensureBuild, serveExport, launch, newPhone, PIXEL_9A, openDemo, settle } from "./lib/harness.mjs";
import { PHOTO } from "./lib/receipts.mjs";

const MEDIA = join(ROOT, "docs/media");

const GROUP = "demodemodemo";
const CANTINA = "demo-cantina";

/**
 * A CSS animation on a wall clock: paused and set, so every run draws the same
 * picture. Progress `p` renders at local time `p · duration + delay`.
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

/**
 * "Demo group: not synced" would read as *bida* not syncing. Removed, not hidden:
 * `display: none` leaves its gap.
 */
async function dropDemoMark(page) {
  await page.evaluate(() => {
    document.querySelector(".demomark")?.closest(".padtop")?.remove();
  });
}

async function main() {
  ensureBuild();
  await mkdir(MEDIA, { recursive: true });
  const { base, close } = await serveExport();
  const browser = await launch();
  try {
    const context = await newPhone(browser, {
      ...PIXEL_9A, colorScheme: "light",
      locale: "en-GB", timezoneId: "Europe/Paris",
    });
    // Resumed at once: a frozen clock stops the scan's bar.
    await context.clock.install({ time: new Date("2026-09-12T20:34:00+02:00") });
    await context.clock.resume();
    const page = await context.newPage();
    const shot = async (name) => {
      await page.screenshot({ path: join(MEDIA, `${name}.png`) });
      process.stdout.write(`${name} `);
    };

    await openDemo(page, base);
    await page.getByText("Passage to Alderaan").first().waitFor();
    await settle(page, 250);

    /* ---- the top row: the app a Tricount user already expects ---------- */

    await dropDemoMark(page);
    await shot("ledger");

    await page.goto(`${base}/g/balances?id=${GROUP}`);
    await settle(page, 250);
    await shot("balances");

    await page.goto(`${base}/g/entry/edit?id=${GROUP}`);
    await page.locator("input.amount").fill("320");
    await page.locator("#what").fill("Hyperdrive coolant");
    await settle(page, 300);
    await shot("expense");

    /* ---- the bottom row: the bill, the grid, and the answer ------------ */

    await page.route("**/api/scan", () => { /* never answered */ });
    await page.route("**/api/groups/*/scan", () => { /* never answered */ });
    await page.goto(`${base}/g/scan?id=${GROUP}`);
    await page.getByRole("button", { name: "Upload" }).waitFor();
    await page.locator('input[aria-label="Upload a receipt photo"]')
      .setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PHOTO });
    await freezeScanBar(page, 0.55);
    await shot("scan");
    await page.unroute("**/api/scan");
    await page.unroute("**/api/groups/*/scan");

    // The grid reads a draft held in memory, so opening the saved entry is the
    // only way in.
    await page.goto(`${base}/g/entry/edit?id=${GROUP}&e=${CANTINA}`);
    await page.getByRole("link", { name: /(Assign|Edit) who.had.what/ }).click();
    await page.waitForURL(/entry\/items/);
    // Waited on, not pressed: pressing would turn it back.
    await page.getByRole("button", { name: "Show the bill as printed" }).waitFor();
    await settle(page, 250);
    await shot("items");

    await page.goto(`${base}/g/entry?id=${GROUP}&e=${CANTINA}`);
    await page.getByRole("button", { name: /^Luke/ }).click();
    await settle(page, 250);
    await shot("summary");

    console.log(`\nwritten to ${MEDIA}`);
    await context.close();
  } finally {
    await browser.close();
    close();
  }
}

await main();
