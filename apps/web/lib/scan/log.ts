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
  // Kept before charges were a list, a reading has its tax apart instead.
  const { tax } = read as { tax?: string | null };
  const charges = [...read.charges ?? [], ...(tax ? [{ label: "tax", amount: tax }] : [])];
  return [
    head,
    ...read.lineItems.map((li) => {
      const each = li.quantity !== null || li.unitAmount !== null
        ? `  ${li.quantity ?? "?"} × ${or(li.unitAmount)}`
        : "";
      return `  ${or(li.amount).padStart(9)}${each}  ${li.label}`;
    }),
    ...charges.map((c) => `  ${`+${c.amount}`.padStart(9)}  on   ${c.label}`),
    ...read.discounts.map((d) => `  ${`-${d.amount}`.padStart(9)}  off  ${d.label}`),
    // Outside the total; so was a tip kept back when it meant a charge, which reads the same.
    ...(read.tip ? [`  ${`+${read.tip}`.padStart(9)}  tip  after the total`] : []),
  ];
}

export function readingsReport(): string[] {
  return keptReadings().reverse().flatMap(describeReading);
}
