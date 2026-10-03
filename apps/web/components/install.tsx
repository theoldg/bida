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

/** Mounted once, in the layout (`keepCarried`, docs/ios.md). */
export function CarryToHomeScreen() {
  return useInstallOffer() === "manual" ? <KeepCarried /> : null;
}

/**
 * Writes the carry first, since the live copy may lag a just-saved key. Same
 * order as `KeepCarried`, or they'd keep rewriting it.
 */
async function carryThenInstall(first?: string): Promise<void> {
  keepCarried(await heldInvites());
  location.assign(route.install(await heldInvites(first)));
}

/**
 * Safari reads the manifest only at load, so a changed carry reloads on the
 * first harmless screen — and not while the shell is still being fetched,
 * where it would race the precache. Once per document: the effect can rerun
 * before a starved page has unloaded.
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

/** They fold, they don't dismiss: an offer stands until it is taken or answered. */
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
 * Drawn into the ledger's skeleton so the rows don't drop when it lands. With
 * no `groupId`, exported HTML draws every candidate hidden, and the mark set
 * before paint picks one (lib/resume-hint.ts).
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

/** An offer, not a warning: Android's tab and installed app share one IndexedDB. */
function NudgeBody() {
  return (
    <>
      <p className="hint" style={{ marginTop: 4 }}>{copy.install.body}</p>
      {/* Not the banner's label: that one navigates to a tutorial. */}
      <button className="btn btn-s" style={{ marginTop: 11 }} onClick={() => void promptInstall()}>
        {copy.act.add}
      </button>
    </>
  );
}

/** `turnOnNotifications` in the tap's own turn: iOS prompts from nowhere else. */
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

/** The iOS tab's warning: this browser will clear its groups (docs/ios.md). */
function BannerBody({ groupId }: { groupId: string }) {
  const browser = useBrowserName();
  return (
    <>
      <p className="hint" style={{ marginTop: 4, textWrap: "balance" }}>{copy.install.banner.body(browser)}</p>
      <InstallButton first={groupId} />
    </>
  );
}

type Due = "notify" | "manual" | "ready";

function useDueOffer(): Due | null {
  const offer = useInstallOffer();
  const push = usePushState();
  if (offer === "installed" && push === "ask") return "notify";
  return offer === "manual" || offer === "ready" ? offer : null;
}

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

/** The fold persists here; the ledger's copy doesn't. */
export function InstallOfferCard({ groupId }: { groupId: string }) {
  const due = useDueOffer();
  const device = useDevice();
  // Drawn before Dexie answers, it would snap shut a frame later on a phone that folded it.
  if (!due || !device) return null;
  const open = !(due === "notify" ? device.notifyNudgeCollapsed : device.installNudgeCollapsed);
  const fold = due === "notify" ? setNotifyNudgeCollapsed : setInstallNudgeCollapsed;
  return <DueOffer due={due} groupId={groupId} open={open} onToggle={() => void fold(open)} />;
}

/**
 * For people who never see the list: launches and joins route around it.
 * Never in the demo, which has no key to carry and re-seeds when cleared.
 */
export function LedgerInstall({ groupId }: { groupId: string }) {
  const due = useDueOffer();
  const [open, setOpen] = useState(false);
  if (isDemo(groupId) || !due) return null;
  return <DueOffer due={due} groupId={groupId} open={open} onToggle={() => setOpen(!open)} />;
}

/** Never a `<Link>`: the router drops the fragment, which is the invites (docs/ios.md#gotchas). */
export function InstallButton({ first }: { first?: string }) {
  return (
    <button type="button" className="btn btn-s" style={{ marginTop: 11 }}
      onClick={() => void carryThenInstall(first)}>
      {copy.install.act}
    </button>
  );
}
