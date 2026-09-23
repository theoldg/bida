import type { SplitSpec } from "@bida/core";
import { copy } from "./copy";
import { plural } from "./format";

/**
 * A ledger row's second line, written several ways, longest first.
 *
 * `FitLine` renders the longest that fits, so **this order is the editorial
 * decision** about what a narrow phone loses first ([`lib/fit.ts`](./fit.ts)):
 *
 * - **Shortening must not lie.** Co-payers are abbreviated ("Alice +1 paid"),
 *   never dropped.
 * - **Drop what the entry's own screen says better**, cheapest first: split
 *   mode (ADR-0016), then share count; the payer is last and never dropped —
 *   past the ladder the name itself gets the ellipsis.
 */

const joined = (a: string, b: string) => copy.group.metaLine(a, b);

/** Same rung twice is a wasted measurement — an equal split has no mode to drop. */
function ladder(rungs: string[]): string[] {
  return rungs.filter((rung, i) => rung !== rungs[i - 1]);
}

export function expenseMeta({ payer, coPayers, kind, ways, mode }: {
  payer: string;
  /** How many people paid *besides* `payer`. */
  coPayers: number;
  /** Only the kinds with a payer side; a transfer uses `transferMeta`. */
  kind: "expense" | "income";
  /** How many shares the amount was cut into. */
  ways: number;
  mode: SplitSpec["mode"];
}): string[] {
  const verb = copy.entryKind.verb[kind];
  const who = coPayers > 0
    ? copy.group.payers(payer, plural(coPayers, copy.noun.other), verb)
    : copy.group.payers(payer, null, verb);
  const whoTight = coPayers > 0 ? copy.group.payersTight(payer, coPayers, verb) : who;

  const count = plural(ways, copy.noun.way);
  const how = (kind === "income" ? copy.group.sharedWays : copy.group.splitWays)(count);
  const howFull = mode === "equal"
    ? how
    : copy.group.splitAs(plural(ways, copy.noun.person), copy.split.mode[mode].toLowerCase());

  return ladder([
    joined(who, howFull),
    joined(who, how),
    joined(whoTight, how),
    joined(whoTight, count),
    whoTight,
  ]);
}

/**
 * A transfer's line: its note, or "Transfer" when it has none. The title
 * already says "Alice paid Bob", so a note leaves the label nothing to add.
 */
export function transferMeta(note: string | null | undefined): string[] {
  const trimmed = note?.trim();
  return [trimmed || copy.group.transfer];
}
