import { Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { Icon } from "@/components/icons";
import { copy } from "@/lib/copy";
import { route } from "@/lib/group-link";

/**
 * The tip jar with no group at all — reached from `/about`'s guarantees
 * section. `/g/tip` is this screen's other half, for the "split it with the
 * group" case; this one drops the per-member share and the "add as an
 * expense" button, since neither means anything without a group to split
 * into.
 */
export default function StandaloneTipPage() {
  const { rate, donate } = copy.tip;
  return (
    <Screen>
      <Body>
        <TopBar title={copy.tip.title} back={route.about()} />
        <Scroll>
          <div className="pad tip">
            <p className="tiplede">{copy.tip.lede}</p>

            {/* Above the figure, not below it: it is what the figure is an
                answer to, and read afterwards it would be a footnote. */}
            <p className="tipwhy">{copy.tip.why}</p>

            {/* The figure, set in the monospace numeral the ledger uses for
                every other amount, because it is the same kind of claim. */}
            <div className="tiprate">{rate}</div>

            <p className="tipeach">{copy.tip.yacht}</p>

            <div className="tipacts">
              <a className="btn btn-p btn-lg" href={donate.url}
                target="_blank" rel="noreferrer noopener">
                <Icon name="link" size={16} />{donate.cta}
              </a>
            </div>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}
