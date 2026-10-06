import { type Id } from "@bida/core";
import { copy } from "./copy";

/**
 * The rows under a history sentence: what moved, one row per *kind* of move
 * rather than per person. Two strings struck through and rewritten in full
 * ("Ana, Bruno, Cy, Dee, Eve, Fay" → "Ana, Bruno, Dee, Eve, Fay") make the
 * reader play spot-the-difference; a row saying "− Cy" doesn't.
 *
 * Pure and total, like `describe` over it: it runs in a render.
 */

/** One row: a person (or several moving alike), or a line of the bill. */
export interface Row {
  /** Who or what — "Cy", "Everyone but Cy", "Jawa juice". */
  name: string;
  /** Came in or went out. Absent where it is there either side. */
  mark?: "+" | "−";
  was?: string;
  now?: string;
  /** A bill line, not a person: drawn quieter, so the two lists read apart. */
  item?: boolean;
  /**
   * `was` went and `now` came, side by side — people on a bill line — rather
   * than one value replacing another, so no arrow between them.
   */
  set?: boolean;
}

/** How to name people, as of the revision. */
export interface People {
  nameOf: (id: Id) => string;
  /** The group as the op landed (`Revision.roster`). */
  roster: readonly Id[];
}

/** Ids in printed order, by name — ids are hashes of names (ADR-0034), so id order is noise. */
export function byName(ids: Iterable<Id>, people: People): Id[] {
  return [...ids].sort((a, b) => people.nameOf(a).localeCompare(people.nameOf(b)));
}

/**
 * A set of people as briefly as it can be said truly. "Everyone" and "everyone
 * but" are about the group *as it was*: a later joiner mustn't turn last
 * month's "Everyone" into "Everyone but Zoe". Below three people the names are
 * as short as either.
 */
export function peopleText(ids: readonly Id[], people: People): string {
  const said = copy.history;
  const set = new Set(ids);
  const roster = new Set(people.roster);
  const within = roster.size >= 3 && ids.every((id) => roster.has(id));
  if (within && set.size === roster.size) return said.everyone;
  const missing = people.roster.filter((id) => !set.has(id));
  // "Everyone but" only where it is the shorter way round.
  if (within && set.size >= 3 && missing.length <= 2 && missing.length < set.size) {
    return said.everyoneBut(byName(missing, people).map(people.nameOf).join(", "));
  }
  return byName(set, people).map(people.nameOf).join(", ");
}

/**
 * Each person's figure either side, as rows — people who moved alike share
 * one. Taking one of ten out of an even split is two rows ("− Cy", "Everyone
 * but Cy 10.00 → 11.11"), not ten. A figure of `""` is a person with no
 * figure to show: they still come and go.
 *
 * In joins first, then outs, then moves; each run in name order.
 */
export function moves(
  was: ReadonlyMap<Id, string> | null,
  now: ReadonlyMap<Id, string>,
  people: People,
): Row[] {
  const groups = new Map<string, { mark?: "+" | "−"; was?: string; now?: string; ids: Id[] }>();
  const everyone = byName(new Set([...(was?.keys() ?? []), ...now.keys()]), people);
  for (const id of everyone) {
    const before = was?.get(id);
    const after = now.get(id);
    if (before === after) continue;
    const mark = before === undefined ? "+" : after === undefined ? "−" : undefined;
    const key = `${mark ?? ""}|${before ?? ""}|${after ?? ""}`;
    const group = groups.get(key);
    if (group) group.ids.push(id);
    else groups.set(key, { mark, was: before || undefined, now: after || undefined, ids: [id] });
  }
  const rank = (m?: "+" | "−") => (m === "+" ? 0 : m === "−" ? 1 : 2);
  return [...groups.values()]
    .sort((a, b) => rank(a.mark) - rank(b.mark))
    .map(({ ids, ...row }) => ({ name: peopleText(ids, people), ...row }));
}

/**
 * Everybody's figure on one line, the people on the same figure together and
 * the biggest first: "Chewie 24.00 · Han, Luke 20.00 · Ben 17.00". A figure
 * everybody shares is said once: "Everyone · 20.25 each".
 */
