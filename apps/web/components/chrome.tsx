"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { usePersonalMode } from "../lib/hooks";

/**
 * The app frame: a fixed head, one scrolling middle, an optional fixed foot.
 * Everything is one column at phone width and stays that way — this is a
 * pocket app, not a responsive site.
 */
export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  const personal = usePersonalMode();
  return (
    <div className={`app${personal ? " personal" : ""}${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}

export function Body({ children }: { children: ReactNode }) {
  return <div className="appbody">{children}</div>;
}

export function Scroll({ children }: { children: ReactNode }) {
  return <div className="scroll">{children}</div>;
}

export function TopBar({ title, sub, back, right }: {
  title: ReactNode; sub?: ReactNode; back?: string | true | (() => void); right?: ReactNode;
}) {
  const router = useRouter();
  return (
    <div className="topbar">
      {back === true || typeof back === "function" ? (
        <button className="iconbtn" onClick={() => (typeof back === "function" ? back() : router.back())} aria-label="Back">
          <Icon name="back" size={17} />
        </button>
      ) : back ? (
        <Link className="iconbtn" href={back} aria-label="Back"><Icon name="back" size={17} /></Link>
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
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={`nav${i.on ? " on" : ""}`}>
          <Icon name={i.icon} size={19} />{i.label}
        </Link>
      ))}
    </nav>
  );
}

export function Fab({ href, label = "Add expense" }: { href: string; label?: string }) {
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
          <div className="avatar skel" />
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
 * Every screen reads its group id from the query string, and Next needs the
 * hook that does that to sit behind a Suspense boundary when the page is
 * statically exported. One wrapper, used by every page, instead of nine.
 */
export function QueryBoundary({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="app" />}>{children}</Suspense>;
}
