/**
 * Shared plumbing for the browser checks — a build, a server speaking the
 * static export's dialect, a phone-shaped browser, and a group with people in
 * it. Written once, so a new check inherits every gotcha already paid for
 * (like the `/g` directory trap).
 *
 * Chromium comes from PLAYWRIGHT_BROWSERS_PATH, already on disk in the agent
 * environment. Never run `playwright install`.
 */
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync, statSync, readdirSync, rmSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

export const ROOT = resolve(import.meta.dirname, "../..");
export const OUT = join(ROOT, "apps/web/out");
/**
 * The agent environment ships a chromium at a fixed path; a laptop has
 * whatever `playwright install` left in its cache instead. Try the fixed path,
 * then the cache, then let playwright-core name its own default — so the same
 * check runs in both places without an env var.
 */
const EXECUTABLE = (() => {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (existsSync("/opt/pw-browsers/chromium")) return "/opt/pw-browsers/chromium";
  return undefined;
})();

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
 * Build the static export if it is missing or older than the sources — the
 * check's own precondition — skipping the ~25s when nothing changed.
 */
export function ensureBuild() {
  const built = statSync(join(OUT, "index.html"), { throwIfNoEntry: false })?.mtimeMs ?? 0;
  const source = Math.max(...SOURCES.map((s) => newestMtime(join(ROOT, s))));
  if (built > source) return;
  console.log(built ? "sources changed since the last build — rebuilding" : "no build yet — building");
  const { status } = spawnSync("pnpm", ["--filter", "@bida/web", "build"], {
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
 * Serve the real static export — not `next dev`, whose quirks differ from
 * what ships.
 *
 * `intercept(path, res)` gets first refusal on every request; returning true
 * means handled (how offline-check drops an asset and rewrites the worker's
 * revision). Port 0, so checks never collide.
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

/**
 * Serve the app as production does: one Worker in front of the static export
 * and the sync API, on a throwaway D1. ~10s of `wrangler dev` boot, for the
 * one thing `serveExport` can't fake — two phones syncing through the real
 * API. Use only when a check needs that.
 *
 * A fresh database directory per call, and migrations run against *that*
 * directory — run anywhere else, the Worker silently gets a table-less DB.
 */
export async function serveWorker({ state } = {}) {
  const api = join(ROOT, "apps/api");
  const persist = state ?? join(ROOT, ".drive/d1");
  rmSync(persist, { recursive: true, force: true });
  const migrate = spawnSync("npx", [
    "wrangler", "d1", "migrations", "apply", "hajsik", "--local", "--persist-to", persist,
  ], { cwd: api, encoding: "utf8" });
  if (migrate.status !== 0) throw new Error(`d1 migrations failed:\n${migrate.stderr ?? ""}`);

  const port = await freePort();
  // `wrangler dev` wraps the `workerd` it spawns, and signalling the wrapper
  // alone leaves multi-gigabyte processes behind until `start` can't launch.
  // `detached` makes it a process-group leader so one signal takes the family;
  // the exit hooks fire it even if the caller never reaches `close`.
  const child = spawn("npx", [
    "wrangler", "dev", "--port", String(port), "--persist-to", persist,
  ], { cwd: api, stdio: ["ignore", "pipe", "pipe"], detached: true });

  const close = () => {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
  };
  process.once("exit", close);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { close(); process.exit(1); });

  const base = `http://localhost:${port}`;
  const log = [];
  const ready = new Promise((ok, fail) => {
    const watch = (chunk) => {
      const text = String(chunk);
      log.push(text);
      if (text.includes("Ready on")) ok();
    };
    child.stdout.on("data", watch);
    child.stderr.on("data", watch);
    child.on("exit", (code) => fail(new Error(`wrangler exited (${code}):\n${log.join("")}`)));
    setTimeout(() => fail(new Error(`wrangler never became ready:\n${log.join("")}`)), 90_000);
  });
  try { await ready; } catch (e) { close(); throw e; }
  return { base, close };
}

/** An unused port, asked of the OS rather than guessed. */
function freePort() {
  return new Promise((ok) => {
    const probe = createServer();
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => ok(port));
    });
  });
}

/* ---- the browser -------------------------------------------------------- */

