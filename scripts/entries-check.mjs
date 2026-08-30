#!/usr/bin/env node
/**
 * `node scripts/entries-check.mjs` — can you actually add, edit and read back
 * all three kinds of entry?
 *
 * The command layer's own tests prove an income's sign reaches the balances and
 * that a transfer edit writes only what changed. What they structurally cannot
 * prove is that the *form* is wired to them: a Save button stuck disabled, a
 * segmented control that writes the wrong field, a detail screen that can't
 * find a settlement by id. This walks that wiring against the real export.
 *
 * Run it after touching /g/entry, /g/entry/edit or lib/entry-kind.ts.
 * Needs `pnpm --filter @hajsik/web build` first. ADR-0028.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "apps/web/out");
const PORT = Number(process.env.ENTRIES_PORT ?? 4433);
const EXECUTABLE = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".txt": "text/plain",
};

if (!existsSync(OUT)) {
  console.error("apps/web/out is missing — run `pnpm --filter @hajsik/web build` first.");
  process.exit(1);
}

const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  if (path.endsWith("/")) path += "index.html";
  let file = join(OUT, path);
  const isFile = (p) => existsSync(p) && statSync(p).isFile();
  if (!isFile(file) && isFile(`${file}.html`)) file = `${file}.html`;
  if (!isFile(file)) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("not found"); }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(await readFile(file));
});
await new Promise((ok) => server.listen(PORT, ok));
const base = `http://localhost:${PORT}`;

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();

let failures = 0;
function report(ok, label, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? ` — ${detail}` : ""}`);
}
page.on("pageerror", (e) => report(false, "uncaught page error", e.message));

/**
 * Save, then wait for the ledger to have redrawn from Dexie. `waitForURL`
 * alone lands on the previous render, which is what makes a check like this
 * flaky if you let it.
 */
async function save(expectRows) {
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\?id=/);
  await page.waitForFunction(
    (n) => document.querySelectorAll(".rows a.row").length >= n, expectRows, { timeout: 8000 },
  );
}

// ---- seed --------------------------------------------------------------
await page.goto(`${base}/new`);
await page.locator("#g-name").fill("Trip");
await page.locator("#g-me").fill("Theo");
// "Other…" is the one row that hands one dialog to the next rather than
// closing: the picker has to stay out of the prompt's way.
await page.locator("#g-cur").click();
await page.waitForSelector(".dlist");
await page.locator(".drow-pick").filter({ hasText: "Other" }).click();
await page.locator(".dinput").fill("uzs");
await page.getByRole("button", { name: "Use it" }).click();
await page.waitForTimeout(120);
report((await page.locator("#g-cur").innerText()).includes("UZS"),
  "an unlisted currency is typed, not scrolled to");
await page.locator("#g-cur").click();
await page.waitForSelector(".dlist");
await page.locator(".drow-pick").filter({ hasText: "EUR" }).first().click();
await page.waitForTimeout(120);
await page.getByRole("button", { name: "Create" }).click();
await page.waitForURL(/\/g\?id=/);
const g = new URL(page.url()).searchParams.get("id");
await page.goto(`${base}/g/members?id=${g}`);
for (const name of ["Marie", "Sam"]) {
  await page.getByRole("button", { name: "Add member" }).click();
  await page.locator(".dinput").fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForTimeout(150);
}

/** Every picker in the app is our own dialog now (ADR-0029): open one, take a row. */
async function pick(opener, row) {
  await page.locator(opener).click();
  await page.waitForSelector(".dlist");
  // By row, not by role name: an option's accessible name carries its note too.
  await page.locator(".drow-pick").filter({ hasText: row }).first().click();
  await page.waitForTimeout(120);
}

// ---- an expense --------------------------------------------------------
await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.locator("input.amount").fill("9000");
await page.locator("#what").fill("Dinner");

// The currency and the payer are the same dialog the transfer's sides use. A
// foreign currency has to bring the rate row with it, since that is the field
// the conversion is actually read from.
await pick('[aria-label="Currency"]', "USD");
report((await page.locator('[aria-label="Currency"]').innerText()).includes("USD"),
  "the currency picker sets the currency");
report(await page.getByLabel("Rate, USD to EUR").count() === 1,
  "a foreign currency brings out the rate");
await pick('[aria-label="Currency"]', "EUR");
report(await page.getByLabel("Rate, USD to EUR").count() === 0,
  "picking the base currency puts the rate away");

await pick("#paidby", "Marie");
report((await page.locator("#paidby").innerText()).includes("Marie"), "the payer picker sets the payer");
await pick("#paidby", "Theo");

