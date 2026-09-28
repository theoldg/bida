import type { ReactNode } from "react";
import { Icon } from "./icons";
import { copy } from "../lib/copy";

/**
 * The tip jar's page body, `/tip`'s and `/g/tip`'s: what a scan costs, the
 * figure that argues it, and the donate button. `each` is the line under the
 * figure; `children` are the acts after donating — the group's "add as an
 * expense", which means nothing without a group to split into.
 */
export function TipJar({ each, children }: { each: ReactNode; children?: ReactNode }) {
  const { rate, donate } = copy.tip;
  return (
    <div className="pad tip">
      <p className="tiplede">{copy.tip.lede}</p>

      {/* Above the figure, not below it: it is what the figure is an
          answer to, and read afterwards it would be a footnote. */}
      <p className="tipwhy">{copy.tip.why}</p>

      {/* The figure, set in the monospace numeral the ledger uses for
          every other amount, because it is the same kind of claim. */}
      <div className="tiprate">{rate}</div>

      <p className="tipeach">{each}</p>

      <div className="tipacts">
        <a className="btn btn-p btn-lg" href={donate.url}
          target="_blank" rel="noreferrer noopener">
          <Icon name="link" size={16} />{donate.cta}
        </a>
        {children}
      </div>
    </div>
  );
}
