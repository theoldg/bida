"use client";

import Link from "next/link";
import { useSyncExternalStore, type HTMLAttributes, type ReactNode } from "react";
import { Body, LedgerSkeleton, Screen, Scroll, SkeletonRows, TopBar } from "./chrome";
import { HomeMenu } from "./home-menu";
import { Icon } from "./icons";
import { SkeletonBanner } from "./install";
import { JoiningFrame } from "./joining";
import { usePasteLink } from "./paste-link";
import { copy } from "@/lib/copy";
import { route } from "@/lib/group-link";
import { iosHomeScreenApp } from "@/lib/install";

/**
 * The groups list's frame: the name, the menu, the scroller and the start
 * tiles. One component, so the list's skeleton a launch stands up
 * (`FirstFrames`) is the list's own frame, not a copy that can drift from it.
 */
export function HomeFrame({ brand, className, inert, children }: {
  /** On the name — the list's long press into /diag. */
  brand?: HTMLAttributes<HTMLSpanElement>;
  className?: string;
  inert?: boolean;
  children: ReactNode;
}) {
  return (
    <Screen className={className} inert={inert}>
      <Body>
        <TopBar title={<span className="brand" {...brand}>{copy.app.name}</span>} right={<HomeMenu />} />
        <Scroll>{children}</Scroll>
        {/* Beside the scroller, so its rubber-band never carries the tiles. */}
        <StartTiles />
      </Body>
    </Screen>
  );
}

/** The list before Dexie answers, standing in for it: nothing in it is pressable. */
export function ListSkeleton({ className }: { className?: string }) {
  return <HomeFrame className={className} inert><SkeletonRows count={4} /></HomeFrame>;
}

/**
 * Every frame a launch can be heading for (`FirstFrame`, lib/first-frame.ts),
 * drawn hidden for globals.css to show the one `<html data-frame>` names —
 * the mark is set before React runs, and the export can't know it. **Inert**:
 * a tap on a skeleton would race the decision it stands in for.
 *
 * Drawn only while that decision is pending — hidden is not gone, and each
 * frame's back arrow registers with the back button.
 */
export function FirstFrames() {
  return (
    <>
      <LedgerSkeleton className="firstframe firstframe-ledger" inert head={<SkeletonBanner />} />
      <ListSkeleton className="firstframe firstframe-list" />
      <JoiningFrame className="firstframe firstframe-join" inert />
    </>
  );
}

/** "Quick split" writes nothing (ADR-0035), so it is outlined; "New group" is under the thumb. */
function StartTiles() {
  return (
    <div className="homepair">
      <div className="starttiles">
        <PasteLinkTile />
        <Link href={route.quick()} className="starttile start-s">
          <Icon name="cam" size={26} />
          {copy.groups.quickSplit}
        </Link>
        <Link href={route.newGroup()} className="starttile start-p">
          <Icon name="plus" size={28} />
          {copy.groups.newGroup}
        </Link>
      </div>
    </div>
  );
}

const never = () => () => {};

/** A tapped invite never reaches an iOS home-screen app; elsewhere this draws nothing. */
function PasteLinkTile() {
  const shown = useSyncExternalStore(never, iosHomeScreenApp, () => false);
  const { paste, dialog } = usePasteLink();
  if (!shown) return null;

  return (
    <>
      <button type="button" onClick={() => void paste()} className="starttile start-s">
        <Icon name="link" size={26} />
        {copy.groups.pasteLink}
      </button>
      {dialog}
    </>
  );
}