await save(1);
report(await page.getByText("Dinner").count() > 0, "an expense saves and lists");

// ---- an income ---------------------------------------------------------
await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.getByRole("tab", { name: "Income" }).click();
await page.locator("input.amount").fill("300");
await page.locator("#what").fill("Deposit back");
report(await page.getByText("Received by").count() > 0, "an income relabels the payer picker");
report(await page.getByText("Shared with").count() > 0, "an income relabels the split");
report(await page.getByRole("button", { name: "Receipt" }).count() === 0, "an income offers no Receipt tab");
await save(2);
report(await page.locator(".avatar.inverted").count() === 1, "the income row wears the inverted avatar");
report((await page.locator(".rmeta").first().innerText()).includes("received"), "the income row says received");

// ---- a transfer, reached the way a reimbursement is ---------------------
await page.goto(`${base}/g?id=${g}&tab=balances`);
await page.waitForSelector("a.card");
report(await page.locator("a.card").count() === 2, "settle-up suggests the payments");
await page.locator("a.card").first().click();
await page.waitForURL(/entry\/edit/);
await page.waitForSelector(".transfer");
// (9000 − 300) ÷ 3. If this figure moves, an income stopped reducing the debt.
report((await page.locator("input.amount").inputValue()).replace(/\s/g, "") === "2900.00",
  "settle-up pre-fills the transfer, income already netted off");
const wasFrom = await page.locator(".tside .who").first().innerText();
await page.locator(".tswap").click();
await page.waitForTimeout(100);
report((await page.locator(".tside .who").last().innerText()) === wasFrom, "the arrow swaps the two sides");
await page.locator(".tswap").click();
await page.waitForTimeout(100);
// Either side opens the app's own picker, never a <select> (ADR-0029), and the
// person already on the other side is in it as a reversal rather than an error.
// Nothing on this form is a native picker any more — the currency and the payer
// went the same way — so the assertion is the whole screen, not the card.
report(await page.locator("select").count() === 0, "no screen of the form has a <select>");
await page.getByLabel("Who sent it").click();
await page.waitForSelector(".dlist");
const otherSide = await page.locator(".tside .who").last().innerText();
report((await page.locator(".drow-pick").filter({ hasText: otherSide }).innerText()).includes("swaps"),
  "the picker offers the other side as a swap");
await page.locator(".drow-pick").filter({ hasText: otherSide }).click();
await page.waitForTimeout(100);
report((await page.locator(".tside .who").first().innerText()) === otherSide
  && (await page.locator(".tside .who").last().innerText()) === wasFrom,
  "picking the other side swaps them");
await page.locator(".tswap").click();
await page.waitForTimeout(100);
await save(3);
report((await page.locator(".rmeta").allInnerTexts()).some((t) => t.startsWith("Transfer")),
  "a transfer saves and lists");

// ---- and every one of them is editable ---------------------------------
await page.locator("a.row").filter({ hasText: "paid" }).first().click();
await page.waitForURL(/\/g\/entry\?/);
await page.waitForSelector(".transfer");
report((await page.locator(".topbar h3").innerText()) === "Transfer", "a transfer has a detail screen");
await page.getByRole("link", { name: "Edit" }).click();
await page.waitForURL(/entry\/edit/);
await page.waitForSelector(".transfer");
report(await page.getByRole("tab").count() === 0, "editing a transfer offers no kind control");
await page.locator("input.amount").fill("12");
await save(3);
report((await page.locator(".ramt .big").allInnerTexts()).some((t) => t.includes("12")),
  "the transfer edit stuck");

await page.getByText("Dinner").first().click();
await page.waitForURL(/\/g\/entry\?/);
await page.getByRole("link", { name: "Edit" }).click();
await page.waitForURL(/entry\/edit/);
await page.waitForSelector("[role=tab]");
report(await page.getByRole("tab").count() === 2, "editing an expense offers expense and income only");
await page.getByRole("tab", { name: "Income" }).click();
await save(3);
report(await page.locator(".avatar.inverted").count() === 2, "an expense can become an income");

// ---- and the log says what happened, in the app's own words ------------
await page.goto(`${base}/g/history?id=${g}`);
await page.waitForSelector(".tle");
const feed = (await page.locator(".what").allInnerTexts()).join(" | ");
for (const line of ["created this expense", "created this income", "recorded a transfer",
  "turned this into an income"]) {
  report(feed.includes(line), `history says "${line}"`);
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall entry checks passed");
await browser.close();
server.close();
process.exit(failures ? 1 : 0);
