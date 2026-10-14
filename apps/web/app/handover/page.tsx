"use client";
// Doc: docs/ios.md#the-in-app-browser--a-one-off-visit

import { useEffect, useState } from "react";
import { useCarryIn } from "@/components/carry-in";
import { JoiningFrame } from "@/components/joining";
import { parseInvites, type CarriedGroup } from "@/lib/group-link";

/**
 * Where an in-app browser's way out lands (`route.handover`): its groups and
 * who it was in each, taken in as an icon launch takes them. A route of its
 * own rather than `/install`, whose export is the iOS tutorial and would paint
 * before any script ran; this one is "Joining…" from the first byte.
 */
export default function HandoverPage() {
  const [invites, setInvites] = useState<CarriedGroup[] | undefined>(undefined);
  useEffect(() => setInvites(parseInvites(window.location.hash)), []);
  useCarryIn(invites, { handover: true });
  return <JoiningFrame />;
}
