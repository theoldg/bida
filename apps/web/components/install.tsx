"use client";

import { DEMO_GROUP_ID, isDemo } from "@bida/core";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { DemoCard } from "./demo";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { heldInvites } from "../lib/db/commands";
import { setInstallNudgeCollapsed, setNotifyNudgeCollapsed } from "../lib/db/device";
import { route } from "../lib/group-link";
import { useDevice } from "../lib/hooks";
import { useLive } from "../lib/db/live";
import { reloadCostsNothing, shellIsWarm } from "../lib/update";
import {
  headIsStale, installOffer, iosBrowser, keepCarried, promptInstall, subscribeInstall,
  type InstallOffer,
} from "../lib/install";
import { pushState, subscribePushState, turnOnNotifications, type PushState } from "../lib/push";
import { resumeHintId, type LedgerBanner } from "../lib/resume-hint";

export function useInstallOffer(): InstallOffer {
  return useSyncExternalStore(subscribeInstall, installOffer, () => "none" as const);
}

function usePushState(): PushState {
  return useSyncExternalStore(subscribePushState, pushState, () => "unsupported" as const);
}

/**
 * In an iOS tab, keeps what a home-screen icon added from *any* page would
 * bring: every group held, and who this phone is in each (`keepCarried`,
 * docs/ios.md). Mounted once, in the layout.
 */
export function CarryToHomeScreen() {
  return useInstallOffer() === "manual" ? <KeepCarried /> : null;
}

/**
 * Off to `/install` with every group in its fragment, `first` leading — after
 * writing the carry the tutorial's head is built from, since the live copy may
 * lag a just-saved key. Same order as `KeepCarried`, or they'd keep rewriting it.
 */
async function carryThenInstall(first?: string): Promise<void> {
  keepCarried(await heldInvites());
  location.assign(route.install(await heldInvites(first)));
}

/**
 * When the carry changes after load, reload on the first harmless screen —
 * Safari reads the manifest only at load, and the share sheet can open on any
 * page (`headIsStale`). Wider than the update's reload (`mayReloadHere`): in
 * an iOS tab a reload is a flash, not a relaunch.
 *
 * **Harmless includes cheap**: not while the shell is still being fetched on a
 * first visit, where it would race the precache. It retries on every pathname
 * change; never reloading beats a blank first minute.
 *
 * **Once per document.** The effect can run again — `groups` re-emitted —
 * before a starved page has unloaded, and a second `replace` is a second
 * document request for the same reload.
 */
let reloading = false;
function KeepCarried() {
  const groups = useLive("carried", () => heldInvites(), []);
  const pathname = usePathname();
  useEffect(() => {
    if (!groups) return;
    keepCarried(groups);
    if (!headIsStale() || !reloadCostsNothing(pathname) || !shellIsWarm()) return;
    const typing = document.activeElement?.matches("input, textarea, [contenteditable]");
    if (typing || document.visibilityState !== "visible" || reloading) return;
    reloading = true;
    location.replace(location.href);
  }, [groups, pathname]);
  return null;
}

const never = () => () => {};

/** The iOS browser's name for copy, or undefined when it can't tell (and in the static export). */
export function useBrowserName(): string | undefined {
  return useSyncExternalStore(never, () => iosBrowser(navigator.userAgent), () => undefined);
}

/**
 * The card every offer is drawn in. **They fold, they don't dismiss** — an
 * install offer stands until the phone installs, the notifications offer
 * until the permission prompt is answered.
 */
function FoldedOffer(
  { title, open, onToggle, children }:
  { title: string; open: boolean; onToggle: () => void; children: ReactNode },
) {
  return (
    <div className="padtop">
      <div className="card">
        <button type="button" className="nudgehead" aria-expanded={open} onClick={onToggle}>
          {title}
          <Icon name="chev" size={11} className={`kvchev${open ? " on" : ""}`} />
        </button>
        {open ? children : null}
      </div>
    </div>
  );
}

const GHOSTS: Exclude<LedgerBanner, undefined>[] = ["demo", "notify", "manual"];

/**
 * The cards atop a ledger that need no database — the demo's mark and the
 * folded install or notifications offer — drawn into its skeleton, so the
 * rows don't drop when the ledger lands. Folded, as `LedgerInstall` always
 * opens.
 *
 * With no `groupId` it is `/` standing in for a launch that reopens a group,
 * whose first paint is exported HTML no script has touched: every candidate
 * is drawn there, hidden, and the mark set before paint picks one
 * (lib/resume-hint.ts, globals.css) until React takes over.
 */
export function SkeletonBanner({ groupId }: { groupId?: string }) {
  // True through the prerender and hydration, which must draw the same HTML.
  const hydrating = useSyncExternalStore(never, () => false, () => true);
  const hinted = useSyncExternalStore(never, resumeHintId, () => undefined);
  const id = groupId ?? hinted;
  if (hydrating) {
    return (
      <>
        {GHOSTS.map((k) => (
          <div key={k} className={`ghost ghost-${k}`} aria-hidden="true">
            {k === "demo" ? <DemoCard groupId={DEMO_GROUP_ID} />
              : <FoldedOffer title={k === "notify" ? copy.notify.offer.title : copy.install.banner.title}
                open={false} onToggle={() => {}}>{null}</FoldedOffer>}
          </div>
        ))}
      </>
    );
  }
  if (!id) return null;
  return <><DemoCard groupId={id} /><LedgerInstall groupId={id} /></>;
}

