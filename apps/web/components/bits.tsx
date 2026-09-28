"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { initials } from "../lib/format";

/**
 * Initials in a square — for a *group*, in the list of them. **People don't
 * get one**: beside a name it only repeats its first letter
 * ([ADR-0023](../../../docs/decisions/0023-monospace-monochrome.md)). The
 * who-had-what grid draws its own for column headings.
 */
export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  return (
    <span className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      {initials(name)}
    </span>
  );
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

export function KV({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="kv">
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
