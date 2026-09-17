"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BadLink, Blank, Body, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { copy } from "../../../lib/copy";
import { fileHandoff, groupCsv, type HandoffPlan } from "../../../lib/export";
import { route } from "../../../lib/group-link";
import { useClaimGate, useGroupData } from "../../../lib/hooks";

/**
 * The export as text, for a browser that cannot hand over a file.
 *
 * Reached from nowhere but the last rung of `lib/export.ts`: where there is a
 * share sheet or a download, the menu item finishes on its own and this screen
 * never appears. Selecting a ledger out of a `<pre>` and pasting it into Sheets
 * is a poor way to get a file, and it is the difference between an export that
 * exists on that phone and one that doesn't.
 *
 * It **rebuilds the CSV itself** rather than being handed the text. A route
 * cannot carry a file, and a screen whose content evaporates on reload is the
 * drawer state ADR-0007 was written to get rid of. That also makes it
 * addressable, which costs nothing: it is a readout of a group this phone
 * already holds the key to.
 *
 * Laid out like `/diag`, the app's other "here is the text, take it
 * somewhere" screen — including the button at the top of the scroll rather
 * than in a `Foot`, since the thing below it is hundreds of lines and the
 * bottom of an installed app is where the system's own bar sits.
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
                navigator.clipboard.writeText(csv).then(
                  () => setCopied(true),
                  // The clipboard refuses on an insecure context or a denied
                  // permission. The file is already on screen to be selected,
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
