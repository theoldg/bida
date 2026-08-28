#!/usr/bin/env node
/**
 * `pnpm shots` — photograph every screen in one browser launch.
 *
 * The owner asked for this loop and asked us not to lean on it: use it after
 * building or changing a screen, or when something looks wrong. Not after every
 * edit. See docs/standing-instructions.md.
 *
 * What it does, in order:
 *   1. serves the real static export (apps/web/out) over http — not `next dev`,
 *      because the export is what actually ships and it has its own quirks;
 *   2. drives the real UI to seed a group, members and expenses, so the shots
 *      show a populated ledger rather than eight empty states. Seeding through
 *      the UI rather than by poking IndexedDB means the harness also fails when
 *      a screen it isn't photographing is broken;
 *   3. walks every route in both themes and writes one PNG each into shots/.
 *
 * Chromium comes from PLAYWRIGHT_BROWSERS_PATH (already on disk in the agent
 * environment). Never run `playwright install`.
 */
import { createServer } from "node:http";
import { readFile, mkdir, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "apps/web/out");
const SHOTS = join(ROOT, "shots");
const PORT = Number(process.env.SHOTS_PORT ?? 4321);
const EXECUTABLE = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".txt": "text/plain",
};

/** Static export: /g is out/g.html, / is out/index.html. */
async function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";
    let file = join(OUT, path);
    // `/g` is both out/g.html and out/g/ (its child routes live in there), so a
    // bare directory hit has to fall through to the sibling .html, not read the
    // directory.
    const isFile = (p) => existsSync(p) && statSync(p).isFile();
    if (!isFile(file) && isFile(`${file}.html`)) file = `${file}.html`;
    if (!isFile(file)) {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("not found");
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  });
  await new Promise((ok) => server.listen(PORT, ok));
  return server;
}

const base = `http://localhost:${PORT}`;

/** Build a group with three people and a co-sponsored expense, via the UI. */
async function seed(page) {
  await page.goto(`${base}/new`);
  await page.locator("#g-name").fill("Marrakech");
  await page.locator("#g-me").fill("Theo");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/g\?id=/);
  const groupId = new URL(page.url()).searchParams.get("id");

  // Two more members, through the members screen's prompt()s.
  await page.goto(`${base}/g/members?id=${groupId}`);
  for (const name of ["Marie", "Sam"]) {
    page.once("dialog", (d) => d.accept(name));
    await page.getByText("Add member").click();
    await page.waitForTimeout(120);
  }

  // A plain expense, then a co-sponsored one.
  await addExpense(page, groupId, { amount: "4800", what: "Riad Jnane" });
  await addExpense(page, groupId, { amount: "6200", what: "Dinner", coSponsor: true });
  // Then the two rows personal mode exists for: one somebody else paid that
  // you owe a share of (red), and one that has nothing to do with you (faded).
  await addExpense(page, groupId, { amount: "900", what: "Taxi", paidBy: "Marie" });
  await addExpense(page, groupId, {
    amount: "450", what: "Marie's sunglasses", paidBy: "Marie", exclude: "Theo",
  });

  // ...and one edit, so the history screens have a revision that is not just a
  // create: a diff to render, and a version worth offering to restore.
  await page.getByText("Riad Jnane").click();
  await page.waitForURL(/\/g\/expense\?/);
  await page.getByRole("link", { name: "Edit" }).click();
  await page.waitForURL(/expense\/edit/);
  await page.locator("input.amount").fill("5100");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\?id=/);
  return groupId;
}

async function addExpense(page, groupId, { amount, what, coSponsor, paidBy, exclude }) {
  await page.goto(`${base}/g/expense/edit?id=${groupId}`);
  await page.locator("input.amount").fill(amount);
  await page.locator("#what").fill(what);
  if (paidBy) await page.locator("#paidby").selectOption({ label: paidBy });
  // The split editor is on this form now (ADR-0013), so leaving somebody out
  // is a tap here rather than a trip to a screen and back.
  if (exclude) await page.getByRole("button", { name: `Leave ${exclude} out` }).click();
  if (coSponsor) {
    await page.getByRole("link", { name: /several people paid/i }).click();
    await page.waitForURL(/\/g\/payers/);
    // Marie chips in 20,00; whoever was already paying takes the rest.
    const marie = page.locator(".rows .row").filter({ hasText: "Marie" });
    await marie.getByRole("button", { name: /paid too/i }).click();
    await marie.getByLabel(/contribution/).fill("2000");
    // ...and the person who was already paying takes the remainder.
    await page.locator(".rows .row").filter({ hasText: "You" })
      .getByRole("button", { name: /the rest$/i }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForURL(/expense\/edit/);
  }
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\?id=/);
}

const routes = (g) => [
  ["groups", "/"],
  ["new", "/new"],
  ["group-expenses", `/g?id=${g}`],
  ["group-balances", `/g?id=${g}&tab=balances`],
  ["members", `/g/members?id=${g}`],
  ["claim", `/g/claim?id=${g}`],
  ["history", `/g/history?id=${g}`],
  ["expense-edit", `/g/expense/edit?id=${g}`],
  ["payers", `/g/payers?id=${g}`],
  ["settings", "/settings"],
];

async function main() {
  if (!existsSync(OUT)) {
    console.error("apps/web/out is missing — run `pnpm --filter @hajsik/web build` first.");
    process.exit(1);
  }
  await rm(SHOTS, { recursive: true, force: true });
  await mkdir(SHOTS, { recursive: true });

  const server = await serve();
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  try {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        colorScheme: theme,
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      const groupId = await seed(page);

      for (const [name, path] of routes(groupId)) {
        await page.goto(base + path);
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(SHOTS, `${theme}-${name}.png`) });
        process.stdout.write(`${theme}/${name} `);
      }

      // The restore confirmation carries an HLC in its URL, so it is reached by
      // pressing the rewind on a real revision rather than by a fixed path.
      await page.goto(`${base}/g/history?id=${groupId}`);
      await page.locator(".tlrewind").first().click();
      await page.waitForURL(/\/g\/restore/);
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(SHOTS, `${theme}-restore.png`) });
      process.stdout.write(`${theme}/restore `);
      await context.close();
    }
    console.log(`\nshots written to ${SHOTS}`);
  } finally {
    await browser.close();
    server.close();
  }
}

await main();
