"use client";

import { Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { BadLinkNotice } from "@/components/keyless-link";
import { route } from "@/lib/group-link";

/**
 * A URL that is no route at all.
 *
 * The export writes this to `out/404.html`, which the Worker serves for
 * anything it doesn't have (`not_found_handling` in apps/api/wrangler.toml).
 * In an app whose access model is a pasted link it is reached by the most
 * ordinary accident there is — a chat client wrapping a long invite so half of
 * it arrives — so **it is the app's own sentence, never Next's default**:
 * `BadLinkNotice`, the same one `/join` says, over a bar into the groups list.
 *
 * **Not `BadLink` from chrome.tsx**: that draws the invite-menu picture for a
 * link that named a real group and left out its password.
 */
export default function NotFound() {
  return (
    <Screen>
      <Body>
        <TopBar title=" " back={route.groups()} />
        <Scroll><BadLinkNotice /></Scroll>
      </Body>
    </Screen>
  );
}
