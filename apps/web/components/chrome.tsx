"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Component, Fragment, Suspense, useEffect, useState, type ErrorInfo, type ReactNode, type Ref } from "react";
import { isDemo } from "@bida/core";
import { copy } from "../lib/copy";
import { wantsDemo } from "../lib/db/commands";
import { route } from "../lib/group-link";
import { useBackButton } from "../lib/back-button";
import { retryLive, useStalled } from "../lib/db/live";
import { goUp, goBack } from "../lib/nav";
import { KeylessLink } from "./keyless-link";
import { walkFields } from "./viewport";
import { Icon, type IconName } from "./icons";

/** A fixed head, one scrolling middle, an optional fixed foot. One column, always: a pocket app. */
/** `inert` for a frame that only stands in for a screen still deciding (`FirstFrames`). */
export function Screen({ children, className, inert }: { children: ReactNode; className?: string; inert?: boolean }) {
  return (
    <div className={`app${className ? ` ${className}` : ""}`} inert={inert}>
      {/* Here, because the read that stalled could belong to any screen. */}
      <StallNotice />
      {children}
    </div>
  );
}

/** Over a skeleton that would otherwise look like a slow phone forever (lib/db/live.ts). */
function StallNotice() {
  const { stalled, blocked } = useStalled();
  if (!stalled) return null;
  return (
    <div className="stall" role="alert">
      <Icon name="sync" size={15} style={{ flex: "none" }} />
      <span>{blocked ? copy.db.blocked : copy.db.stalled}</span>
      {/* Blocked too: asking again is how this copy learns the other closed. */}
      <button className="stall-act" onClick={retryLive}>{copy.act.retry}</button>
    </div>
  );
}

export function Body({ children }: { children: ReactNode }) {
  return <div className="appbody">{children}</div>;
}

/**
 * A div, so the browser won't restore its position; only the ledger's comes
 * back (`lib/ledger-position.ts` takes the `ref`). Also the scope the confirm
 * key walks; a dialog's Enter submits the card instead.
 */
export function Scroll({ children, ref }: { children: ReactNode; ref?: Ref<HTMLDivElement> }) {
  return <div className="scroll" ref={ref} onKeyDown={walkFields}>{children}</div>;
}

/**
 * A path climbs to that ancestor; `true` is a plain back. `{ ask }` guards
 * typed work: `ask()` returns false when it put a question up instead.
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
  const press = () => { if (!guard || guard.ask()) run(); };
  // The device's back button does what the arrow does; a plain back needs no help.
  useBackButton(back === undefined || back === true ? undefined
    : { up, mayLeave: guard?.ask, swap: (to) => router.replace(to) });
  return (
    <div className="topbar">
      {back === true || guard ? (
        <button className="iconbtn back" onClick={press} aria-label={copy.act.back}>
          <Icon name="back" size={17} />
        </button>
      ) : typeof back === "string" ? (
        /* Going up unwinds the history rather than stacking an entry (lib/nav.ts). */
        <Link className="iconbtn back" href={back} aria-label={copy.act.back}
          onClick={(e) => { e.preventDefault(); run(); }}>
          <Icon name="back" size={17} />
        </Link>
      ) : null}
      <div className={`topbar-title${mid ? " capped" : ""}`}>
        <h3>{title}</h3>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {mid ? <div className="topbar-mid">{mid}</div> : null}
      {right ? <div className="spacer" style={{ display: "flex", gap: 8, alignItems: "center" }}>{right}</div> : null}
    </div>
  );
}

export function Fab({ href, label = copy.group.addEntry }: { href: string; label?: string }) {
  return <Link href={href} className="fab" aria-label={label}><Icon name="plus" size={29} /></Link>;
}

/** Outlined: the "+" stays the only figure-ground inversion (ADR-0023). */
export function ScanFab({ href }: { href: string }) {
  return (
    <Link href={href} className="fab fab-2" aria-label={copy.scan.title}>
      <Icon name="cam" size={28} />
    </Link>
  );
}

/** The only FAB with a word: an ask isn't guessable. */
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

/** Not random: the static export renders this at build time and must match. */
const SKELETON_WIDTHS = ["62%", "44%", "78%", "51%", "69%", "38%"];

/** The no-break space keeps the line box, so the bar is as tall as its words. */
function SkelText({ width }: { width: number | string }) {
  return <><span className="skel skeltext" style={{ width }} />{"\u00a0"}</>;
}

