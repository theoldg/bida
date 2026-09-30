import type { SplitSpec } from "@bida/core";
import { copy } from "./copy";
import { plural } from "./format";

/**
 * A row's second line, written several ways, longest first.
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

/**
 * How the amount was cut, in full — "split 3 ways", "3 people, as parts". The
 * ledger row's longest rung, and the history's word for the same thing: a
 * parts split logged as "split 3 ways" reads as an even one.
 */
export function splitPhrase(kind: "expense" | "income", ways: number, mode: SplitSpec["mode"]): string {
  if (mode !== "equal") {
    return copy.group.splitAs(plural(ways, copy.noun.person), copy.split.mode[mode].toLowerCase());
  }
  return (kind === "income" ? copy.group.sharedWays : copy.group.splitWays)(plural(ways, copy.noun.way));
}

export function expenseMeta({ payer, coPayers, kind, ways, mode }: {
  payer: string;
  /** The names of whoever paid *besides* `payer`. */
  coPayers: string[];
  /** Only the kinds with a payer side; a transfer uses `transferMeta`. */
  kind: "expense" | "income";
  /** How many shares the amount was cut into. */
  ways: number;
  mode: SplitSpec["mode"];
}): string[] {
  const verb = copy.entryKind.verb[kind];
  const [other] = coPayers;
  const who = coPayers.length > 1
    ? copy.group.payers(payer, plural(coPayers.length, copy.noun.other), verb)
    : other !== undefined
      ? copy.group.payersPair(payer, other, verb)
      : copy.group.payers(payer, null, verb);
  const whoTight = coPayers.length > 0 ? copy.group.payersTight(payer, coPayers.length, verb) : who;

  const count = plural(ways, copy.noun.way);
  const how = (kind === "income" ? copy.group.sharedWays : copy.group.splitWays)(count);
  const howFull = splitPhrase(kind, ways, mode);

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

/**
 * A group list row's line. "N new changes" rides ahead of it as `FitLine`'s
 * `lead`, on every rung, and the time is the last thing standing: both say
 * whether to open the group, the counts only what is inside it. People go
 * before entries — the roster barely moves; the entry count is the activity.
 */
export function groupMeta({ people, entries, when }: {
  people: number;
  entries: number;
  /** Already worded, `ago(lastActivity)`. */
  when: string;
}): string[] {
  const count = plural(entries, copy.noun.entry);
  return [joined(joined(plural(people, copy.noun.person), count), when), joined(count, when), when];
}

/**
 * The entry screen's link to its own history, above Edit: who created it, or
 * how often it has changed and who changed it last. The name is what goes
 * when the line runs short — the count is what says whether to press, and a
 * name that doesn't fit is not worth an ellipsis. A creator with no room left
 * leaves "History", which still says where the link goes. An imported entry
 * says so instead: its creator and moment are the import's, not the entry's.
 */
export function historyMeta({ edits, creator, lastEditor, imported }: {
  /** Revisions after the create; a delete or a restore is not one. */
  edits: number;
  creator: string;
  lastEditor: string;
  /** Came in with the group (`isImported`): `true`, or what it was read from. */
  imported?: string | boolean;
}): string[] {
  if (edits === 0 && imported) {
    const from = typeof imported === "string" ? imported : undefined;
    return [copy.entry.importedBy(creator, from), copy.entry.imported(from)];
  }
  if (edits === 0) return [copy.entry.createdBy(creator), copy.entry.history];
  const count = copy.entry.edited(edits);
  return [joined(count, copy.entry.editedBy(edits, lastEditor)), count];
}
