import { minorToDecimalString, parseMinor, sumMinor, type CurrencyCode } from "@bida/core";
import { copy } from "../copy";

/**
 * The bill drawn on `/g/scan`, split the way a scan leaves one.
 *
 * The right-hand card must hold real arithmetic even though nobody saves it:
 * a picture whose shares don't add to its own total is the one thing this
 * screen can't show. So the shares are summed from the lines the left card
 * prints, not typed into `copy.ts`.
 */

/** The drawing shows no symbol, so the currency decides only the decimals: two. */
const SHOWN: CurrencyCode = "EUR";

/** One person's row on the drawn expense. */
interface DrawnShare { name: string; amount: string }

/**
 * Three of this group's members to split the drawing between, padded from
 * `copy.scan.diagram.people` where there are fewer. Picked by the group's id,
 * so different groups see different names and one group always the same. A
 * member sharing a stand-in's name is listed once.
 */
export function drawnNames(members: readonly string[], seed: string): string[] {
  const named = members.filter((n) => n.trim().length > 0);
  const start = named.length > 0 ? hash(seed) % named.length : 0;
  const picked: string[] = [];
  for (const name of [...named.slice(start), ...named.slice(0, start), ...copy.scan.diagram.people]) {
    if (picked.length === 3) break;
    if (!picked.includes(name)) picked.push(name);
  }
  return picked;
}

/**
 * The drawn lines shared out: one each, and the remainder to the last. The
 * shares add to `copy.scan.diagram.amount`; `diagram.test.ts` keeps it true.
 */
export function drawnShares(members: readonly string[], seed: string): DrawnShare[] {
  const names = drawnNames(members, seed);
  const prices = copy.scan.diagram.lines.map(([, price]) => parseMinor(price, SHOWN));
  return names.map((name, i) => ({
    name,
    amount: minorToDecimalString(
      sumMinor(prices.filter((_, line) => Math.min(line, names.length - 1) === i)), SHOWN,
    ),
  }));
}

/** Whatever spreads the ids we have — group ids are random strings already. */
function hash(seed: string): number {
  let h = 7;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
