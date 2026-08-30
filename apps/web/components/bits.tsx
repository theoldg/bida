"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { initials } from "../lib/format";

/**
 * Initials in a square — for a *group*, in the list of them, where a row has no
 * other mark and every group's name is different.
 *
 * People don't get one. A name is already the shortest way to say who someone
 * is, and the square beside it repeated the first letter of the word next to it
 * on every screen the app has ([ADR-0032](../../../docs/decisions/0032-a-name-is-enough.md)).
 * The one exception is the who-had-what grid, which uses initials as column
 * headings and so draws its own.
 */
export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  return (
    <span className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      {initials(name)}
    </span>
  );
}

/**
 * A row that *does* something rather than being something in the list — add a
 * member, start a group, leave one. The dashed square holds the icon, and marks
 * the row as a thing to press rather than a thing that is there.
 *
 * `.ghostrow` carries the air above the first one, so a page never has to pass
 * a padding to say "this is where the list ends and the actions begin".
 */
export function GhostRow({ icon, label, href, onClick, danger }: {
  icon: IconName;
  label: ReactNode;
  href?: string;
  onClick?: () => void;
  /** Leaving a group is the one of these that takes something away. */
  danger?: boolean;
}) {
  const color = danger ? "var(--debit)" : "var(--muted)";
  const inner = (
    <>
      <span className="avatar ghost" style={{ color }}><Icon name={icon} size={15} /></span>
      <div className="rmain"><div className="rtitle" style={{ color, fontWeight: 500 }}>{label}</div></div>
    </>
  );
  return href
    ? <Link href={href} className="row ghostrow">{inner}</Link>
    : <button className="row ghostrow" onClick={onClick}>{inner}</button>;
}

export function Chip({ children, variant, style }: {
  children: ReactNode; variant?: "hl" | "pend"; style?: CSSProperties;
}) {
  return <span className={`chip${variant ? ` ${variant}` : ""}`} style={style}>{children}</span>;
}

export function Card({ children, style, className }: {
  children: ReactNode; style?: CSSProperties; className?: string;
}) {
  return <div className={`card${className ? ` ${className}` : ""}`} style={style}>{children}</div>;
}

export function KV({ k, v, dim }: { k: ReactNode; v: ReactNode; dim?: boolean }) {
  return (
    <div className="kv" style={dim ? { opacity: .45 } : undefined}>
      <span className="k">{k}</span><span className="v">{v}</span>
    </div>
  );
}

export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="eyebrow" style={style}>{children}</div>;
}

/** Red for what you owe, green for what you're owed — never colour alone. */
export function signClass(minor: number): string {
  return minor > 0 ? "credit" : minor < 0 ? "debit" : "";
}
