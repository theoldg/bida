"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BadLink, Blank, Body, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { Icon } from "../../../components/icons";
import { copy } from "../../../lib/copy";
import { money } from "../../../lib/format";
import { route } from "../../../lib/group-link";
import { tipShareMinor } from "../../../lib/tip";
import { useClaimGate, useGroupData } from "../../../lib/hooks";

/**
 * The tip jar: what a scan costs, and the two things you can do about it.
 *
 * A line, a figure, and what the figure comes to here. `$5 ≈ 10,000 receipt
 * scans` *is* the argument — a number a reader can check beats a plea they
 * cannot — and the line under it does the thing this app is for: five dollars
 * split four ways is a number nobody has to feel about.
 *
 * Two buttons, in the order things happen. Donating is somebody else's site;
 * recording it is what you do afterwards, which is why nothing here writes an
 * entry on its own — the second button opens the ordinary form, named and
 * otherwise blank, because how much you gave is a thing only you know.
 */
export default function TipPage() {
  return <QueryBoundary><TipScreen /></QueryBoundary>;
}

function TipScreen() {
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const unclaimed = useClaimGate(groupId, data);
  const { rate, donate, split } = copy.tip;

  if (!groupId) return <BadLink />;
  if (!data.loading && !data.group) return <BadLink />;
  if (unclaimed || !data.group) {
    return <Blank title={copy.tip.title} back={route.group(groupId, "balances")} />;
  }

  const each = tipShareMinor(data.members.map((m) => m.id));

  return (
    <Screen>
      <Body>
        <TopBar title={copy.tip.title} sub={data.group.name}
          back={route.group(groupId, "balances")} />
        <Scroll>
          <div className="pad tip">
            <p className="tiplede">{copy.tip.lede}</p>

            {/* Above the figure, not below it: it is what the figure is an
                answer to, and read afterwards it would be a footnote. */}
            <p className="tipwhy">{copy.tip.why}</p>

            {/* The figure, set in the monospace numeral the ledger uses for
                every other amount, because it is the same kind of claim. */}
            <div className="tiprate">{rate}</div>

            {/* One paragraph and no hand-placed break: the joke is the same
                aside as the line before it, and a `<br>` that lands mid-wrap
                on a narrow screen is worse than no break at all. */}
            <p className="tipeach">
              {copy.tip.each(money(each, "USD"))} {copy.tip.yacht}
            </p>

            <div className="tipacts">
              <a className="btn btn-p btn-lg" href={donate.url}
                target="_blank" rel="noreferrer noopener">
                <Icon name="link" size={16} />{donate.cta}
              </a>
              <Link className="btn btn-s btn-lg"
                href={route.tipEntry(groupId, split.entryTitle)}>
                <Icon name="split" size={16} />{split.cta(data.group.name)}
              </Link>
            </div>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}
