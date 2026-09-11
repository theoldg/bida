import type { SplitSpec } from "@bida/core";
import { copy } from "./copy";
import type { EntryKind } from "./entry-kind";
import { plural } from "./format";

/**
 * A ledger row's second line, written several ways, longest first.
 *
 * `FitLine` renders the longest one that fits, so **this order is the
 * editorial decision** about what a narrow phone loses first — the measuring
 * is just arithmetic ([`lib/fit.ts`](./fit.ts)). Two rules set it:
 *
 * - **Shortening must not lie.** "Alice paid" is false when Bob paid too, so
 *   the co-payers are abbreviated ("Alice +1 paid") and never dropped.
 * - **Drop what the entry's own screen says better,** cheapest first. The
 *   split mode is one tap away and names itself there (ADR-0016); the share
 *   count is a detail; who paid is what the row is for, and is last to go.
 *
 * There is no rung that drops the payer, because there is nothing left to say
 * after it. Past the bottom of the ladder the name itself gets the ellipsis.
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
  kind: EntryKind;
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
 * A transfer's line. The row's *title* is already "Alice paid Bob", so the
 * word "Transfer" is a label on something the row has said — which makes it
 * the one thing here worth dropping for a long note.
 */
export function transferMeta(note: string | null | undefined): string[] {
  const trimmed = note?.trim();
  return trimmed ? [copy.group.transferNote(trimmed), trimmed] : [copy.group.transfer];
}
