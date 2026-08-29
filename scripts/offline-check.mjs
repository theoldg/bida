#!/usr/bin/env node
/**
 * `node scripts/offline-check.mjs` — does the built app actually work with the
 * network cut?
 *
 * Seeds a group through the real UI over a local server, lets the service
 * worker install, pulls the plug, and then walks every screen and saves an
 * expense. It exists because "offline-first" was true of the data layer and
 * false of the app: the shell precache missed the RSC payloads Next fetches on
 * every tap, so a phone with no signal got a wall of `1:"$Sreact.fragment"`.
 * Run it after touching public/sw.js or scripts/precache.mjs.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "apps/web/out");
const PORT = Number(process.env.OFFLINE_PORT ?? 4410);
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
  const url = new URL(req.url ?? "/", "http://localhost");
  let path = decodeURIComponent(url.pathname);
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
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? `\n        ${detail}` : ""}`);
}

// ---- seed, online -------------------------------------------------------
await page.goto(`${base}/new`);
await page.locator("#g-name").fill("Marrakech");
await page.locator("#g-me").fill("Theo");
await page.getByRole("button", { name: "Create" }).click();
await page.waitForURL(/\/g\?id=/);
const g = new URL(page.url()).searchParams.get("id");
await page.goto(`${base}/g/members?id=${g}`);
for (const name of ["Marie", "Sam"]) {
  page.once("dialog", (d) => d.accept(name));
  await page.getByText("Add member").click();
  await page.waitForTimeout(120);
}
for (const [amount, what] of [["4800", "Riad"], ["6200", "Dinner"], ["900", "Taxi"]]) {
  await page.goto(`${base}/g/expense/edit?id=${g}`);
  await page.locator("input.amount").fill(amount);
  await page.locator("#what").fill(what);
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\?id=/);
}

// The worker takes over on the next launch, never mid-session — so reload once,
// exactly as closing and reopening the app would.
await page.goto(`${base}/`);
await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => !!r?.active), null,
  { timeout: 20000 });
await page.goto(`${base}/`);
await page.waitForTimeout(500);
report(await page.evaluate(() => !!navigator.serviceWorker.controller), "service worker controls the page");

// ---- pull the plug ------------------------------------------------------
await ctx.setOffline(true);
console.log("\noffline:");

/** Every screen, reached the way a thumb reaches it: by tapping. */
async function tap(label, act, expect) {
  try {
    await act();
    await page.waitForSelector(expect, { timeout: 8000 });
    report(true, label);
  } catch (e) {
    const url = page.url().replace(base, "");
    const body = (await page.evaluate(() => document.body.innerText).catch(() => "")).slice(0, 100);
    report(false, label, `at ${url} — ${body.replace(/\s+/g, " ")}`);
  }
}

await tap("groups list loads", () => page.goto(`${base}/`), ".rows a.row");
await tap("tap a group", () => page.locator("a.row").first().click(), ".daylabel");
await tap("tap an expense", () => page.getByText("Dinner").first().click(), ".bignum");
await tap("in-app Back to the group",
  () => page.locator(".iconbtn[aria-label='Back']").first().click(), ".daylabel");
await tap("balances tab", () => page.locator("a[href*='tab=balances']").first().click(), ".bar");
await tap("tap a suggested transfer", () => page.locator("a.card").first().click(), "#s-amt");
await tap("history", () => page.goto(`${base}/g/history?id=${g}`), ".tle");
await tap("members", () => page.goto(`${base}/g/members?id=${g}`), ".rows .row");
await tap("settings", () => page.goto(`${base}/settings`), ".seg");

await tap("new expense form", () => page.goto(`${base}/g/expense/edit?id=${g}`), "input.amount");
// Reached only from the form, and only with a draft in hand — the one screen
// that can't be checked by typing its URL in.
await tap("who paid", () => page.getByRole("link", { name: /several people paid/i }).click(), ".rows .row");
await tap("back to the form",
  () => page.locator(".iconbtn[aria-label='Back']").first().click(), "input.amount");
try {
  await page.locator("input.amount").fill("999");
  await page.locator("#what").fill("Offline beer");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\?id=/, { timeout: 8000 });
  await page.waitForSelector("text=Offline beer", { timeout: 8000 });
  report(true, "save an expense, land back on the ledger with it in the list");
} catch {
  report(false, "save an expense, land back on the ledger with it in the list",
    `at ${page.url().replace(base, "")} — ${(await page.evaluate(() => document.body.innerText)).slice(0, 100).replace(/\s+/g, " ")}`);
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} failed` : "\nall offline checks passed");
process.exit(failures ? 1 : 0);
