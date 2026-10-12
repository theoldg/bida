/**
 * Claude's corner (docs/claude-corner.md) as data: the prose, then the
 * postcards. docs-check counts them; `pnpm push` merges two sessions' cards.
 */

export const CORNER = { lines: 100, postcards: 12, chars: 300 };

/**
 * `head` is everything before the first postcard — prose and the section's
 * own italic note — byte for byte; each card is kept as written, wrapping and
 * all, without the blank line after it. `null` without a "## Postcards".
 */
export function parseCorner(text) {
  const at = text.search(/^## Postcards$/m);
  if (at < 0) return null;
  const section = text.slice(at);
  const first = section.search(/^- /m);
  if (first < 0) return { head: text.replace(/\n*$/, "\n\n"), cards: [] };
  const cards = section
    .slice(first)
    .split(/^## /m)[0]
    .split(/\n(?=- )/)
    .filter((entry) => entry.startsWith("- "))
    .map((entry) => entry.replace(/\s+$/, ""));
  return { head: text.slice(0, at + first), cards };
}

/** One postcard, however it happens to be wrapped. */
export const flat = (card) => card.trim().replace(/\s+/g, " ");

/**
 * Two sessions that each added a postcard and evicted the oldest always
 * collide at both ends of the list, though neither touched the other's card.
 * `dev`'s cards stand; this side's new ones go on top, the ones it evicted
 * go, and the oldest go until twelve remain. The prose above merges only when
 * one side alone changed it — two rewrites of a sentence are an agent's to
 * read — so that answers `null`.
 */
export function mergeCorner(base, dev, mine) {
  const [b, d, m] = [base, dev, mine].map(parseCorner);
  if (!b || !d || !m) return null;
  let head;
  if (m.head === b.head || m.head === d.head) head = d.head;
  else if (d.head === b.head) head = m.head;
  else return null;
  const had = new Set(b.cards.map(flat));
  const kept = new Set(m.cards.map(flat));
  const added = m.cards.filter((c) => !had.has(flat(c)));
  const evicted = new Set([...had].filter((c) => !kept.has(c)));
  const onDev = new Set(d.cards.map(flat));
  const cards = [
    ...added.filter((c) => !onDev.has(flat(c))),
    ...d.cards.filter((c) => !evicted.has(flat(c))),
  ].slice(0, CORNER.postcards);
  return `${head}${cards.join("\n\n")}\n`;
}
