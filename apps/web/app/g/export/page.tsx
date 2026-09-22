"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BadLink, Blank, Body, QueryBoundary, Screen, Scroll, TopBar } from "@/components/chrome";
import { writeClipboardText } from "@/lib/clipboard";
import { copy } from "@/lib/copy";
import { fileHandoff, groupCsv, type HandoffPlan } from "@/lib/export";
import { route } from "@/lib/group-link";
import { useClaimGate, useGroupData } from "@/lib/hooks";

/**
 * The export as text, for a browser that can't hand over a file — reached only
 * from the last rung of `lib/export.ts`.
 *
 * It **rebuilds the CSV itself**: a route can't carry a file, and content that
 * evaporates on reload is what ADR-0007 forbids.
 *
 * Laid out like `/diag` — **button at the top of the scroll, not in a
 * `Foot`**, above hundreds of lines and clear of the system bar.
 */
export default function ExportPage() {
  return <QueryBoundary><ExportScreen /></QueryBoundary>;
}

function ExportScreen() {
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const unclaimed = useClaimGate(groupId, data);
  const [copied, setCopied] = useState(false);
  // Asked after mount, not during render: this is a static export, so the
  // first render happens where there is no `navigator` to ask.
  const [plan, setPlan] = useState<HandoffPlan>();

  useEffect(() => { setPlan(fileHandoff()); }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!groupId) return <BadLink />;
  if (!data.loading && !data.group) return <BadLink />;
  if (unclaimed || !data.group) {
    return <Blank title={copy.export.title} back={route.group(groupId)} />;
  }

  const csv = groupCsv(data);
  const empty = data.expenses.length === 0 && data.settlements.length === 0;

  return (
    <Screen>
      <Body>
        <TopBar title={copy.export.title} sub={data.group.name} back={route.group(groupId)} />
        <Scroll>
          <div className="diag-act">
            <p className="hint">
              {empty ? copy.export.nothing
                : plan === "text" ? copy.export.body
                : copy.export.bodyPlain}
            </p>
            <button type="button" className="btn btn-p" disabled={empty}
              onClick={() => {
                writeClipboardText(csv).then(
                  () => setCopied(true),
                  // The clipboard refuses on an insecure context or a denied
                  // permission, and is missing outright in some in-app
                  // browsers (lib/clipboard.ts). The file is already on screen
                  // to be selected,
                  // which is the whole point of this screen, so there is
                  // nothing to recover from and nothing to say.
                  () => setCopied(false),
                );
              }}>
              {copied ? copy.export.copied : copy.export.copyAll}
            </button>
          </div>
          {/* One <pre>, as on /diag: it is read, selected and pasted, never
              laid out. The rows are wider than a phone, so it scrolls
              sideways on its own rather than wrapping every line into
              nonsense. */}
          <pre className="diag">{csv}</pre>
        </Scroll>
      </Body>
    </Screen>
  );
}
