"use client";
// Doc: docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md

import { useEffect, useState } from "react";
import { Card } from "@/components/bits";
import { Blank, Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { Icon } from "@/components/icons";
import { BadLinkNotice } from "@/components/keyless-link";
import { MemberBill } from "@/components/member-bill";
import { copy } from "@/lib/copy";
import { bare, figure } from "@/lib/format";
import { route } from "@/lib/group-link";
import { fetchSplit, parseSplitLink, type Fetched } from "@/lib/split-link";

/**
 * `/split#<secret>` — a quick split somebody sent (ADR-0035), drawn as the
 * sender's result screen draws it and with nothing to do but read it: no
 * identity, no group, nothing written on this phone. The secret stays in the
 * fragment, which no browser sends anywhere.
 */
export default function SplitPage() {
  const [secret, setSecret] = useState<string | null>();
  const [fetched, setFetched] = useState<Fetched>();

  // Another split link tapped in this tab moves only the fragment.
  useEffect(() => {
    const read = () => setSecret(parseSplitLink(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    if (!secret) return;
    let live = true;
    setFetched(undefined);
    void fetchSplit(secret).then((f) => { if (live) setFetched(f); });
    return () => { live = false; };
  }, [secret]);

  if (secret === null) {
    return (
      <Screen><Body>
        <TopBar title=" " back={route.groups()} />
        <Scroll><BadLinkNotice /></Scroll>
      </Body></Screen>
    );
  }
  if (!fetched) return <Blank title={copy.quick.split} back={route.groups()} />;

  if (fetched.kind !== "split") {
    return (
      <Screen><Body>
        <TopBar title={copy.quick.split} back={route.groups()} />
        <Scroll>
          <div className="pad keyless">
            <div className="keyless-badge"><Icon name="link" size={20} /></div>
            <p>{copy.quick.landing[fetched.kind]}</p>
          </div>
        </Scroll>
      </Body></Screen>
    );
  }

  const { split } = fetched;
  const shown = (minor: number) => bare(minor, split.currency);
  return (
    <Screen><Body>
      <TopBar title={copy.quick.split} sub={split.title || undefined} back={route.groups()} />
      <Scroll>
        <div className="pad" style={{ paddingTop: 2 }}>
          <span className="bignum" style={{ fontSize: 32 }}>{shown(split.totalMinor)}</span>
        </div>
        <div className="pad" style={{ paddingTop: 2, paddingBottom: "var(--dock-foot)" }}>
          <Card>
            {split.people.map((share, i) => (
              <MemberBill key={i} name={share.name} total={shown(share.minor)}
                lines={share.lines} format={shown} fixed={{ copy: figure(share.minor, split.currency) }} />
            ))}
          </Card>
        </div>
      </Scroll>
    </Body></Screen>
  );
}
