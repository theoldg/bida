// Doc: docs/navigation.md#routing
import type { ReactNode } from "react";
import { Body, Empty, Screen, Scroll, TopBar } from "@/components/chrome";
import { copy } from "@/lib/copy";
import { route } from "@/lib/group-link";
import { WriteBusy } from "./scan-bar";

/**
 * The one frame a first join shows from the link to "Which one are you?".
 * `/join` draws it, then `/g/claim` while its read answers — two routes, one
 * screen, rather than a waiting screen, a skeleton and then the question.
 *
 * The app's name, not "Join a group": this is where a stranger meets bida.
 *
 * A group pulled in pages counts them in the import's bar, docked where
 * "Continue as" lands next.
 */
export function JoiningFrame({ children, className, inert, percent }: {
  children?: ReactNode; className?: string; inert?: boolean; percent?: number;
}) {
  return (
    <Screen className={className} inert={inert}><Body>
      <TopBar title={<span className="brand">{copy.app.name}</span>} back={route.groups()} />
      <Scroll>
        <Empty title={copy.join.joining.title}>{children}</Empty>
      </Scroll>
      {percent === undefined ? null : (
        <div className="pad whodock">
          <WriteBusy percent={percent} label={copy.join.joining.fetching(percent)}
            box="btn-pair pair-p" button="btn btn-lg" />
        </div>
      )}
    </Body></Screen>
  );
}
