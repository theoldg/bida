#!/usr/bin/env node
/**
 * Post-build: stamp `out/sw.js` with the real list of files to precache —
 * every route's HTML, its JS chunks and the `.txt` RSC payloads each in-app
 * tap fetches — and a revision derived from them. Walking the export is the
 * only version of this list that can't go stale; a hand-written one drifts
 * and breaks offline. Files with the same bytes are listed once, the rest of
 * their names as `COPIES`, so a phone downloads each only once.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

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
// since the installed app never reaches /install. `/og.png` is the link-preview
// banner: only a chat app's scraper ever fetches it. `/scanic/` is the scan's
// crop model, 2.5 MB fetched on the first scan tap and never from the cache.
// A `noModule` script is Next's polyfill for browsers without modules — a
// tenth of the chunks, and no browser that runs a service worker loads it.
const noModule = new Set(
  [...(await readFile(join(OUT, "index.html"), "utf8")).matchAll(/<script\b[^>]*>/g)]
    .map(([tag]) => / noModule\b/i.test(tag) && tag.match(/ src="([^"]+)"/)?.[1])
    .filter(Boolean),
);
const skip = (f) =>
  f.endsWith(".map") || f === "/sw.js" || f.startsWith("/media/") || f === "/og.png"
  || f.startsWith("/scanic/") || noModule.has(f);

const files = (await walk(OUT)).filter((f) => !skip(f)).sort();

/**
 * One list entry per distinct file, and every other name with the same bytes
 * as its copy. Grouped by extension too, so a copy is served as the type it was
 * asked for. The shortest name fetches: `/g.txt`, not `/g/__next._full.txt`.
 */
const byContent = new Map();
let bytes = 0;
for (const file of files) {
  const body = await readFile(join(OUT, file));
  const key = `${extname(file)} ${createHash("sha256").update(body).digest("hex")}`;
  if (!byContent.has(key)) bytes += body.length;
  byContent.set(key, [...(byContent.get(key) ?? []), file.endsWith(".html") ? routeFor(file) : file]);
}
const copies = {};
const assets = [];
for (const names of byContent.values()) {
  const [first, ...rest] = names.sort((a, b) => a.length - b.length || a.localeCompare(b));
  assets.push(first);
  if (rest.length) copies[first] = rest;
}
assets.sort();
const copyCount = Object.values(copies).flat().length;

// Hashed over file names, which carry Next's build hashes: same build, same
// revision; a new one gets a new cache and `activate` drops the old.
const rev = createHash("sha256")
  .update([...assets, ...Object.values(copies).flat()].sort().join("\n")).digest("hex").slice(0, 12);

const swPath = join(OUT, "sw.js");
const src = await readFile(swPath, "utf8");
const stamped = src
  .replace('"__PRECACHE_REVISION__"', JSON.stringify(rev))
  .replace('["__PRECACHE_ASSETS__"]', JSON.stringify(assets))
  .replace("{ __PRECACHE_COPIES__: [] }", JSON.stringify(copies));

if (stamped.includes("__PRECACHE_")) {
  console.error("precache: a placeholder is left in out/sw.js — did public/sw.js change its spelling?");
  process.exit(1);
}

await writeFile(swPath, stamped);
console.log(
  `precache: ${assets.length} files (${copyCount} more as copies), ${Math.round(bytes / 1024)}kB, rev ${rev}`,
);
