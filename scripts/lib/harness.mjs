/**
 * Shared plumbing for the browser checks — `shots.mjs`, `entries-check.mjs`,
 * `offline-check.mjs`, `drive.mjs`.
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

/**
 * Serve the app the way production does: one Cloudflare Worker in front of both
 * the static export and the sync API, on a throwaway D1.
 *
 * `serveExport` above is enough for a check about one phone's screens, and it
 * starts in milliseconds. This one costs ~10 seconds of `wrangler dev` boot and
 * buys the only thing that cannot be faked — two phones actually syncing
 * through the real API. Reach for it only when a check needs that.
 *
 * The database is a fresh directory per call, so a session never inherits the
 * groups of the one before it, and migrations run against that directory rather
 * than the repo's `.wrangler/state` — running them anywhere else silently gives
 * the Worker a database with no tables in it.
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
  // `wrangler dev` is a wrapper around the `workerd` it spawns, and a signal to
  // the wrapper alone leaves that running: `pnpm drive stop` printed "stopped"
  // and left multi-gigabyte processes behind, until enough of them meant the
  // next `start` never got off the ground. `detached` makes it a process group
  // leader, so one signal takes the whole family — and the exit hooks fire it
  // even when the caller dies without reaching `close`.
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

export const launch = () => chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});

/**
 * Make this page look like the app installed to a home screen.
 *
 * `components/update.tsx` draws the update offer only when the app is
 * standalone — a browser tab has a reload button of its own — and playwright
 * has no API for `display-mode` — nor, it turns out, does CDP's media
 * emulation. So the query itself is answered, for this page and every
 * navigation it makes. Which signal means "installed" is `lib/install.ts`'s
 * subject and has its own tests; what is being driven here is the screen
 * behind it.
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
  // Everybody goes in the same inline row, this device's owner included —
  // there is no separate "you" field, and which of these names is yours is the
  // question the screen ends on. This is the flow a person takes, and it is
  // the one worth exercising.
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
 * Launch the app and end up on the groups list.
 *
 * A phone that has opened a group is put straight back into it
 * (`apps/web/lib/launch.ts`), so on every phone but a brand-new one the list
 * is one Back away — and taking that hop is what these checks mean by "the
 * groups list", the same as a thumb does.
 */
export async function openGroupsList(page, base) {
  await page.goto(`${base}/`);
  // The resume is a `replace` a tick after the load, so a URL read before it
  // lands would say "already there" and skip the hop that is coming.
  await page.waitForTimeout(400);
  if (new URL(page.url()).pathname !== "/") {
    await page.locator(".iconbtn[aria-label='Back']").first().click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 8000 });
  }
}
