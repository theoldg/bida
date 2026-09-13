import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { drawnShares } from "../lib/scan/diagram";

/**
 * The one picture the app draws: a bill, and what a scan turns it into.
 *
 * A scan's result lands on another screen, so both screens that start one with
 * nothing saved yet — `/g/scan` and `/quick` — have to promise something they
 * can't show. They draw it instead. Shared rather than copied because the two
 * halves have to keep adding up (`lib/scan/diagram.ts`), and one drawing can
 * only drift from itself once.
 *
 * `names` are whoever the drawn bill is divided between — a group's members,
 * or a quick split's people — and `seed` fixes the choice, so one group or one
 * split sees the same faces every time it comes back. Fewer than three borrows
 * stand-ins from `copy.scan.diagram.people`.
 */
export function ScanDiagram({ names, seed }: { names: readonly string[]; seed: string }) {
  return (
    <div className="scandiagram" role="img" aria-label={copy.scan.diagram.alt}>
      {/* The bill: printed lines, a rule, the total under it. They add
          up to the number the form comes back with — `copy.test.ts`
          keeps it that way. */}
      <div className="scanpaper">
        {copy.scan.diagram.lines.map(([label, price]) => (
          <span key={label}><i>{label}</i><i>{price}</i></span>
        ))}
        <hr />
        <span className="tot"><i>{copy.scan.diagram.total}</i><i>{copy.scan.diagram.amount}</i></span>
      </div>
      <Icon name="arrow" size={14} className="scanarrow" />
      {/* The same bill as an expense, split by the receipt: the three
          fields a scan fills, and under them what it came to for three
          of the people splitting it. The shares are summed from the lines
          on the left (`lib/scan/diagram.ts`), so the two halves of the
          picture can't drift apart. */}
      <div className="scanform">
        <span className="head">
          <i className="t">{copy.scan.diagram.title}</i>
          <i className="d">{copy.scan.diagram.date}</i>
        </span>
        <span className="a bignum">{copy.scan.diagram.amount}</span>
        <hr />
        {drawnShares(names, seed).map((share) => (
          <span key={share.name}>
            <i className="who">{share.name}</i><i>{share.amount}</i>
          </span>
        ))}
      </div>
    </div>
  );
}
