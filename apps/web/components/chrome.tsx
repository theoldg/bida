"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Component, Suspense, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { isDemo } from "@bida/core";
import { copy } from "../lib/copy";
import { wantsDemo } from "../lib/db/commands";
import { route } from "../lib/group-link";
import { useBackButton } from "../lib/back-button";
import { retryLive, useStalled } from "../lib/db/live";
import { useScrollMemory } from "../lib/scroll-memory";
import { goUp, goBack } from "../lib/nav";
import { keepsFocus } from "./bits";
import { KeylessLink } from "./keyless-link";
import { walkFields } from "./viewport";
import { Icon, type IconName } from "./icons";

/**
 * The app frame: a fixed head, one scrolling middle, an optional fixed foot.
 * Everything is one column at phone width and stays that way — this is a
 * pocket app, not a responsive site.
 */
export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`app${className ? ` ${className}` : ""}`}>
      {/* Here rather than on the screens, because it belongs to all of them:
          every screen in the app is a `Screen`, and the read that stalled
          could be any of the nine that check `data.loading`. */}
      <StallNotice />
      {children}
    </div>
  );
}

/**
 * A read of this phone's database that has stopped answering, drawn over the
 * skeleton that would otherwise look like a slow phone forever. The why is in
 * `lib/db/live.ts`.
 */
function StallNotice() {
  const { stalled, blocked } = useStalled();
  if (!stalled) return null;
  return (
    <div className="stall" role="alert">
      <Icon name="sync" size={15} style={{ flex: "none" }} />
      <span>{blocked ? copy.db.blocked : copy.db.stalled}</span>
      {/* One button for both. Blocked clears when the other copy closes, and
          asking again is how this one finds out that it has. */}
      <button className="stall-act" onClick={retryLive}>{copy.act.retry}</button>
    </div>
  );
}

export function Body({ children }: { children: ReactNode }) {
  return <div className="appbody">{children}</div>;
}

/**
 * The one scrolling middle of a screen — a div, so the browser won't restore
 * its position; `lib/scroll-memory.ts` does.
 *
 * Also the scope the confirm key walks, in layout order (`walkFields`,
 * components/viewport.tsx). A dialog is deliberately not one: its Enter
 * submits the card.
 */
export function Scroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollMemory(ref);
  return <div className="scroll" ref={ref} onKeyDown={walkFields}>{children}</div>;
}

/**
 * What a screen's back arrow is. A path climbs to that ancestor; `true` is a
 * plain back; and `{ ask }` is a screen that would lose typed work, whose
 * `ask()` returns false when it put a question up instead of leaving. Give it
 * `up` as well when the arrow climbs rather than steps back.
 */
export type Back = string | true | { ask: () => boolean; up?: string };

export function TopBar({ title, sub, back, mid, right }: {
  title: ReactNode; sub?: ReactNode; back?: Back; mid?: ReactNode; right?: ReactNode;
}) {
  const router = useRouter();
  const guard = typeof back === "object" ? back : undefined;
  const up = typeof back === "string" ? back : guard?.up;
  const run = up !== undefined
    ? () => goUp(up, (to) => router.replace(to))
    : () => goBack(() => router.back(), (to) => router.replace(to));
  /** The arrow: ask first where there is something to ask about. */
  const press = () => { if (!guard || guard.ask()) run(); };
  // The device's back button does exactly what this arrow does
  // (lib/back-button.ts). `back === true` is the one that needs no help: it
  // *is* a plain back, so the button is already right.
  useBackButton(back === undefined || back === true ? undefined
    : { up, mayLeave: guard?.ask, swap: (to) => router.replace(to) });
  return (
    <div className="topbar">
      {back === true || guard ? (
        <button className="iconbtn" onClick={press} aria-label={copy.act.back} {...keepsFocus}>
          <Icon name="back" size={17} />
        </button>
      ) : typeof back === "string" ? (
        /* A real anchor, but not a plain push: the arrow names a parent, and
           going up unwinds the history to it rather than stacking another
           entry on top (lib/nav.ts). */
        <Link className="iconbtn" href={back} aria-label={copy.act.back}
          onClick={(e) => { e.preventDefault(); run(); }} {...keepsFocus}>
          <Icon name="back" size={17} />
        </Link>
      ) : null}
      <div className={`topbar-title${mid ? " capped" : ""}`}>
        <h3>{title}</h3>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {/* Centred on the bar itself: a control that belongs to the whole
          screen. Out of the flow, so the title is capped short of it
          (`.capped`). */}
      {mid ? <div className="topbar-mid">{mid}</div> : null}
      {right ? <div className="spacer" style={{ display: "flex", gap: 8, alignItems: "center" }}>{right}</div> : null}
    </div>
  );
}

export function Fab({ href, label = copy.group.addEntry }: { href: string; label?: string }) {
  return <Link href={href} className="fab" aria-label={label}><Icon name="plus" size={29} /></Link>;
}

/**
 * The second way an expense starts: photograph the bill. Beside the "+", the
 * same size, outlined — the "+" stays the only figure-ground inversion
 * (ADR-0023).
 */
export function ScanFab({ href }: { href: string }) {
  return (
    <Link href={href} className="fab fab-2" aria-label={copy.scan.scan}>
      <Icon name="cam" size={28} />
    </Link>
  );
}

