"use client";

import Link from "next/link";
import { useSyncExternalStore, type HTMLAttributes, type ReactNode } from "react";
import { Body, LedgerSkeleton, Screen, Scroll, SkeletonRows, TopBar } from "./chrome";
import { HomeMenu } from "./home-menu";
import { Icon } from "./icons";
import { SkeletonBanner } from "./install";
import { usePasteLink } from "./paste-link";
import { copy } from "@/lib/copy";
import { route } from "@/lib/group-link";
import { iosHomeScreenApp } from "@/lib/install";

/**
 * The groups list's frame: the name, the menu, the scroller and the start
 * tiles. One component, so the frame `/install` draws while an icon launch
 * hands over is the list's own, not a copy that can drift from it.
 */
export function HomeFrame({ brand, children }: {
  /** On the name — the list's long press into /diag. */
  brand?: HTMLAttributes<HTMLSpanElement>;
  children: ReactNode;
}) {
  return (
    <Screen className="homeframe">
      <Body>
        <TopBar title={<span className="brand" {...brand}>{copy.app.name}</span>} right={<HomeMenu />} />
        <Scroll>{children}</Scroll>
        {/* Beside the scroller, so its rubber-band never carries the tiles. */}
        <StartTiles />
      </Body>
    </Screen>
  );
}

/**
 * What a launch is about to show, before anything has read the database: the
 * reopened group's skeleton under `data-resuming`, the list's otherwise.
 * Both are drawn and globals.css picks, since the mark is set before React
 * runs (lib/resume-hint.ts) — the frames `/` draws while it hydrates.
 */
export function LaunchFrames() {
  return (
    <>
      <LedgerSkeleton className="resumeframe" head={<SkeletonBanner />} />
      <HomeFrame><SkeletonRows count={4} /></HomeFrame>
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
