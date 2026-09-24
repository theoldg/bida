#!/usr/bin/env node
/**
 * `pnpm readme-shots` — the six pictures in README.md.
 *
 * Separate from `pnpm shots`, which catches states worth checking (a split
 * that doesn't add up, a server that can't be reached) — wrong for a stranger
 * deciding whether to open the app. This walks the same UI to an unremarkable
 * place and writes only what the README shows.
 *
 * Two rows of three: the top is what a Tricount user expects (ledger, who owes
 * whom, adding an expense), the bottom what they came for (photograph the
 * bill, tap who had what, read it back line by line).
 *
 * **The group is the demo** (`core/src/demo.ts`), which has something for
 * every screen to say and is what the front page's button opens. It holds no
 * key, so no Worker boots and no push queue is waited on. Its cantina tab is
 * written in its own tongue with English beside it, so the who-had-what shot
 * carries the translation icon (ADR-0016).
 *
 * Output is committed (shots/ is gitignored; docs/media/ is not), so run this
 * when a photographed screen changes and commit what moves.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, ensureBuild, serveExport, launch, newPhone, settle } from "./lib/harness.mjs";
import { PHOTO } from "./lib/receipts.mjs";

const MEDIA = join(ROOT, "docs/media");

/** The demo's constants, fixed so a screen can be addressed without hunting. */
const GROUP = "demodemodemo";
const CANTINA = "demo-cantina";

/**
 * Stop the scan's progress bar partway across, and hold it there. It is a CSS
 * animation on a wall clock (`components/receipt-scan.tsx`), so pausing it and
 * setting its time gives the same picture every run. The component's negative
 * delay is part of the sum: progress `p` renders at local time
 * `p · duration + delay`.
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
 * Take the demo's own mark off the ledger, for the photograph only. In the
 * README "Demo group: not synced" would read as *bida* not syncing — the
 * opposite of the pitch. Removed, not hidden: `display: none` leaves its gap.
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
    /**
     * A European phone, at dinner time — costume. Playwright's default clock
     * stamps whatever hour the container is at; the app rightly follows the
     * phone's clock (`lib/format.ts`), so the phone is what's set.
     */
    const context = await newPhone(browser, {
      deviceScaleFactor: 2, colorScheme: "light",
      locale: "en-GB", timezoneId: "Europe/Paris",
    });
    // Resumed immediately: a frozen clock stops the scan's bar, and the demo
    // dates itself in offsets from now (`demoOps`), so it only needs the start.
    await context.clock.install({ time: new Date("2026-09-12T20:34:00+02:00") });
    await context.clock.resume();
    const page = await context.newPage();
    const shot = async (name) => {
      await page.screenshot({ path: join(MEDIA, `${name}.png`) });
      process.stdout.write(`${name} `);
    };

    // Laying the demo down is the whole seed: one visit, and the group exists
    // with its evening already in it.
    await page.goto(`${base}/demo`);
    await page.getByText("Passage to Alderaan").first().waitFor();
    await settle(page, 250);

    /* ---- the top row: the app a Tricount user already expects ---------- */

    await dropDemoMark(page);
    await shot("ledger");

    await page.goto(`${base}/g/balances?id=${GROUP}`);
    await settle(page, 250);
    await shot("balances");

    // Adding an expense, typed: amount, title, payer, and a split that adds up —
    // the happy path (`pnpm shots` shoots the shortfall). Never saved; the shot
    // is the form.
    await page.goto(`${base}/g/entry/edit?id=${GROUP}`);
    await page.locator("input.amount").fill("320");
    await page.locator("#what").fill("Hyperdrive coolant");
    await settle(page, 300);
    await shot("expense");

    /* ---- the bottom row: the bill, the grid, and the answer ------------ */

    // Mid-scan: the control filled partway, which is the only state that shows
    // the app doing the one thing it does that takes a visible moment. The
    // request is routed into a hole rather than answered, so the bar is still
    // sweeping when the shutter falls.
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

    // ...and the grid that a scan hands you, reached from the tab the demo
    // already holds rather than by scanning a second bill. Opening the saved
    // entry for editing is the only way in: the grid reads a draft, which
    // lives in memory (`lib/draft.ts`), so there is no URL that lands on it.
    await page.goto(`${base}/g/entry/edit?id=${GROUP}&e=${CANTINA}`);
    await page.getByRole("link", { name: /(Assign|Edit) who.had.what/ }).click();
    await page.waitForURL(/entry\/items/);
    // Pressed into English. The demo's tab is printed in the cantina's own
    // tongue, which is what puts the toggle on the bar at all (ADR-0016) — but
    // a reader who cannot read the lines cannot see that the grid is a bill,
    // so the shot is of the press rather than of what it acts on.
    await page.getByRole("button", { name: "Show the bill in English" }).click();
    await settle(page, 250);
    await shot("items");

    // The same bill read back as what each person owes, with one row opened
    // onto the lines behind their figure (ADR-0016). This is the shot that
    // says the grid is not a one-way trip. Reached from the ledger rather than
    // by saving the draft above, which would append an op for a screenshot.
    // In English as well, without a second press: the choice made on the grid
    // is the phone's and not that screen's, so it carries to the read-back.
    await page.goto(`${base}/g/entry?id=${GROUP}&e=${CANTINA}`);
    await page.getByRole("button", { name: /^Ben/ }).click();
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
