#!/usr/bin/env node
/**
 * Downloads WildReceipt and draws the benchmark's sample from its test split:
 * each receipt shrunk as the phone shrinks a photo, and the labels it carries.
 * By hand, once — docs/scan-bench.md.
 *
 *   node scripts/scan-bench/fetch.mjs [--count 50] [--seed 20261022]
 *
 * Everything lands in scripts/scan-bench/data/ (gitignored). The archive is
 * kept, so a new sample does not download it again.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { launch } from "../lib/harness.mjs";

const URL = "https://download.openmmlab.com/mmocr/data/wildreceipt.tar";
const DATA = join(import.meta.dirname, "data");
const SET = join(DATA, "wildreceipt");
const SAMPLE = join(DATA, "sample");

const { values } = parseArgs({
  options: { count: { type: "string", default: "50" }, seed: { type: "string", default: "20261022" } },
});
const count = Number(values.count);
const seed = Number(values.seed);

if (!existsSync(join(SET, "test.txt"))) {
  mkdirSync(DATA, { recursive: true });
  const tar = join(DATA, "wildreceipt.tar");
  console.log(`downloading ${URL} (~185 MB)`);
  const res = await fetch(URL);
  if (!res.ok || !res.body) throw new Error(`download: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tar));
  const untar = spawnSync("tar", ["-xf", tar, "-C", DATA], { stdio: "inherit" });
  if (untar.status !== 0) throw new Error("tar failed");
}

/** WildReceipt's classes, the ones scored — class_list.txt has the rest. */
const CLASSES = {
  1: "store", 7: "date", 11: "item", 13: "qty", 15: "price", 17: "subtotal", 19: "tax", 21: "tips", 23: "total",
};

/** mulberry32: the same seed draws the same receipts on any machine. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rows = readFileSync(join(SET, "test.txt"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const next = random(seed);
for (let i = rows.length - 1; i > 0; i--) {
  const j = Math.floor(next() * (i + 1));
  [rows[i], rows[j]] = [rows[j], rows[i]];
}
const picked = rows.slice(0, count);

rmSync(SAMPLE, { recursive: true, force: true });
mkdirSync(join(SAMPLE, "imgs"), { recursive: true });

/**
 * The phone's encode (apps/web/lib/scan/downscale.ts): at most a megapixel,
 * JPEG at 0.7, fewer pixels until it fits the Worker's cap — in Chromium, so
 * the encoder is the one a phone's browser uses. The crop to the bill is not
 * reproduced: these are mostly photos of the bill already.
 */
const browser = await launch();
const page = await browser.newPage();
const shrink = (bytes) => page.evaluate(async (b64) => {
  const MAX_PIXELS = 1024 * 1024;
  const TARGET_BASE64 = Math.floor(400_000 * 0.75);
  const blob = await (await fetch(`data:application/octet-stream;base64,${b64}`)).blob();
  const bill = await createImageBitmap(blob);
  for (let budget = MAX_PIXELS; ; budget *= 0.7) {
    const scale = Math.min(1, Math.sqrt(budget / (bill.width * bill.height)));
    const width = Math.max(1, Math.round(bill.width * scale));
    const height = Math.max(1, Math.round(bill.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bill, 0, 0, width, height);
    const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 });
    const bytes = new Uint8Array(await out.arrayBuffer());
    let bin = "";
    for (const byte of bytes) bin += String.fromCharCode(byte);
    const base64 = btoa(bin);
    if (base64.length <= TARGET_BASE64 || budget < 250_000) return { base64, width, height };
  }
}, bytes.toString("base64"));

const truth = [];
for (const [i, row] of picked.entries()) {
  const id = `r${String(i).padStart(2, "0")}`;
  const sent = await shrink(readFileSync(join(SET, row.file_name)));
  writeFileSync(join(SAMPLE, "imgs", `${id}.jpg`), Buffer.from(sent.base64, "base64"));
  // Reading order, by box centre: rows of 8px, then left to right.
  const centre = (a, k) => a.box.filter((_, n) => n % 2 === k).reduce((s, v) => s + v, 0) / 4;
  const boxes = [...row.annotations].sort((a, b) =>
    Math.round(centre(a, 1) / 8) - Math.round(centre(b, 1) / 8) || centre(a, 0) - centre(b, 0));
  const fields = Object.fromEntries(Object.values(CLASSES).map((k) => [k, []]));
  for (const box of boxes) if (CLASSES[box.label]) fields[CLASSES[box.label]].push(box.text);
  truth.push({
    id, file: row.file_name, source: { width: row.width, height: row.height },
    sent: { width: sent.width, height: sent.height }, ...fields,
    // Every box, whatever its class, for a title the labels filed elsewhere.
    boxes: boxes.map((b) => b.text),
  });
}
await browser.close();

writeFileSync(join(SAMPLE, "truth.json"), JSON.stringify({ seed, count, receipts: truth }, null, 1));
console.log(`${truth.length} receipts → ${SAMPLE}`);
