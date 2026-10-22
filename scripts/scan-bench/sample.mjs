/**
 * The drawn sample, and the receipts a command names — docs/scan-bench.md.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DATA = join(import.meta.dirname, "data");

export const sample = () => JSON.parse(readFileSync(join(DATA, "sample/truth.json"), "utf8")).receipts;

/** `--only r03,r08` or `--only r50-r149`: whether a receipt is one of them; everything without. */
export function only(spec) {
  if (!spec) return () => true;
  const num = (id) => Number(id.slice(1));
  const tests = spec.split(",").map((part) => {
    const [from, to] = part.split("-");
    return to ? (id) => num(id) >= num(from) && num(id) <= num(to) : (id) => id === from;
  });
  return (id) => tests.some((t) => t(id));
}
