"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Blank, Body, Screen, Scroll, TopBar } from "../../components/chrome";
import { useBrowserName, useInstallOffer } from "../../components/install";
import { db } from "../../lib/db/dexie";
import { copy } from "../../lib/copy";
import { formatJoinLink, parseJoinLink, route, type JoinLink } from "../../lib/group-link";
import { offerInviteToHomeScreen } from "../../lib/install";

/**
 * Putting bida on an iOS home screen, and what that does and doesn't bring
 * along (docs/ios.md). One page whoever sends here — the groups list's banner
 * or a join's "Add to home screen" — so back is a plain back to either.
 *
 * Prose in `/about`'s register. There is no button onward: the way forward is
 * out of the browser, so back is the only exit.
 *
 * It is also the page the share sheet is opened *from*, which is why it does
 * two things besides read. Arriving with an invite in its fragment, it points
 * the home-screen icon at that invite (`offerInviteToHomeScreen`), so the
 * installed app's first launch is the join rather than an empty list and a
 * paste. And launched *as* that icon, it is the other end of the same trick:
 * whichever URL iOS kept, this screen hands the invite on.
 */
export default function InstallPage() {
  // Parsed on the client only — there is no window during the export's
  // build-time prerender. `undefined` is "not read yet".
  const [link, setLink] = useState<JoinLink | null | undefined>(undefined);
  const offer = useInstallOffer();

  useEffect(() => setLink(parseJoinLink(window.location.hash)), []);

  useLaunchedFromHomeScreen(offer === "installed" ? link : undefined);

  useEffect(() => {
    if (!link || offer !== "manual") return;
    return offerInviteToHomeScreen(link);
  }, [link, offer]);

  // The tutorial is for a browser tab. In the home-screen app this screen is
  // only ever the doorway above, and it is about to leave.
  if (offer === "installed") return <Blank back={route.groups()} />;

  return <Tutorial />;
}

/**
 * The icon's first launch, when iOS kept `/install#<id>.<secret>` as the page
 * to open (the fallback half of `offerInviteToHomeScreen`).
 *
 * A fragment whose group this phone already holds has done its work — the app
 * starts where the app starts, rather than the icon being permanently one
 * group's door. An unheld one is the join the tab left unfinished.
 *
 * `location.replace`, not the router: Next's router drops the fragment when it
 * gives up and loads the page itself, which is the very first thing asked of
 * it on a freshly installed app (docs/ios.md#gotchas).
 */
function useLaunchedFromHomeScreen(link: JoinLink | null | undefined): void {
  const router = useRouter();
  useEffect(() => {
    if (link === undefined) return;
    let cancelled = false;
    void (async () => {
      const held = link ? await db().groupKeys.get(link.groupId) : undefined;
      if (cancelled) return;
      if (link && !held) location.replace(formatJoinLink(link));
      else router.replace(route.groups());
    })();
    return () => { cancelled = true; };
  }, [link, router]);
}

function Tutorial() {
  const browser = useBrowserName();
  const { page } = copy.install;

  return (
    <Screen>
      <Body>
        <TopBar title={page.title} back />
        <Scroll>
          <div className="pad about">
            <section className="aboutsect">
              <p>{page.why(browser)}</p>
              <p>{page.keep} <strong>{page.keepBold}</strong></p>
            </section>
            <section className="aboutsect">
              {/* A recording of Safari, not numbered steps: the share sheet has
                  moved between iOS versions, and a picture of it settles which
                  button is meant faster than prose can. */}
              <img className="installclip" src="/media/safari-add-to-home-screen.gif"
                width={440} height={956} alt={page.clipAlt} />
            </section>
            <section className="aboutsect center">
              <h4>{page.empty.title}</h4>
              <p>{page.empty.body(browser)}</p>
            </section>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}
