/**
 * Canned receipts, for driving the scan without a camera or a model.
 *
 * The scan is the one act in the app that needs a network *and* a photo, so
 * every screen behind it — the who-had-what grid above all — is unreachable to
 * a check that can only press buttons. These fixtures stand in for the model's
 * answer: the client still decodes and downscales a real image, still parses
 * the envelope, still runs `checkScan`; only the round trip to Gemini is faked.
 *
 * Each file in `fixtures/receipts/` is one bill, and `exercises` says what it
 * is for — the verdict `checkScan` must reach on it. That claim is not prose:
 * `apps/web/lib/scan/fixtures.test.ts` asserts it against the real code every
 * `pnpm check`, which is what keeps a fixture from quietly rotting into a
 * receipt that no longer says anything (the last inline one grew a field
 * `ScanResult` never had, and nothing noticed).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./harness.mjs";

const DIR = join(ROOT, "scripts/fixtures/receipts");

/** Every fixture by name, in the order the directory lists them. */
export function receipts() {
  const out = new Map();
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()) {
    out.set(file.replace(/\.json$/, ""), JSON.parse(readFileSync(join(DIR, file), "utf8")));
  }
  return out;
}

/** One line each, for a driver that has to offer them to somebody. */
export function receiptList() {
  return [...receipts()].map(([name, r]) => `  ${name.padEnd(12)} ${r.exercises.padEnd(9)} ${r.note}`);
}

/**
 * A 1×1 PNG. The scan is faked; the photo is not — `downscaleToBase64Jpeg`
 * really does run, which is where `createImageBitmap` and `OffscreenCanvas`
 * would break if a build ever lost them.
 */
export const PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Answer this page's next scans with `name`, in Gemini's own envelope — the
 * client's `parseScanResponse` is the thing under test, so what goes over the
 * wire has to be shaped the way Gemini shapes it.
 *
 * A fixture with a `status` and no payload is the other kind of failure: the
 * phone and the photo are fine and the service is not.
 */
export async function stubScan(page, name) {
  const fixture = receipts().get(name);
  if (!fixture) throw new Error(`no such receipt: ${name} — try one of ${[...receipts().keys()].join(", ")}`);
  await page.unroute("**/api/groups/*/scan").catch(() => {});
  await page.route("**/api/groups/*/scan", (route) => route.fulfill(
    fixture.scan
      ? {
        status: fixture.status ?? 200,
        contentType: "application/json",
        body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(fixture.scan) }] } }] }),
      }
      : { status: fixture.status ?? 500, contentType: "application/json", body: JSON.stringify({ error: "upstream" }) },
  ));
  return fixture;
}
