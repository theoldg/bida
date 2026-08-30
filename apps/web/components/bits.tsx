"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { Member } from "@hajsik/core";
import { Icon, type IconName } from "./icons";
import { initials } from "../lib/format";

/** Initials in a square. `name` is for what isn't a member — a group. */
export function Avatar({ member, size = 34, name }: {
  member?: Member; size?: number; name?: string;
}) {
  const label = member?.name ?? name ?? "?";
  return (
    <span className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      {initials(label)}
    </span>
  );
}

/**
 * A row that *does* something rather than being something in the list — add a
 * member, start a group, leave one. A dashed outline stands where an avatar's
 * initials would be, so it reads as an empty slot in the same column.
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
