"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BadLink, Blank, Body, QueryBoundary, Screen, Scroll, TopBar } from "@/components/chrome";
import { Icon } from "@/components/icons";
import { TipJar } from "@/components/tip-jar";
import { copy } from "@/lib/copy";
import { usd } from "@/lib/format";
import { route } from "@/lib/group-link";
import { tipShareMinor } from "@/lib/tip";
import { useClaimGate, useGroupData } from "@/lib/hooks";

/**
 * The tip jar with a group behind it (`components/tip-jar.tsx`): the line
 * under the figure splits the donation by the group's own size.
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
  const { split } = copy.tip;

  if (!groupId) return <BadLink />;
  if (!data.loading && !data.group) return <BadLink />;
  if (unclaimed || !data.group) {
    return <Blank title={copy.tip.title} back={route.balances(groupId)} />;
  }

  const each = tipShareMinor(data.members.map((m) => m.id));
  // The joke's premise: this group has somebody else to split with.
  const eachLine = data.members.length === 1 ? copy.tip.eachSolo : copy.tip.each;

  return (
    <Screen>
      <Body>
        <TopBar title={copy.tip.title} sub={data.group.name}
          back={route.balances(groupId)} />
        <Scroll>
          <TipJar each={
            // No hand-placed break: a `<br>` landing mid-wrap on a narrow screen is
            // worse than none.
            `${eachLine(usd(each))} ${copy.tip.yacht}`
          }>
            <Link className="btn btn-s btn-lg"
              href={route.tipEntry(groupId, split.entryTitle)}>
              <Icon name="split" size={16} />{split.cta}
            </Link>
          </TipJar>
        </Scroll>
      </Body>
    </Screen>
  );
}
