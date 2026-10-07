"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { initials } from "../lib/format";
import { copy } from "../lib/copy";

/**
 * A group's initials on a little receipt — a slip torn top and bottom — in
 * the list of groups. **People don't get one**: beside a name it only repeats
 * its first letter
 * ([ADR-0023](../../../docs/decisions/0023-monospace-monochrome.md)). The
 * who-had-what grid draws its own squares for column headings.
 */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span className="avatar receipt" style={{ width: size, height: size }}>
      <svg viewBox="0 0 26 34" aria-hidden="true">
        <path className="slip" d="M1.5 3l2.875 -2.5l2.875 2.5l2.875 -2.5l2.875 2.5l2.875 -2.5l2.875 2.5l2.875 -2.5l2.875 2.5V31l-2.875 2.5l-2.875 -2.5l-2.875 2.5l-2.875 -2.5l-2.875 2.5l-2.875 -2.5l-2.875 2.5l-2.875 -2.5Z" />
      </svg>
      <span className="rinit" style={{ fontSize: Math.round(size * 0.3) }}>{initials(name)}</span>
    </span>
  );
}

export function Chip({ children, variant, style }: {
  children: ReactNode; variant?: "hl" | "pend"; style?: CSSProperties;
}) {
  return <span className={`chip${variant ? ` ${variant}` : ""}`} style={style}>{children}</span>;
}

/**
 * A row's name with no line under it, as tall as a name with one and centred
 * in that height — the amount columns, beside tabs whose rows carry a line.
 * The height is an invisible title-and-line pair, so it is whatever the
 * device makes of those two lines (`.rmain.solo`).
 */
export function SoloName({ name, you, style }: { name: string; you?: boolean; style?: CSSProperties }) {
  return (
    <span className="rmain solo" style={style}>
      <span className="sologhost" aria-hidden="true">
        <span className="rtitle">&nbsp;</span>
        <span className="rmeta">&nbsp;</span>
      </span>
      <span className="rtitle">{name}{you ? <You /> : null}</span>
    </span>
  );
}

/** Beside your own name, wherever a list of people prints it. */
export function You() {
  return <span className="youtag"> ({copy.entry.you})</span>;
}

export function Card({ children, style, className }: {
  children: ReactNode; style?: CSSProperties; className?: string;
}) {
  return <div className={`card${className ? ` ${className}` : ""}`} style={style}>{children}</div>;
}

/** A person and their figure, the name as loud as the money (`.kv.who`). */
export function KV({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="kv who">
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
