"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Blank, Body, Screen, Scroll, TopBar } from "../../components/chrome";
import { useBrowserName, useInstallOffer } from "../../components/install";
import { Icon } from "../../components/icons";
import { claimIdentity, saveGroupKey } from "../../lib/db/commands";
import { getDevice } from "../../lib/db/device";
import { db } from "../../lib/db/dexie";
import { note } from "../../lib/diag";
import { launchedOnto } from "../../lib/launch";
import { syncGroup } from "../../lib/db/sync";
import { copy } from "../../lib/copy";
import { formatJoinLink, parseInvites, route, type CarriedGroup } from "../../lib/group-link";

/**
 * Putting bida on an iOS home screen, and what that does and doesn't bring
 * along (docs/ios.md). One page whoever sends here — the groups list's banner
 * or a join's "Add to home screen" — so back is a plain back to either.
 *
 * Prose in `/about`'s register. There is no button onward: the way forward is
 * out of the browser, so back is the only exit.
 *
 * In a tab it is only a page like any other: every page's manifest already
 * carries the tab's groups (`manifestScript`), and its fragment carries them
 * again for an iOS that bookmarks the URL instead. Launched *as* the icon,
 * this is where they land — `start_url` is always `/install#…`.
 */
export default function InstallPage() {
  // Parsed on the client only — there is no window during the export's
  // build-time prerender. `undefined` is "not read yet".
  const [invites, setInvites] = useState<CarriedGroup[] | undefined>(undefined);
  const offer = useInstallOffer();

  useEffect(() => setInvites(parseInvites(window.location.hash)), []);

  useLaunchedFromHomeScreen(offer === "installed" ? invites : undefined);

  // The tutorial is for a browser tab. In the home-screen app this screen is
  // only ever the doorway above, and it is about to leave.
  if (offer === "installed") return <Blank back={route.groups()} />;

  return <Tutorial />;
}

/**
 * The icon's first launch: the groups the tab held, and who it was in each.
 *
 * A group this phone does not hold yet has its key saved. One the tab had
 * named has that member claimed here too, so nobody is asked "who are you?"
 * again — as a claim of this app's own, since it is a device of its own
 * (history: "Ana started editing from a new device"). Claimed before the group
 * has synced: the claim is an op like any other and goes up with the next push.
 *
 * One group, not named, is the newcomer who tapped Add to home screen before
 * picking a name, and `/join` says it best — it names the group and waits out
 * a first sync. Anything else lands on the list, filling as each group syncs.
 * Nothing new means the fragment is spent: the icon is a door into the app,
 * not into one group forever.
 *
 * And a door is a launch, which is `lib/launch.ts`'s to answer, not this
 * screen's — so it says `launchedOnto` and lets the list decide. The icon's
 * `start_url` is this route, so the document never loads on the list and
 * nothing else could tell: every launch after the first landed on the list with
 * the group you were last in unopened, on the one install docs/ios.md is for.
 * Only when the carry brought nothing, though — an icon that has just saved a
 * key or claimed a name has something to show on the list itself.
 *
 * Nothing here un-forgets: `saveGroupKey` would undo a `forgetGroup`, and an
 * icon must not walk back into a group this phone said it was done with.
 *
 * `location.replace`, not the router, for the hand-off to `/join`: Next's
 * router drops the fragment when it gives up and loads the page itself, which
 * is the very first thing asked of it on a freshly installed app
 * (docs/ios.md#gotchas).
 */
function useLaunchedFromHomeScreen(invites: CarriedGroup[] | undefined): void {
  const router = useRouter();
  useEffect(() => {
    if (!invites) return;
    let cancelled = false;
    void (async () => {
      const [keys, device] = await Promise.all([db().groupKeys.toArray(), getDevice()]);
      const held = new Set(keys.map((key) => key.groupId));
      const left = new Set(device.leftGroups ?? []);
      const fresh = invites.filter((invite) => !held.has(invite.groupId));
      const naming = invites.filter((invite) => invite.me && !left.has(invite.groupId)
        && !(invite.groupId in device.meByGroup));
      if (cancelled) return;
      const newcomer = fresh.length === 1 && !fresh[0]!.me && naming.length === 0;
      note("install.app", `${invites.length} groups, ${invites.filter((i) => i.me).length} named; `
        + `${held.size} keys held, ${fresh.length} fresh, ${naming.length} to claim → `
        + (newcomer ? "join" : fresh.length || naming.length ? "save" : "groups list"));
      if (newcomer) { location.replace(formatJoinLink(fresh[0]!)); return; }
      for (const invite of fresh) await saveGroupKey(invite.groupId, invite.secret);
      for (const invite of naming) await claimIdentity(invite.groupId, invite.me!);
      // Best-effort: `StartSync`'s loop retries every group anyway, and the
      // list fills from the live query as each one lands.
      for (const invite of [...fresh, ...naming]) syncGroup(invite.groupId).catch(() => {});
      if (cancelled) return;
      if (!fresh.length && !naming.length) launchedOnto();
      router.replace(route.groups());
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
              <AlreadyAdded browser={browser} />
            </section>
            <section className="aboutsect">
              {/* A recording of Safari, not numbered steps: the share sheet has
                  moved between iOS versions, and a picture of it settles which
                  button is meant faster than prose can. */}
              <img className="installclip" src="/media/safari-add-to-home-screen.gif"
                width={440} height={956} alt={page.clipAlt} />
            </section>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}

/**
 * For whoever added bida and still meets the banner, so it sits above the
 * recording rather than under it; folded on every visit, since most readers
 * haven't added it yet and the clip is what they came for.
 */
function AlreadyAdded({ browser }: { browser: string | undefined }) {
  const [open, setOpen] = useState(false);
  const { after } = copy.install.page;
  return (
    <div className="installfold">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="chev" size={10} className={`kvchev${open ? " on" : ""}`} />
        {after.ask}
      </button>
      {open ? <p>{after.answer(browser)}</p> : null}
    </div>
  );
}