/** `days`: a date line every third row, a rhythm, not a promise. */
export function SkeletonRows({ count = 5, days = false }: { count?: number; days?: boolean }) {
  return (
    <div className="rows" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <Fragment key={i}>
          {days && i % 3 === 0
            ? <div className="daylabel skelday"><SkelText width={i === 0 ? 44 : 76} /></div>
            : null}
          <div className="row skelrow" style={{ ["--d" as string]: `${i * 0.09}s` }}>
            <div className="rmain">
              <div className="skel" style={{ height: 9, width: SKELETON_WIDTHS[i % SKELETON_WIDTHS.length] }} />
              <div className="skel" style={{ height: 7, width: "34%" }} />
            </div>
            <div className="ramt">
              <div className="skel" style={{ height: 10, width: 54 }} />
              <div className="skel" style={{ height: 7, width: 32 }} />
            </div>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/** The same card as `MySummary`, so the rows under it don't jump when it arrives. */
export function SkeletonSummary() {
  return (
    <div className="mysummary pad" aria-hidden="true">
      <div className="card mysum skelsum" style={{ ["--chars" as string]: 9 }}>
        <span className="mysumtext">
          <span className="eyebrow"><SkelText width={92} /></span>
          <span className="bignum"><SkelText width="7ch" /></span>
        </span>
        <Icon name="chev" size={20} className="mysumchev" />
      </div>
    </div>
  );
}

/**
 * The loading ledger, dissolved over the real one once it arrives. Its top bar
 * is drawn, not a `TopBar`, so nothing registers a back button twice.
 */
export function SkeletonVeil({ head, onGone }: { head?: ReactNode; onGone: () => void }) {
  return (
    <div className="skelveil" aria-hidden="true"
      // The bars' never-ending pulse bubbles here too.
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) onGone(); }}>
      <div className="topbar">
        <span className="iconbtn back"><Icon name="back" size={17} /></span>
        <div className="topbar-title"><h3>{" "}</h3></div>
      </div>
      <div className="scroll">{head}<SkeletonSummary /><SkeletonRows count={6} days /></div>
    </div>
  );
}

/**
 * The whole frame: a bare top bar looks like a tap that didn't land. With no
 * `groupId`, a launch reopening a group (lib/first-frame.ts), with FABs that go
 * nowhere yet. `head` is passed in, so the frame stays free of the banners' imports.
 */
export function LedgerSkeleton({ groupId, className, head, inert }: {
  groupId?: string; className?: string; head?: ReactNode; inert?: boolean;
}) {
  return (
    <Screen className={className} inert={inert}>
      <Body>
        <TopBar title=" " back={route.groups()} />
        <Scroll>{head}<SkeletonSummary /><SkeletonRows count={6} days /></Scroll>
      </Body>
      {groupId ? (
        <>
          <ScanFab href={route.scan(groupId)} />
          <Fab href={route.addEntry(groupId)} />
        </>
      ) : (
        <>
          <span className="fab fab-2" aria-hidden="true"><Icon name="cam" size={28} /></span>
          <span className="fab" aria-hidden="true"><Icon name="plus" size={29} /></span>
        </>
      )}
    </Screen>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><b>{title}</b>{children}</div>;
}

/** Said next to what was tried: an `alert()` covers the form you'd need to read. */
export function Failure({ children }: { children: ReactNode }) {
  return <p className="failure" role="alert">{children}</p>;
}

/**
 * A screen whose group hasn't loaded. `back` must be the parent the loaded
 * screen will name: it drives the device back button during the load too.
 */
export function Blank({ title = " ", back = true }: { title?: string; back?: Back }) {
  return <Screen><Body><TopBar title={title} back={back} /></Body></Screen>;
}

/**
 * A link naming a group this phone doesn't have. The demo's id is a constant,
 * so an address copied off somebody's demo goes to `/demo` (`wantsDemo`).
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

/** Only for a button that ends the screen; a decision is a dialog (ADR-0008). */
export function Foot({ children }: { children: ReactNode }) {
  return <div className="foot">{children}</div>;
}

/** Next needs `useSearchParams` behind Suspense in a static export. */
export function QueryBoundary({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="app" />}>{children}</Suspense>;
}

/** `dexie-react-hooks` throws a failed read during render, which would white-screen the app. */
export class ReadErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // The only trace, for whoever is looking at a phone over USB.
    console.error("bida: a screen failed to read the database", error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Screen>
        <Body>
          <Empty title={copy.db.broken.title}>{copy.db.broken.body}</Empty>
        </Body>
        {/* Not a retry: the tree is half-built, and the shell reloads from cache. */}
        <Foot>
          <button type="button" className="btn btn-p btn-lg" onClick={() => location.reload()}>
            {copy.act.reload}
          </button>
        </Foot>
      </Screen>
    );
  }
}
