"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Component, Suspense, useRef, type ErrorInfo, type ReactNode } from "react";
import { copy } from "../lib/copy";
import { useBackButton } from "../lib/back-button";
import { retryLive, useStalled } from "../lib/db/live";
import { useScrollMemory } from "../lib/scroll-memory";
import { goUp } from "../lib/nav";
import { keepsFocus } from "./bits";
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
 * A read of this phone's database that has stopped answering.
 *
 * It draws over whatever the screen was showing while it waited — which is a
 * skeleton, and which without this stood there forever looking like a slow
 * phone. `lib/db/live.ts` says why a read dies and what re-arming it means;
 * this is only the part a person sees.
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
 * The one scrolling middle of a screen — and the only scroller in the app the
 * browser would otherwise forget, since it is a div rather than the document.
 * `lib/scroll-memory.ts` is what puts it back where you left it.
 */
export function Scroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollMemory(ref);
  return <div className="scroll" ref={ref}>{children}</div>;
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
    : () => router.back();
  /** The arrow: ask first where there is something to ask about. */
  const press = () => { if (!guard || guard.ask()) run(); };
  // The device's back button does exactly what this arrow does
  // (lib/back-button.ts). `back === true` is the one that needs no help: it
  // *is* a plain back, so the button is already right.
  useBackButton(back === undefined || back === true ? undefined
    : { up, mayLeave: guard?.ask, run });
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
      {/* Centred on the bar itself, not between its neighbours: a control that
          belongs to the whole screen rather than to the title or the arrow.
          It is out of the flow, so the title is capped short of it
          (`.capped`) rather than trusted to be brief. */}
      {mid ? <div className="topbar-mid">{mid}</div> : null}
      {right ? <div className="spacer" style={{ display: "flex", gap: 8, alignItems: "center" }}>{right}</div> : null}
    </div>
  );
}

/**
 * The app's ONE navigation. There is deliberately no top tab strip to go with
 * it: `/g` used to carry both, and the two disagreed about which section you
 * were in. If a screen needs more destinations than fit here, they belong on
 * the group options screen, not in a second row.
 */
export function BottomNav({ items }: {
  items: { label: string; icon: IconName; href: string; on?: boolean }[];
}) {
  return (
    <nav className="bottomnav">
      {/* `replace`: the tabs are two halves of one screen, not two places you
          travelled through, so switching them doesn't deepen the history. */}
      {items.map((i) => (
        <Link key={i.href} href={i.href} replace className={`nav${i.on ? " on" : ""}`}
          aria-current={i.on ? "page" : undefined}>
          <Icon name={i.icon} size={19} />{i.label}
        </Link>
      ))}
    </nav>
  );
}

export function Fab({ href, label = copy.group.addEntry }: { href: string; label?: string }) {
  return <Link href={href} className="fab" aria-label={label}><Icon name="plus" size={24} /></Link>;
}

/**
 * The second way an expense starts: photograph the bill.
 *
 * It sits beside the "+", the same size, and is outlined where the "+" is a
 * solid ink block — two equal destinations, one of which is still the primary
 * (ADR-0023: the "+" is the only figure-ground inversion on the screen, and a
 * second one would spend that twice).
 */
export function ScanFab({ href }: { href: string }) {
  return (
    <Link href={href} className="fab fab-2" aria-label={copy.scan.scan}>
      <Icon name="cam" size={23} />
    </Link>
  );
}

/**
 * The balances tab's own button: what a scan costs, and where to chip in
 * (app/g/tip).
 *
 * Outlined rather than inked — the "+" is the app's one figure-ground
 * inversion (ADR-0023), and this screen spends its contrast on the numbers —
 * and the only FAB with a word in it, because a "+" and a camera are guessable
 * where an ask is not. It has the corner to itself: the ledger's two never
 * appear on this tab.
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
 * The ledger's own shape, drawn while the ledger is still coming out of
 * IndexedDB. Widths are a fixed cycle, not random: the static export renders
 * this markup at build time and a random width would differ from the browser's.
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
 * Something the app tried and couldn't do, said next to the thing that was
 * tried. Not an `alert()`: that one covers the form you would need to look at
 * to understand it, and has to be dismissed before you can.
 */
export function Failure({ children }: { children: ReactNode }) {
  return <p className="failure" role="alert">{children}</p>;
}

/**
 * The frame, with nothing in it yet — a screen whose group hasn't come out of
 * IndexedDB. Every screen has this moment and they all drew it by hand. The
 * title is blank unless the screen knows it without the ledger.
 *
 * `back` has to be the parent the *loaded* screen will name, not the default:
 * it is the back button's behaviour too now (lib/back-button.ts), so a press
 * during the load would otherwise land somewhere the arrow never goes.
 */
export function Blank({ title = " ", back = true }: { title?: string; back?: Back }) {
  return <Screen><Body><TopBar title={title} back={back} /></Body></Screen>;
}

/**
 * A link that names a group this phone doesn't have. Every screen under `/g`
 * needs one: they all read the group out of the query string, and without this
 * a stale bookmark or a shared URL left them holding a back arrow and nothing
 * else. It always offers the way out — the group list — rather than only
 * saying no.
 */
export function BadLink() {
  return (
    <Screen><Body>
      <TopBar title={copy.group.badLink.title} back="/" />
      <Empty title={copy.group.badLink.empty}>{copy.group.badLink.body}</Empty>
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
 * Every screen reads its group id from the query string, and Next needs the
 * hook that does that to sit behind a Suspense boundary when the page is
 * statically exported. One wrapper, used by every page, instead of nine.
 *
 * Errors are not its job — `Suspense` is not an error boundary, and
 * `ReadErrorBoundary` below sits in the root layout so that the two screens
 * with no query string to read are covered too.
 */
export function QueryBoundary({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="app" />}>{children}</Suspense>;
}

/**
 * The app had no error boundary at all, and needed one: `dexie-react-hooks`
 * reports a failed read by **throwing during render**, so every Dexie error
 * that `liveQuery` does not swallow (see lib/db/live.ts for the two it does)
 * unmounted the whole tree to a white screen. Here it is a sentence and a
 * button. Wrapped around the whole app in app/layout.tsx, once.
 *
 * The one class in the app. React has no hook for this — catching a render
 * error requires `componentDidCatch`/`getDerivedStateFromError`, and there is
 * no function-component equivalent.
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
