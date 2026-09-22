#!/usr/bin/env node
/**
 * `pnpm readme-shots` — the six pictures in README.md.
 *
 * Separate from `pnpm shots`, which photographs every screen for us and leans
 * on states worth catching: a split that doesn't add up, a payer who overpaid,
 * a server that can't be reached. Those are the right shots for an agent
 * checking its work and the wrong ones for a stranger deciding whether to open
 * the app, so this walks the same UI to a deliberately unremarkable place and
 * writes only what the README shows.
 *
 * Two rows of three, and the rows are the pitch: the top one is the app a
 * Tricount user already expects (a ledger, who owes whom, adding an expense)
 * and the bottom one is the part they came for (photograph the bill, tap who
 * had what, read it back line by line).
 *
 * **The group in the pictures is the demo** (`core/src/demo.ts`) — the same
 * one `/demo` lays down for a visitor. It was written to have something for
 * every screen to say, which is exactly what six screenshots need, and using
 * it means the README shows what the button on the front page opens rather
 * than a trip invented here and kept in step with the app by hand. It also
 * costs nothing to reach: a demo holds no key, so nothing syncs, so there is
 * no Worker to boot and no push queue to wait on.
 *
 * The one thing the demo has that a made-up trip could not: the cantina tab is
 * written in its own tongue with the English beside it, so the who-had-what
 * shot carries the translation icon (ADR-0016).
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

/**
 * Take the demo's own mark off the ledger, for the photograph only.
 *
 * `DemoCard` sits above the ledger saying "Demo group: not synced", and it is
 * right to: in the demo, nothing syncs, and the card never dismisses because
 * that stays true however long you look around. In the README it would say
 * something else — that *bida* does not sync — which is the opposite of the
 * pitch two bullets below the picture. The fact belongs to the demo, not to
 * the app, so the shot is of the app.
 *
 * Removed rather than hidden: `display: none` leaves the gap it was sitting in.
 */
async function dropDemoMark(page) {
  await page.evaluate(() => {
    document.querySelector(".demomark")?.closest(".pad")?.remove();
  });
}

async function main() {
  ensureBuild();
  await mkdir(MEDIA, { recursive: true });
  const { base, close } = await serveExport();
  const browser = await launch();
  try {
    /**
     * A European phone, at dinner time.
     *
     * Both are costume, and the clock was wrong before anyone looked: left at
     * Playwright's default, the tab was stamped 00:11 — the hour the container
     * happened to be at, which is a different silly hour every run. The app is
     * right to follow the phone's clock (`lib/format.ts`); the phone in the
     * photograph is the thing to set.
     */
    const context = await newPhone(browser, {
      deviceScaleFactor: 2, colorScheme: "light",
      locale: "en-GB", timezoneId: "Europe/Paris",
    });
    // Resumed immediately: a frozen clock would stop the scan's bar dead, and
    // the demo dates itself in offsets from now (`demoOps`), so a clock that
    // does not advance is fine to start from and wrong to stay at.
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

    await page.goto(`${base}/g?id=${GROUP}&tab=balances`);
    await settle(page, 250);
    await shot("balances");

    // Adding an expense, typed rather than scanned: an amount, what it was,
    // who paid, and the split underneath adding up. `pnpm shots` photographs
    // the shortfall instead, because that is the line worth catching; this one
    // is the happy path, which is what the form is in almost all of the time.
    // Never saved — the shot is the form, and the ledger above it was already
    // taken.
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
