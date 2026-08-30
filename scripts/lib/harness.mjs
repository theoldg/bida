/**
 * Shared plumbing for the browser checks — `shots.mjs`, `entries-check.mjs`,
 * `offline-check.mjs`.
 *
 * Each of those asks the same four things before it can assert anything: a
 * build, a server that speaks the static export's dialect, a phone-shaped
 * browser, and a group with people in it. Written three times, they drifted and
 * each carried its own copy of the `/g` directory trap. Written once, a fourth
 * check costs a dozen lines and inherits every gotcha already paid for.
 *
 * Chromium comes from PLAYWRIGHT_BROWSERS_PATH, already on disk in the agent
 * environment. Never run `playwright install`.
 */
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync, statSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

export const ROOT = resolve(import.meta.dirname, "../..");
export const OUT = join(ROOT, "apps/web/out");
const EXECUTABLE = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

/* ---- the build ---------------------------------------------------------- */

/** Source trees whose mtime decides whether `out/` is stale. */
const SOURCES = ["apps/web", "packages/core", "pnpm-lock.yaml"];
const SKIP = new Set(["node_modules", ".next", "out", ".git"]);

function newestMtime(path) {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return 0;
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(path)) {
    if (SKIP.has(entry)) continue;
    newest = Math.max(newest, newestMtime(join(path, entry)));
  }
  return newest;
}

/**
 * Build the static export if it is missing or older than the sources.
 *
 * Every check here reads `apps/web/out`, and "you forgot to build" used to be
 * three separate error messages telling you to go and run something else. The
 * build is the check's own precondition, so the check meets it — and skips the
 * ~25 seconds when nothing has changed since the last one.
 */
export function ensureBuild() {
  const built = statSync(join(OUT, "index.html"), { throwIfNoEntry: false })?.mtimeMs ?? 0;
  const source = Math.max(...SOURCES.map((s) => newestMtime(join(ROOT, s))));
  if (built > source) return;
  console.log(built ? "sources changed since the last build — rebuilding" : "no build yet — building");
  const { status } = spawnSync("pnpm", ["--filter", "@hajsik/web", "build"], {
    cwd: ROOT, stdio: "inherit",
  });
  if (status !== 0) process.exit(status ?? 1);
}

/* ---- the server --------------------------------------------------------- */

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".txt": "text/plain",
};

const isFile = (p) => existsSync(p) && statSync(p).isFile();

/**
 * Serve the real static export — not `next dev`. The export is what ships and
 * it has quirks `next dev` doesn't.
 *
 * `intercept(path, res)` gets first refusal on every request and returning
 * true means it handled one; that is how offline-check drops an asset and
 * rewrites the service worker's revision.
 *
 * Listens on port 0, so two checks can run back to back without colliding.
 */
export async function serveExport({ intercept } = {}) {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    if (await intercept?.(path, res)) return;
    if (path.endsWith("/")) path += "index.html";
    let file = join(OUT, path);
    // `/g` is both out/g.html and out/g/ (its child routes live in there), so a
    // bare directory hit falls through to the sibling .html rather than reading
    // the directory — serving the directory is an EISDIR crash.
    if (!isFile(file) && isFile(`${file}.html`)) file = `${file}.html`;
    if (!isFile(file)) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("not found"); }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  });
  await new Promise((ok) => server.listen(0, ok));
  return { base: `http://localhost:${server.address().port}`, close: () => server.close() };
}

/* ---- the browser -------------------------------------------------------- */

export const launch = () => chromium.launch({ executablePath: EXECUTABLE });

/** A phone: 390×844, touch, mobile. What every screen is designed against. */
export const newPhone = (browser, opts = {}) => browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ...opts,
});

/* ---- reporting ---------------------------------------------------------- */

/**
 * A pass/fail tally that owns the exit code — a check that reports failures and
 * exits 0 is a check nothing is watching.
 */
export function reporter(page) {
  let failures = 0;
  const report = (ok, label, detail) => {
    if (!ok) failures++;
    console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? `\n        ${detail}` : ""}`);
  };
  page?.on("pageerror", (e) => report(false, "uncaught page error", e.message));
  return {
    report,
    /** Print the verdict and exit non-zero if anything failed. */
    finish() {
      console.log(failures ? `\n${failures} failed` : "\nall checks passed");
      process.exit(failures ? 1 : 0);
    },
  };
}

/* ---- driving the app ---------------------------------------------------- */

/**
 * Open a picker and take a row out of it. Every picker in the app is one of
 * these now, never a `<select>` (ADR-0008).
 *
 * By row, not by role name: an option's accessible name carries its note too.
 */
export async function pick(page, opener, row) {
  await page.locator(opener).click();
  await page.waitForSelector(".dlist");
  await page.locator(".drow-pick").filter({ hasText: row }).first().click();
  await page.waitForTimeout(120);
}

/**
 * Create a group with members, through the real UI rather than by poking
 * IndexedDB — which is what makes a check fail loudly when a screen it isn't
 * even looking at breaks. Returns the group id.
 *
 * `onForm` runs on the filled-in create screen before Create is pressed, for a
 * check that has something to say about that screen rather than about what it
 * produces.
 */
export async function newGroup(page, base, { name, me, members = [], onForm }) {
  await page.goto(`${base}/new`);
  await page.locator("#g-name").fill(name);
  await page.locator("#g-me").fill(me);
  await onForm?.();
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/g\?id=/);
  const id = new URL(page.url()).searchParams.get("id");

  await page.goto(`${base}/g/members?id=${id}`);
  for (const member of members) {
    await page.getByRole("button", { name: "Add member" }).click();
    await page.locator(".dinput").fill(member);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.waitForTimeout(150);
  }
  return id;
}
