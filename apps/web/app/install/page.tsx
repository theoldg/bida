"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Blank, Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { useBrowserName, useInstallOffer } from "@/components/install";
import { Icon } from "@/components/icons";
import { claimIdentity, saveGroupKey } from "@/lib/db/commands";
import { getDevice } from "@/lib/db/device";
import { db } from "@/lib/db/dexie";
import { note } from "@/lib/diag";
import { launchedOnto } from "@/lib/launch";
import { syncGroup } from "@/lib/db/sync";
import { copy } from "@/lib/copy";
import { formatJoinLink, parseInvites, route, type CarriedGroup } from "@/lib/group-link";

/**
 * Putting bida on an iOS home screen, and what that does and doesn't bring
 * along (docs/ios.md). One page for every sender, so back is a plain back. No
 * button onward: the way forward is out of the browser.
 *
 * In a tab it is an ordinary page: every page's manifest carries the tab's
 * groups (`manifestScript`), and the fragment carries them again for an iOS
 * that bookmarks the URL instead. Launched *as* the icon, this is where they
 * land — `start_url` is always `/install#…`.
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
 * Keys are saved for groups this phone doesn't hold. A member the tab had
 * named is claimed here too — the icon is a device of its own — before sync,
 * since the claim is an op riding the next push.
 *
 * One unnamed group is a newcomer who added the icon before picking a name,
 * so it goes to `/join`. Anything else lands on the list.
 *
 * A spent fragment is still a launch, and **`lib/launch.ts` answers it, not
 * this screen** — set `launchedOnto` and let the list decide.
 *
 * **Nothing here un-forgets**: `saveGroupKey` would undo a `forgetGroup`.
 *
 * **`location.replace`, not the router**, for the hand-off to `/join`: Next's
 * router drops the fragment when it falls back to a full load
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
              {/* Steps in words first, then the recording: the clip settles which
                  button is meant (the share sheet moves between iOS versions), but is
                  silent to a screen reader. */}
              <ol className="installsteps">
                {page.steps.map((step) => (
                  <li key={step.text}>
                    <Icon name={step.icon} size={15} className="stepicon" />
                    <span>{step.text}</span>
                  </li>
                ))}
              </ol>
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
 * For whoever added bida and still sees the banner; above the recording, and
 * folded, since most readers haven't added it yet.
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