/**
 * How long any one wait may take before it counts as a failure — a ceiling,
 * never a schedule. Playwright's own default: `pnpm verify` runs seven
 * chromiums at once, each several times slower than alone. A navigation gets
 * twice it, going through the service worker and back as a document load.
 *
 * **The rule this is the fallback for:** a wait that gates an assertion waits
 * for the condition, not a duration. `waitForTimeout(400)` passes on a fast
 * machine and fails on a slow one. Use it only to assert something did *not*
 * happen, where there is no condition to wait for.
 */
export const PATIENCE = 30_000;

export const launch = () => chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});

/**
 * Make this page look like the app installed to a home screen.
 * `components/update.tsx` draws its offer only when standalone, and neither
 * Playwright nor CDP media emulation can set `display-mode` — so the query
 * itself is answered, for this page and its navigations. What counts as
 * "installed" is `lib/install.ts`'s, tested there.
 */
export async function asInstalledApp(page) {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    // Only this one query is answered here; the theme asks about
    // prefers-color-scheme through the same function and must still get a real
    // answer. CDP's media emulation does not cover display-mode, and nothing
    // reads these beyond `.matches`.
    window.matchMedia = (query) => (query.includes("display-mode")
      ? {
        matches: query.includes("standalone"), media: query, onchange: null,
        addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
        addListener() {}, removeListener() {},
      }
      : real(query));
  });
}

/**
 * A phone: 390×844, touch, mobile — what every screen is designed against.
 * Every wait through this context gets `PATIENCE`, sized for a machine running
 * all of `pnpm verify`.
 */
export async function newPhone(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ...opts,
  });
  ctx.setDefaultTimeout(PATIENCE);
  ctx.setDefaultNavigationTimeout(PATIENCE * 2);
  return ctx;
}

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
 * Wait `ms` on the page's own clock, then two frames for what it started.
 *
 * `page.waitForTimeout` is node's clock, idle while the page is starved — so
 * a pause covering an app timer (a 500ms long press, a flash) can end before
 * that timer runs under load. Measured in the page, both are late together.
 * The two frames are the render.
 *
 * Only where the page stays put: a navigation destroys the context this waits
 * in. To prove nothing happened, use `waitForTimeout`.
 */
export const settle = (page, ms = 0) => page.evaluate((n) => new Promise((ok) => {
  setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => ok())), n);
}), ms).catch(() => {});

/**
 * Open a picker and take a row out of it — every picker is one of these,
 * never a `<select>` (ADR-0008). By row, not role name: an option's
 * accessible name carries its note too.
 */
export async function pick(page, opener, row) {
  await page.locator(opener).click();
  await page.waitForSelector(".dlist");
  await page.locator(".drow-pick").filter({ hasText: row }).first().click();
  // The dialog's own closing, on its clock rather than on node's (`settle`).
  await settle(page, 120);
}

/**
 * Create a group through the real UI rather than by poking IndexedDB, so a
 * check fails loudly when a screen it isn't looking at breaks. Returns the
 * group id. `onForm` runs on the filled-in create screen before Create.
 */
export async function newGroup(page, base, { name, me, members = [], onForm }) {
  await page.goto(`${base}/new`);
  await page.locator("#g-name").fill(name);
  // Everybody goes in the same inline row, you included — there is no "you"
  // field; the screen ends by asking which name is yours.
  for (const member of [me, ...members]) {
    await page.getByLabel("Add someone").fill(member);
    await page.keyboard.press("Enter");
  }
  await onForm?.();
  await page.getByRole("button", { name: "Create" }).click();
  // Which one are you, asked of every group including a group of one.
  await page.locator("button.row").filter({ hasText: me }).first().click();
  await page.getByRole("button", { name: `Continue as ${me}` }).click();
  await page.waitForURL(/\/g\?id=/);
  return new URL(page.url()).searchParams.get("id");
}

/**
 * Launch the app and end up on the groups list. A phone that has opened a
 * group is put straight back into it (`apps/web/lib/launch.ts`), so the list
 * is one Back away, as for a thumb.
 */
export async function openGroupsList(page, base) {
  await page.goto(`${base}/`);
  // The resume is a `replace` a tick after load, so a URL read early would skip
  // the coming hop. The screen says when it's decided: `/` draws the skeleton
  // while deciding (app/page.tsx). Wait for that, never a fixed pause.
  await page.waitForFunction(
    () => window.location.pathname !== "/" || !document.querySelector(".skelrow"),
    null, { timeout: PATIENCE },
  );
  if (new URL(page.url()).pathname !== "/") {
    await page.locator(".iconbtn[aria-label='Back']").first().click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: PATIENCE });
  }
}
