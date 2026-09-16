"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Blank, Body, Screen, Scroll, TopBar } from "../../components/chrome";
import { useBrowserName, useInstallOffer } from "../../components/install";
import { saveGroupKey } from "../../lib/db/commands";
import { db } from "../../lib/db/dexie";
import { syncGroup } from "../../lib/db/sync";
import { copy } from "../../lib/copy";
import { formatJoinLink, parseInvites, route, type JoinLink } from "../../lib/group-link";
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
 * two things besides read. Arriving with invites in its fragment — every group
 * the tab holds, the one being joined first — it points the home-screen icon
 * at them (`offerInviteToHomeScreen`), so the installed app's first launch is
 * those groups rather than an empty list and a paste each. And launched *as*
 * that icon, it is the other end of the same trick: whichever URL iOS kept,
 * this screen hands the invites on.
 */
export default function InstallPage() {
  // Parsed on the client only — there is no window during the export's
  // build-time prerender. `undefined` is "not read yet".
  const [invites, setInvites] = useState<JoinLink[] | undefined>(undefined);
  const offer = useInstallOffer();

  useEffect(() => setInvites(parseInvites(window.location.hash)), []);

  useLaunchedFromHomeScreen(offer === "installed" ? invites : undefined);

  useEffect(() => {
    if (!invites?.length || offer !== "manual") return;
    return offerInviteToHomeScreen(invites);
  }, [invites, offer]);

  // The tutorial is for a browser tab. In the home-screen app this screen is
  // only ever the doorway above, and it is about to leave.
  if (offer === "installed") return <Blank back={route.groups()} />;

  return <Tutorial />;
}

/**
 * The icon's first launch, when iOS kept `/install#<id>.<secret>…` as the page
 * to open (the fallback half of `offerInviteToHomeScreen`).
 *
 * Only the invites this phone does not already hold are acted on. One is the
 * newcomer's case, and `/join` says it best — it names the group and waits out
 * a first sync that hasn't landed. Several is the regular's: the keys go in
 * here and the list fills as each group arrives, because there is no one group
 * to open. None left means the fragment is spent — the app starts where the app
 * starts, rather than the icon being one group's door forever.
 *
 * Held, not un-forgotten: `saveGroupKey` would undo a `forgetGroup`, and an
 * icon must not walk back into a group this phone said it was done with.
 *
 * `location.replace`, not the router, for the hand-off to `/join`: Next's
 * router drops the fragment when it gives up and loads the page itself, which
 * is the very first thing asked of it on a freshly installed app
 * (docs/ios.md#gotchas).
 */
function useLaunchedFromHomeScreen(invites: JoinLink[] | undefined): void {
  const router = useRouter();
  useEffect(() => {
    if (!invites) return;
    let cancelled = false;
    void (async () => {
      const held = new Set((await db().groupKeys.toArray()).map((key) => key.groupId));
      const fresh = invites.filter((invite) => !held.has(invite.groupId));
      if (cancelled) return;
      if (fresh.length === 1) { location.replace(formatJoinLink(fresh[0]!)); return; }
      for (const invite of fresh) {
        await saveGroupKey(invite.groupId, invite.secret);
        // Best-effort: `StartSync`'s loop retries every group anyway, and the
        // list fills from the live query as each one lands.
        syncGroup(invite.groupId).catch(() => {});
      }
      if (!cancelled) router.replace(route.groups());
    })();
    return () => { cancelled = true; };
  }, [invites, router]);
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
