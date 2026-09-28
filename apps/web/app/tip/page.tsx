import { Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { TipJar } from "@/components/tip-jar";
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
  return (
    <Screen>
      <Body>
        <TopBar title={copy.tip.title} back={route.about()} />
        <Scroll>
          <TipJar each={copy.tip.yacht} />
        </Scroll>
      </Body>
    </Screen>
  );
}