/**
 * The balances' own button: what a scan costs, and where to chip in
 * (app/g/tip). Outlined (ADR-0023), and the only FAB with a word, because an
 * ask isn't guessable. The ledger's two never appear there.
 */
export function SupportFab({ href }: { href: string }) {
  return (
    <Link href={href} className="fab fab-2 fab-w">
      <Icon name="dollar" size={16} />{copy.tip.fab}
    </Link>
  );
}

export function Banner({ children, icon }: { children: ReactNode; icon?: IconName }) {
  return (
    <div className="banner">
      {icon ? <Icon name={icon} size={15} style={{ flex: "none" }} /> : null}
      <span>{children}</span>
    </div>
  );
}

/**
 * The ledger's shape, drawn while it comes out of IndexedDB. Fixed widths, not
 * random: the static export renders this at build time and must match.
 */
const SKELETON_WIDTHS = ["62%", "44%", "78%", "51%", "69%", "38%"];

export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="rows" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="row skelrow" key={i} style={{ ["--d" as string]: `${i * 0.09}s` }}>
          <div className="rmain">
            <div className="skel" style={{ height: 9, width: SKELETON_WIDTHS[i % SKELETON_WIDTHS.length] }} />
            <div className="skel" style={{ height: 7, width: "34%" }} />
          </div>
          <div className="ramt">
            <div className="skel" style={{ height: 10, width: 54 }} />
            <div className="skel" style={{ height: 7, width: 32 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><b>{title}</b>{children}</div>;
}

/**
 * Something the app tried and couldn't do, said next to what was tried. Not an
 * `alert()`, which covers the form you'd need to read to understand it.
 */
export function Failure({ children }: { children: ReactNode }) {
  return <p className="failure" role="alert">{children}</p>;
}

/**
 * The frame with nothing in it yet — a screen whose group hasn't come out of
 * IndexedDB. The title is blank unless the screen knows it without the ledger.
 *
 * **`back` has to be the parent the *loaded* screen will name**: it drives the
 * device back button too (lib/back-button.ts), so a press during the load
 * would otherwise land somewhere the arrow never goes.
 */
export function Blank({ title = " ", back = true }: { title?: string; back?: Back }) {
  return <Screen><Body><TopBar title={title} back={back} /></Body></Screen>;
}

/**
 * A link naming a group this phone doesn't have — every `/g` screen needs one,
 * or a stale bookmark leaves just a back arrow. Offers the group list; no
 * title, since the heading says what's wrong.
 *
 * **Except the demo's id, which goes to `/demo`.** An address copied off
 * somebody's demo names a group the next phone hasn't got and can't join —
 * the demo has no key — but its id is a constant, so it can only be asking
 * for the demo. `/demo` lays one down and comes back to the ledger, from
 * whichever `/g` screen was copied: a first visit is too early to learn that
 * only one address works. `wantsDemo` says when, and why not on the screen's
 * own read.
 */
export function BadLink() {
  const router = useRouter();
  const demo = isDemo(useSearchParams().get("id") ?? undefined);
  // Undecided while the read runs, so neither screen flashes past.
  const [going, setGoing] = useState<boolean>();
  useEffect(() => {
    if (!demo) return;
    let live = true;
    void wantsDemo().then((wants) => {
      if (!live) return;
      setGoing(wants);
      if (wants) router.replace(route.demo());
    }, () => live && setGoing(false));
    return () => { live = false; };
  }, [demo, router]);
  if (demo && going !== false) return <Blank back={route.groups()} />;
  return (
    <Screen><Body>
        <TopBar title=" " back={"/"} />
        <Scroll><KeylessLink /></Scroll>
      </Body></Screen>
  );
}

/**
 * A fixed bar under the scroll holding the screen's one act. Only for a button
 * that ends the screen — a decision that fits in a paragraph is a dialog
 * (ADR-0008).
 */
export function Foot({ children }: { children: ReactNode }) {
  return <div className="foot">{children}</div>;
}

/**
 * Every screen reads its group id from the query string, and Next needs that
 * hook behind a Suspense boundary in a static export. Not an error boundary:
 * `ReadErrorBoundary` sits in the root layout for that.
 */
export function QueryBoundary({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="app" />}>{children}</Suspense>;
}

/**
 * `dexie-react-hooks` reports a failed read by **throwing during render**, so
 * any Dexie error `liveQuery` doesn't swallow (lib/db/live.ts) would white-
 * screen the tree. Here it is a sentence and a button, around the whole app
 * in app/layout.tsx. A class because React has no hook for error boundaries.
 */
export class ReadErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // The screen says what a person can do; this is for whoever is looking at
    // a phone over USB, and it is the only trace the failure leaves.
    console.error("bida: a screen failed to read the database", error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Screen>
        <Body>
          <Empty title={copy.db.broken.title}>{copy.db.broken.body}</Empty>
        </Body>
        {/* A reload, not a retry: this tree is already half-built, and the
            service worker serves the shell from cache, so it costs nothing
            and works offline. */}
        <Foot>
          <button type="button" className="btn btn-p btn-lg" onClick={() => location.reload()}>
            {copy.act.reload}
          </button>
        </Foot>
      </Screen>
    );
  }
}
