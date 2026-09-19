"use client";

import { Body, Screen, Scroll, TopBar } from "../components/chrome";
import { BadLinkNotice } from "../components/keyless-link";
import { route } from "../lib/group-link";

/**
 * A URL that is no route at all.
 *
 * The export writes this to `out/404.html`, which is what the Worker serves
 * for anything it doesn't have (`not_found_handling` in apps/api/wrangler.toml)
 * — until now Next's own: "404. This page could not be found.", in the system
 * font, on a white page, with no way back into the app. In an app whose whole
 * access model is a link somebody pastes, that page is reachable by the most
 * ordinary accident there is — a chat client wrapping a long invite so that
 * half of it arrives — so it is the app's own sentence about a link that opens
 * nothing (`BadLinkNotice`, the same one `/join` says) over a bar that leads
 * to the groups list.
 *
 * It is not `BadLink` from chrome.tsx: that draws the invite-menu picture for
 * a link that named a real group and left out its password, and a path that
 * is no route was never that.
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
