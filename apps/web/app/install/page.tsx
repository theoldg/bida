"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { FirstFrames, ListSkeleton } from "@/components/home-frame";
import { useBrowserName, useInstallOffer } from "@/components/install";
import { Icon } from "@/components/icons";
import { claimIdentity, saveGroupKey } from "@/lib/db/commands";
import { getDevice } from "@/lib/db/device";
import { db } from "@/lib/db/dexie";
import { keepNote } from "@/lib/diag";
import { firstFrameMarked, markLaunched } from "@/lib/first-frame";
import { launchPlan, launchedOnto } from "@/lib/launch";
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
  const hydrating = useSyncExternalStore(never, () => false, () => true);
  const marked = useSyncExternalStore(never, firstFrameMarked, () => false);

  // The export can't tell a tab from an icon launch, and iOS paints it before
  // any script here runs: so it carries the launch's frames too, and the mark
  // set before paint picks (lib/first-frame.ts). The tutorial is the route's own.
  if (hydrating) return <><FirstFrames /><Tutorial /></>;
  // In the home-screen app this screen is only the doorway above, about to
  // leave: it wears the frame the launch is heading for. Unmarked — a reload
  // here — that is the list, where it goes.
  if (offer === "installed") return marked ? <FirstFrames /> : <ListSkeleton />;
  return <Tutorial />;
}

const never = () => () => {};

/**
 * An icon launch: the groups the tab held, and who it was in each, carried out
 * as `launchPlan` (lib/launch.ts) says. A member the tab had named is claimed
 * before sync — the icon is a device of its own — since the claim is an op
 * riding the next push.
 *
 * A spent fragment is still a launch, and **`lib/launch.ts` answers it, not
 * this screen** — set `launchedOnto` and let the list decide.
 *
 * **Nothing here un-forgets**: `saveGroupKey` would undo a `forgetGroup`, and
 * a forgotten group's key is erased, so `leftGroups` is what says no.
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
      const plan = launchPlan(invites, held, new Set(device.leftGroups ?? []), device.meByGroup);
      if (cancelled) return;
      keepNote("install.app", `${invites.length} groups, ${invites.filter((i) => i.me).length} named; `
        + `${held.size} keys held → ${plan.kind === "save"
          ? `save ${plan.fresh.length} fresh, claim ${plan.naming.length}` : plan.kind}`);
      // Before leaving, whichever way: no later launch of this icon is a first join.
      markLaunched();
      if (plan.kind === "join") { location.replace(formatJoinLink(plan.invite)); return; }
      if (plan.kind === "save") {
        for (const invite of plan.fresh) await saveGroupKey(invite.groupId, invite.secret);
        for (const invite of plan.naming) await claimIdentity(invite.groupId, invite.me!);
        // Best-effort: `StartSync`'s loop retries every group anyway, and the
        // list fills from the live query as each one lands.
        for (const invite of [...plan.fresh, ...plan.naming]) syncGroup(invite.groupId).catch(() => {});
      }
      if (cancelled) return;
      if (plan.kind === "list") launchedOnto();
      router.replace(route.groups());
    })();
    return () => { cancelled = true; };
  }, [invites, router]);
}

function Tutorial() {
  const browser = useBrowserName();
  const { page } = copy.install;

  return (
    <Screen className="ownframe">
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
