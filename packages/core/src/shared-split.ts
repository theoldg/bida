// Doc: docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md
import { isCurrencyCode, type CurrencyCode } from "./money.js";
import type { ExtraKind } from "./scan.js";

/**
 * A quick split's answer as a link hands it over (ADR-0035): the figures the
 * sender's phone worked out, frozen. Never the bill and the grid behind them —
 * re-deriving the same cents takes the person ids, which are minted from the
 * phone's scan credential, and a link would carry that to everyone it reaches.
 * Frozen also means a later build's arithmetic can't move a cent of it.
 */
export interface SharedSplit {
  title: string;
  /** Read for its exponent alone: the figures are bare (ADR-0035). */
  currency: CurrencyCode;
  totalMinor: number;
  people: SharedShare[];
}

export interface SharedShare {
  name: string;
  minor: number;
  lines: SharedLine[];
}

/** One line of somebody's share, as the bill read back draws it. */
export interface SharedLine {
  label: string;
  extra?: ExtraKind;
  /** The part of the line that was theirs, as a fraction: ×1/2 shared. */
  count: { n: number; d: number };
  /** Negative on a deduction. */
  minor: number;
}

/**
 * Past any honest bill, which is ~120 lines among a dozen people. A link is
 * anybody's to write, so what it can make a screen draw is bounded here.
 */
const MAX_PEOPLE = 100;
const MAX_LINES = 1000;
const MAX_TEXT = 200;

const EXTRAS: readonly string[] = ["discount", "tax", "tip"] satisfies readonly ExtraKind[];

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => Number.isSafeInteger(x);
const text = (x: unknown) => (typeof x === "string" ? x.slice(0, MAX_TEXT) : null);

/**
 * An opened split, or null when it is not one this build can draw. **Fields it
 * doesn't know are ignored, never refused** — a link outlives the build that
 * wrote it, as `parseJoinLink` says of an invite — and so is an extra of a
 * kind it doesn't know: the line keeps its label and figure.
 */
export function readSharedSplit(input: unknown): SharedSplit | null {
  if (!isObj(input) || !Array.isArray(input["people"]) || input["people"].length > MAX_PEOPLE) return null;
  const title = text(input["title"]);
  const currency = input["currency"];
  const totalMinor = input["totalMinor"];
  if (title === null || typeof currency !== "string" || !isCurrencyCode(currency) || !isInt(totalMinor)) {
    return null;
  }
  const people: SharedShare[] = [];
  for (const p of input["people"]) {
    if (!isObj(p) || !Array.isArray(p["lines"]) || p["lines"].length > MAX_LINES) return null;
    const name = text(p["name"]);
    if (name === null || !isInt(p["minor"])) return null;
    const lines: SharedLine[] = [];
    for (const l of p["lines"]) {
      const line = readLine(l);
      if (!line) return null;
      lines.push(line);
    }
    people.push({ name, minor: p["minor"], lines });
  }
  return { title, currency, totalMinor, people };
}

function readLine(l: unknown): SharedLine | null {
  if (!isObj(l) || !isObj(l["count"])) return null;
  const label = text(l["label"]);
  const { n, d } = l["count"];
  if (label === null || !isInt(l["minor"]) || !isInt(n) || !isInt(d) || n <= 0 || d <= 0) return null;
  const extra = l["extra"];
  return {
    label,
    ...(typeof extra === "string" && EXTRAS.includes(extra) ? { extra: extra as ExtraKind } : {}),
    count: { n, d },
    minor: l["minor"],
  };
}
