"use client";
// Doc: docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md

import { useEffect, useRef, type ReactNode } from "react";
import { clearDraft } from "@/lib/draft";
import { clearQuickPeople } from "@/lib/quick";
import { useScanCredential } from "@/lib/scan/credential";

/**
 * **Leaving a quick split throws it away, however it is left.** Next keeps
 * this mounted across the flow's own screens and unmounts it on every way out
 * — Done, the arrow, the device's back, and an iOS edge swipe, which no screen
 * gets to ask about. So it is the one place the bill and the names are
 * dropped: a scan still reading when somebody leaves then lands on no draft and
 * stops, rather than greeting the next visit with a bill nobody remembers.
 */
export default function QuickLayout({ children }: { children: ReactNode }) {
  const cred = useScanCredential();
  const id = useRef(cred?.id);
  id.current = cred?.id;
  useEffect(() => () => {
    if (id.current) clearDraft(id.current);
    clearQuickPeople();
  }, []);
  return children;
}