export function tally(figures: ReadonlyMap<Id, number>, show: (minor: number) => string, people: People): string {
  const groups = new Map<number, Id[]>();
  for (const [id, minor] of figures) {
    const group = groups.get(minor);
    if (group) group.push(id);
    else groups.set(minor, [id]);
  }
  const [only, more] = [...groups];
  if (only && !more && only[1].length > 1) {
    return copy.history.each(peopleText(only[1], people), show(only[0]));
  }
  return [...groups]
    .sort(([a], [b]) => b - a)
    .map(([minor, ids]) => copy.history.shareOf(peopleText(ids, people), show(minor)))
    .join(" · ");
}

/** The most common figure: an even split's cents land on a few people, which isn't news. */
export function typical(values: Iterable<number>): number | undefined {
  const counts = new Map<number, number>();
  let best: number | undefined;
  let most = 0;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > most || (n === most && best !== undefined && v < best)) { most = n; best = v; }
  }
  return best;
}

/** A line of a bill as the history compares it (`printedBill`). */
export interface BillLine {
  label: string;
  labelEn: string | null;
  amount: string;
  quantity: number;
}

/**
 * What a re-read or re-typed bill changed, line by line: "+ Blue milk 9.00",
 * "− Jawa juice 24.00", "Tall glass 16.00 → 18.00". Lines are paired by what
 * they say, the identical ones first, so a line that moved down the bill is
 * no news and one whose price was corrected is a move, not an out and an in.
 */
export function billRows(was: readonly BillLine[], now: readonly BillLine[], english: boolean): Row[] {
  const named = (line: BillLine) => (english ? line.labelEn || line.label : line.label);
  const figure = (line: BillLine) =>
    (line.quantity > 1 ? copy.history.quantity(line.quantity, line.amount) : line.amount);
  const taken = new Set<number>();
  const pairOf = new Array<number>(now.length).fill(-1);
  const pair = (same: (a: BillLine, b: BillLine) => boolean) => {
    now.forEach((line, i) => {
      if (pairOf[i]! >= 0) return;
      const j = was.findIndex((old, k) => !taken.has(k) && same(old, line));
      if (j >= 0) { pairOf[i] = j; taken.add(j); }
    });
  };
  pair((a, b) => a.label === b.label && a.amount === b.amount && a.quantity === b.quantity);
  pair((a, b) => a.label === b.label);

  const rows: Row[] = [];
  now.forEach((line, i) => {
    const j = pairOf[i]!;
    if (j < 0) { rows.push({ name: named(line), mark: "+", now: figure(line), item: true }); return; }
    const old = was[j]!;
    if (figure(old) !== figure(line)) rows.push({ name: named(line), was: figure(old), now: figure(line), item: true });
  });
  was.forEach((line, j) => {
    if (!taken.has(j)) rows.push({ name: named(line), mark: "−", was: figure(line), item: true });
  });
  return rows;
}

/** A charge on the bill nobody ordered — tip, tax, one deduction — appearing, going or moving. */
export function chargeRow(name: string, was: string | null, now: string | null): Row | null {
  if ((was ?? "") === (now ?? "")) return null;
  if (!was) return { name, mark: "+", now: now!, item: true };
  if (!now) return { name, mark: "−", was, item: true };
  return { name, was, now, item: true };
}

/**
 * Who had a line, either side, as a row — "Jawa juice ~~Luke~~ + Ben" — or
 * null where nobody moved. A line whose portions went to different people
 * reads portion by portion, since a set can't say who had which.
 */
export function eatersRow(
  name: string, was: readonly (readonly Id[])[], now: readonly (readonly Id[])[], people: People,
): Row | null {
  const key = (rows: readonly (readonly Id[])[]) => JSON.stringify(rows.map((r) => [...r].sort()));
  if (key(was) === key(now)) return null;
  const names = (ids: readonly Id[]) => byName(ids, people).map(people.nameOf).join(", ") || copy.history.nobody;
  if (was.length > 1 || now.length > 1) {
    const each = (rows: readonly (readonly Id[])[]) => rows.map(names).join(" / ");
    return { name, was: each(was), now: each(now), item: true };
  }
  const before = new Set(was[0] ?? []);
  const after = new Set(now[0] ?? []);
  const gone = [...before].filter((id) => !after.has(id));
  const came = [...after].filter((id) => !before.has(id));
  return {
    name,
    was: gone.length ? names(gone) : undefined,
    now: came.length ? copy.history.joinedIn(names(came)) : after.size ? undefined : copy.history.nobody,
    item: true,
    set: true,
  };
}
