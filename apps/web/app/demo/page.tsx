"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Body, Screen, Scroll, SkeletonRows, TopBar } from "@/components/chrome";
import { copy } from "@/lib/copy";
import { openDemo } from "@/lib/db/commands";
import { route } from "@/lib/group-link";
import { handOverToGroup } from "@/lib/launch";

/**
 * `bida.bid/demo` — the whole door into the demo group. Creates it, or reopens
 * the one already on the phone, and goes into its ledger; idempotent, the id
 * being a constant, so arriving twice reopens one group rather than stacking
 * copies.
 *
 * **Nothing in the app links here** — not the empty groups list, not a start
 * tile, not `/about`, not the README. The demo is a group somebody sends you
 * to; a door inside the app would make it a feature of the app.
 *
 * A screen, not a router redirect, because opening it is a write: this waits on
 * Dexie and the skeleton is what the wait looks like. It moves on by way of
 * the groups list, as `/join` does (`handOverToGroup`): this entry becomes the
 * list and the ledger is pushed on top, so back out of the ledger lands on the
 * list — not on the seed again, nor out to wherever the link was tapped.
 */
export default function DemoPage() {
  const router = useRouter();
  // React runs an effect twice in development, and the second run would race
  // the first's write. The flag is the cheapest thing that cannot.
  const opening = useRef(false);

  useEffect(() => {
    if (opening.current) return;
    opening.current = true;
    void openDemo().then(
      (groupId) => { handOverToGroup(groupId); router.replace(route.groups()); },
      // A demo that cannot be written is a browser with no usable storage,
      // which the groups list already knows how to say. Nothing here can add
      // to it, so it hands the person back rather than sitting on a skeleton.
      () => router.replace(route.groups()),
    );
  }, [router]);

  return (
    <Screen><Body>
      <TopBar title={copy.demo.opening} back={route.groups()} />
      <Scroll><SkeletonRows count={6} /></Scroll>
    </Body></Screen>
  );
}
