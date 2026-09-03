#!/usr/bin/env node
/**
 * `pnpm back` — does the device's back button do what the back arrow does?
 *
 * The two are one behaviour by construction (`lib/back-button.ts`, ADR-0007),
 * but only in a browser: the Navigation API isn't in jsdom, and the thing that
 * breaks it is never the predicate — it is a screen whose arrow says one thing
 * while its loading frame says another, which no unit test can see.
 *
 * Two presses stand for the two ways they used to disagree: a destination
 * (an entry opened from the history feed goes up to the group, not back to the
 * feed) and a question (a typed draft is asked about, not thrown away).
 */
import { ensureBuild, serveExport, launch, newPhone, reporter, newGroup }
  from "./lib/harness.mjs";

ensureBuild();
const { base, close } = await serveExport();
const browser = await launch();
const page = await (await newPhone(browser)).newPage();
const { report, finish } = reporter(page);

/**
 * The back button, as a person presses it. It resolves with nothing to wait
 * for when the app cancels the traversal and goes its own way instead, which
 * is the case under test — so the wait is ours, not Playwright's.
 */
async function pressBack() {
  await page.goBack().catch(() => {});
  await page.waitForTimeout(500);
}

const g = await newGroup(page, base, { name: "Trip", me: "Theo", members: ["Marie", "Sam"] });

// ---- a question: the entry form asks before losing what you typed --------
await page.getByLabel("Add an entry").click();
await page.waitForURL(/entry\/edit/);
await page.locator("input.amount").fill("40");
await page.locator("#what").fill("Dinner");
await pressBack();
report(/entry\/edit/.test(page.url()), "a back press on a typed draft stays on the form");
report(await page.getByRole("button", { name: "Discard" }).count() === 1, "and asks before discarding");
await page.getByRole("button", { name: "Discard" }).click();
await page.waitForURL(/\/g\?id=/, { timeout: 5000 }).catch(() => {});
report(/\/g\?id=/.test(page.url()), "and leaves once you say so");

// ---- a destination: back goes up, not back -------------------------------
await page.getByLabel("Add an entry").click();
await page.waitForURL(/entry\/edit/);
await page.locator("input.amount").fill("40");
await page.locator("#what").fill("Dinner");
await page.getByRole("button", { name: "Save" }).click();
await page.waitForURL(/\/g\?id=/);
await page.waitForFunction(() => document.querySelectorAll(".rows a.row").length >= 1, null, { timeout: 8000 });

await page.getByLabel("History").click();
await page.waitForURL(/\/g\/history/);
await page.locator("a").filter({ hasText: "Dinner" }).first().click();
await page.waitForURL(/\/g\/entry\?/);
// Straight away, with no pause: the loading frame has to name the same parent
// the loaded screen will, or a quick press lands somewhere the arrow never goes.
await pressBack();
report(/\/g\?id=/.test(page.url()),
  "a back press on an entry opened from the feed climbs to the group",
  `landed on ${new URL(page.url()).pathname}`);

await browser.close();
close();
finish();
