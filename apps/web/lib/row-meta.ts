import { copy } from "./copy";
import { plural } from "./format";

/**
 * A row's second line, written several ways, longest first.
 *
 * `FitLine` renders the longest that fits, so **this order is the editorial
 * decision** about what a narrow phone loses first ([`lib/fit.ts`](./fit.ts)).
 * An expense's line is not here: it is a name and a count, and drops the count
 * in CSS (`ExpenseMeta` in `app/g/page.tsx`).
 */

const joined = (a: string, b: string) => copy.group.metaLine(a, b);

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
