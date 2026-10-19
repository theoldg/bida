// Doc: docs/diag.md
/**
 * The last few readings, as the model returned them, for /diag. In
 * `localStorage` like the rest of the recorder; leaves the phone only when
 * somebody copies the report.
 */
import type { ScanResult } from "@bida/core";

const KEY = "bida.diag.scans";
/** A reading is a receipt's worth of lines; three cover "it failed again". */
const KEPT = 3;

export interface KeptReading {
  at: number;
  /** `ok`, `corrected`, `rejected`, or the `ScanProblem` that refused it. */
  outcome: string;
  /** Before `correctOneLine`: what to read is what the model said. */
  read: ScanResult;
}

export function keepReading(outcome: string, read: ScanResult, at = Date.now()): void {
  try {
    const kept = [...keptReadings(), { at, outcome, read }].slice(-KEPT);
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Costs the log, never the scan.
  }
}

/** Oldest first. */
function keptReadings(): KeptReading[] {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? "[]") as KeptReading[];
    return Array.isArray(kept) ? kept : [];
  } catch {
    return [];
  }
}

/**
 * The figures as the model wrote them, no sums: the question a refusal asks is
 * which figure it misread, and a total worked out here would be one more to
 * doubt.
 */
export function describeReading({ at, outcome, read }: KeptReading): string[] {
  const when = new Date(at).toISOString().slice(5, 19).replace("T", " ");
  const or = (text: string | null) => text ?? "—";
  const head = `${when}  ${outcome.toUpperCase()}  total ${or(read.total)} ${or(read.currency)}`
    + `  ${or(read.date)}  ${or(read.title)}`;
  if (read.error) return [head, `  error  ${read.error}`];
  return [
    head,
    ...read.lineItems.map((li) => {
      const each = li.quantity !== null || li.unitAmount !== null
        ? `  ${li.quantity ?? "?"} × ${or(li.unitAmount)}`
        : "";
      return `  ${or(li.amount).padStart(9)}${each}  ${li.label}`;
    }),
    ...read.discounts.map((d) => `  ${`-${d.amount}`.padStart(9)}  off  ${d.label}`),
    `  tip ${or(read.tip)}  tax ${or(read.tax)}`,
  ];
}

export function readingsReport(): string[] {
  return keptReadings().reverse().flatMap(describeReading);
}
