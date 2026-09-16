#!/usr/bin/env node
/**
 * Post-build: stamp `out/sw.js` with the real list of files to precache and a
 * revision derived from them.
 *
 * The list used to be hand-written in `public/sw.js`, and it drifted — it named
 * `/g/split`, which no longer exists, and missed five routes that do. It also
 * only ever held HTML: not the JS chunks each route needs, and not the `.txt`
 * RSC payloads every in-app tap fetches, which is why an installed phone still
 * went to the network on every navigation and fell apart offline. Walking the
 * export is the only version of this list that can't go stale.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const OUT = resolve(import.meta.dirname, "../out");

/** Every file in the export, as a root-relative URL path. */
async function walk(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else found.push("/" + relative(OUT, full).split("\\").join("/"));
  }
  return found;
}

/**
 * `out/g.html` is served at `/g` and `out/index.html` at `/`. The cache is keyed
 * by the URL the browser will actually ask for, so the precache stores the
 * route, never the file name.
 */
function routeFor(file) {
  if (file === "/index.html") return "/";
  if (file.endsWith("/index.html")) return file.slice(0, -"/index.html".length);
  return file.slice(0, -".html".length);
}

// Source maps are dead weight on a phone, and the service worker can't precache
// itself. Everything else in the export is something a screen needs to paint.
// `/media/` is the install walkthrough: a megabyte only a browser tab ever shows,
// since the installed app never reaches /install.
const skip = (f) => f.endsWith(".map") || f === "/sw.js" || f.startsWith("/media/");

const files = (await walk(OUT)).filter((f) => !skip(f));
const assets = files.map((f) => (f.endsWith(".html") ? routeFor(f) : f)).sort();
const sizes = await Promise.all(files.map((f) => readFile(join(OUT, f)).then((b) => b.length)));

// Content-addressed over the file names, which carry Next's build hashes: the
// same build gives the same revision, a changed one gives a new cache name, and
// `activate` drops the old cache on its own. Nothing left to bump by hand.
const rev = createHash("sha256").update(assets.join("\n")).digest("hex").slice(0, 12);

const swPath = join(OUT, "sw.js");
const src = await readFile(swPath, "utf8");
const stamped = src
  .replace('"__PRECACHE_REVISION__"', JSON.stringify(rev))
  .replace('["__PRECACHE_ASSETS__"]', JSON.stringify(assets));

if (stamped === src) {
  console.error("precache: nothing to stamp in out/sw.js — did public/sw.js lose its placeholders?");
  process.exit(1);
}

await writeFile(swPath, stamped);
console.log(
  `precache: ${assets.length} files, ${Math.round(sizes.reduce((a, b) => a + b, 0) / 1024)}kB, rev ${rev}`,
);