/**
 * Chrome's own install prompt, one tap. **An offer, not a warning**: Android's
 * tab and installed app share one IndexedDB, so installing buys an icon, no
 * browser bar and a reliable `persist()` — never a group back.
 */
function NudgeBody() {
  return (
    <>
      <p className="hint" style={{ marginTop: 4 }}>{copy.install.body}</p>
      {/* "Add" rather than the banner's "Add bida to home screen": this one
        opens the OS install sheet where it stands, and the banner's navigates
        to a tutorial. Two acts, two labels. */}
      <button className="btn btn-s" style={{ marginTop: 11 }} onClick={() => void promptInstall()}>
        {copy.act.add}
      </button>
    </>
  );
}

/**
 * Once installed, the card offers notifications instead (docs/notifications.md).
 * **The button calls `turnOnNotifications` in the tap's own turn** — iOS shows
 * the permission prompt from nowhere else. It stands until answered: yes turns
 * them on, no can't be asked again, and either way the card goes.
 */
function NotifyBody() {
  const [busy, setBusy] = useState(false);
  const turnOn = () => {
    setBusy(true);
    void turnOnNotifications().finally(() => setBusy(false));
  };
  return (
    <>
      <p className="hint" style={{ marginTop: 4 }}>{copy.notify.offer.body}</p>
      <button className="btn btn-s" style={{ marginTop: 11 }} disabled={busy} onClick={turnOn}>
        {copy.notify.offer.act}
      </button>
    </>
  );
}

/**
 * The iOS tab's warning: this browser will clear its groups, and the home
 * screen is the only exemption (docs/ios.md). Every group rides along to
 * `/install`; `groupId` only goes first.
 */
function BannerBody({ groupId }: { groupId: string }) {
  const browser = useBrowserName();
  return (
    <>
      <p className="hint" style={{ marginTop: 4, textWrap: "balance" }}>{copy.install.banner.body(browser)}</p>
      <InstallButton first={groupId} />
    </>
  );
}

/** Which of the three cards is due, if any: notifications once installed, else the install offer. */
type Due = "notify" | "manual" | "ready";

function useDueOffer(): Due | null {
  const offer = useInstallOffer();
  const push = usePushState();
  if (offer === "installed" && push === "ask") return "notify";
  return offer === "manual" || offer === "ready" ? offer : null;
}

/** The due card, folded or not. Both placements draw it; they differ in where the fold is kept. */
function DueOffer({ due, groupId, open, onToggle }: {
  due: Due; groupId: string; open: boolean; onToggle: () => void;
}) {
  const title = due === "notify" ? copy.notify.offer.title
    : due === "manual" ? copy.install.banner.title : copy.install.title;
  return (
    <FoldedOffer title={title} open={open} onToggle={onToggle}>
      {due === "notify" ? <NotifyBody /> : due === "manual" ? <BannerBody groupId={groupId} /> : <NudgeBody />}
    </FoldedOffer>
  );
}

/**
 * The offer atop the groups list — Chrome's prompt or the iOS warning, never
 * both, and in the installed app the notifications offer. Only once the list
 * holds a group. The fold is the device's and
 * persists; the ledger's copy doesn't — see `LedgerInstall`.
 */
export function InstallOfferCard({ groupId }: { groupId: string }) {
  const due = useDueOffer();
  const device = useDevice();
  // undefined is "Dexie hasn't answered yet", and drawing the card open before
  // it does would snap it shut a frame later on a phone that folded it.
  if (!due || !device) return null;
  const open = !(due === "notify" ? device.notifyNudgeCollapsed : device.installNudgeCollapsed);
  const fold = due === "notify" ? setNotifyNudgeCollapsed : setInstallNudgeCollapsed;
  return <DueOffer due={due} groupId={groupId} open={open} onToggle={() => void fold(open)} />;
}

/**
 * The same card atop a group's ledger, for people who never linger on the
 * list — nearly everyone, since launches and joins route around it
 * (`lib/launch.ts`). Folded on every visit, remembering nothing; once
 * installed, the notifications offer instead.
 *
 * **Never in the demo.** No key to carry, nothing lost when cleared (`/demo`
 * re-seeds, docs/sync.md#the-demo-group-has-no-key), and the mark above says
 * nothing here syncs.
 */
export function LedgerInstall({ groupId }: { groupId: string }) {
  const due = useDueOffer();
  const [open, setOpen] = useState(false);
  if (isDemo(groupId) || !due) return null;
  return <DueOffer due={due} groupId={groupId} open={open} onToggle={() => setOpen(!open)} />;
}

/**
 * The banner's button alone, for the about screen's "Works offline" in an iOS
 * tab. `first` leads the carry.
 *
 * **`location.assign`, never a `<Link>`**: the fragment is the invites, and
 * the router drops it when it falls back to a page load (docs/ios.md#gotchas).
 */
export function InstallButton({ first }: { first?: string }) {
  return (
    <button type="button" className="btn btn-s" style={{ marginTop: 11 }}
      onClick={() => void carryThenInstall(first)}>
      {copy.install.act}
    </button>
  );
}
