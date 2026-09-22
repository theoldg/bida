"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BadLink, Blank, Body, QueryBoundary, Screen, Scroll, TopBar } from "@/components/chrome";
import { Icon } from "@/components/icons";
import { copy } from "@/lib/copy";
import { usd } from "@/lib/format";
import { route } from "@/lib/group-link";
import { tipShareMinor } from "@/lib/tip";
import { useClaimGate, useGroupData } from "@/lib/hooks";

/**
 * The tip jar: what a scan costs, and the two things you can do about it.
 * `$5 ≈ 10,000 receipt scans` is the argument — a checkable number — and the
 * line under it splits the five dollars four ways.
 *
 * Two buttons in order: donate (somebody else's site), then record it. Nothing
 * writes an entry on its own; the second opens the ordinary form, named and
 * otherwise blank, since only you know what you gave.
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
  // The joke's premise: this group has somebody else to split with.
  const eachLine = data.members.length === 1 ? copy.tip.eachSolo : copy.tip.each;

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

            {/* No hand-placed break: a `<br>` landing mid-wrap on a narrow screen is
                worse than none. */}
            <p className="tipeach">
              {eachLine(usd(each))} {copy.tip.yacht}
            </p>

            <div className="tipacts">
              <a className="btn btn-p btn-lg" href={donate.url}
                target="_blank" rel="noreferrer noopener">
                <Icon name="link" size={16} />{donate.cta}
              </a>
              <Link className="btn btn-s btn-lg"
                href={route.tipEntry(groupId, split.entryTitle)}>
                <Icon name="split" size={16} />{split.cta}
              </Link>
            </div>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}
