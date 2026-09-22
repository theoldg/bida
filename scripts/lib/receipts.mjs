/**
 * Canned receipts, for driving the scan without a camera or a model.
 *
 * Every screen behind a scan — the who-had-what grid above all — is otherwise
 * unreachable to a button-pressing check. The client still decodes and
 * downscales a real image, parses the envelope and runs `checkScan`; only the
 * Gemini round trip is faked.
 *
 * Each file in `fixtures/receipts/` is one bill, and `exercises` names the
 * verdict `checkScan` must reach on it — asserted every `pnpm check` by
 * `apps/web/lib/scan/fixtures.test.ts`, so a fixture can't quietly rot.
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
 * Answer this page's next scans with `name`, in Gemini's own envelope, since
 * the client's `parseScanResponse` is under test. A fixture with a `status`
 * and no payload is the service failing, not the photo.
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
