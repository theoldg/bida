"use client";
// Doc: docs/navigation.md#routing

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { BadLinkNotice } from "@/components/keyless-link";
import { unmangledLink } from "@/lib/failed-link";
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
 *
 * A link whose `#` arrived as `%23` is no route either, and is replaced by
 * the link it was (`unmangledLink`) — by the router, in this document, never
 * `location.replace`: Android Messenger's webview loads a page a script sent
 * it to without WebCrypto, so the split it opened could not unseal.
 */
export default function NotFound() {
  const router = useRouter();
  useEffect(() => {
    const link = unmangledLink(window.location.pathname);
    if (link) router.replace(link);
  }, [router]);
  return (
    <Screen>
      <Body>
        <TopBar title=" " back={route.groups()} />
        <Scroll><BadLinkNotice /></Scroll>
      </Body>
    </Screen>
  );
}
