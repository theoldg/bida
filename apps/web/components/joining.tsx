import type { ReactNode } from "react";
import { Body, Empty, Screen, Scroll, TopBar } from "@/components/chrome";
import { copy } from "@/lib/copy";
import { route } from "@/lib/group-link";

/**
 * The one frame a first join shows from the link to "Which one are you?".
 * `/join` draws it, then the groups list while it pushes the group, then
 * `/g/claim` while its read answers — three routes, one screen, rather than a
 * waiting screen, the list's skeletons, the ledger's and then the question.
 *
 * The app's name, not "Join a group": this is where a stranger meets bida.
 */
export function JoiningFrame({ children }: { children?: ReactNode }) {
  return (
    <Screen><Body>
      <TopBar title={<span className="brand">{copy.app.name}</span>} back={route.groups()} />
      <Scroll>
        <Empty title={copy.join.joining.title}>{children}</Empty>
      </Scroll>
    </Body></Screen>
  );
}
