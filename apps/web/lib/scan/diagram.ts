import { minorToDecimalString, parseMinor, sumMinor, type CurrencyCode } from "@bida/core";
import { copy } from "../copy";

/**
 * The bill drawn on `/g/scan`, split the way a scan leaves one.
 *
 * The right-hand card in that drawing is a expense summary split by receipt,
 * so it has to hold real arithmetic even though nobody will ever save it: the
 * screen's whole claim is that a photograph turns into *that*, and a picture
 * whose shares don't add to its own total is the one thing this screen can't
 * be caught showing. So the shares are summed here from the same lines the
 * left-hand card prints, rather than typed into `copy.ts` beside them.
 */

/** The drawing shows no symbol, so the currency decides only the decimals: two. */
const SHOWN: CurrencyCode = "EUR";

/** One person's row on the drawn expense. */
interface DrawnShare { name: string; amount: string }

/**
 * Who the drawing splits its bill between: three of this group's members,
 * padded from `copy.scan.diagram.people` where a group holds fewer.
 *
 * The three are picked by the group's id rather than taken off the front of
 * the list — two groups shouldn't open the same screen and see the same two
 * names — but by the id and nothing else, so one group sees the same picture
 * every time it comes back. A member who is one of the stand-ins by name is
 * still only listed once.
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
 * The drawn bill's lines shared out: one line each, and whatever is left over
 * to the last of them — which is how a real bill lands when one person had
 * two of the dishes. The shares add to `copy.scan.diagram.amount`, and
 * `diagram.test.ts` is what keeps that true.
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
