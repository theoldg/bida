"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { copy } from "../lib/copy";
import { useBackButton } from "../lib/back-button";
import { goUp } from "../lib/nav";
import { Icon, type IconName } from "./icons";

/**
 * The app frame: a fixed head, one scrolling middle, an optional fixed foot.
 * Everything is one column at phone width and stays that way — this is a
 * pocket app, not a responsive site.
 */
export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`app${className ? ` ${className}` : ""}`}>{children}</div>;
}

export function Body({ children }: { children: ReactNode }) {
  return <div className="appbody">{children}</div>;
}

export function Scroll({ children }: { children: ReactNode }) {
  return <div className="scroll">{children}</div>;
}

/**
 * What a screen's back arrow is. A path climbs to that ancestor; `true` is a
 * plain back; and `{ ask }` is a screen that would lose typed work, whose
 * `ask()` returns false when it put a question up instead of leaving. Give it
 * `up` as well when the arrow climbs rather than steps back.
 */
export type Back = string | true | { ask: () => boolean; up?: string };

export function TopBar({ title, sub, back, right }: {
  title: ReactNode; sub?: ReactNode; back?: Back; right?: ReactNode;
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
        <button className="iconbtn" onClick={press} aria-label={copy.act.back}>
          <Icon name="back" size={17} />
        </button>
      ) : typeof back === "string" ? (
        /* A real anchor, but not a plain push: the arrow names a parent, and
           going up unwinds the history to it rather than stacking another
           entry on top (lib/nav.ts). */
        <Link className="iconbtn" href={back} aria-label={copy.act.back}
          onClick={(e) => { e.preventDefault(); run(); }}>
          <Icon name="back" size={17} />
        </Link>
      ) : null}
      <div style={{ minWidth: 0 }}>
        <h3>{title}</h3>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {right ? <div className="spacer" style={{ display: "flex", gap: 8, alignItems: "center" }}>{right}</div> : null}
    </div>
  );
}

export function IconLink({ href, name, label }: { href: string; name: IconName; label: string }) {
  return <Link className="iconbtn" href={href} aria-label={label}><Icon name={name} size={18} /></Link>;
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
 */
export function QueryBoundary({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="app" />}>{children}</Suspense>;
}
