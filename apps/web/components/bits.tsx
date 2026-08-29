"use client";

import type { CSSProperties, ReactNode } from "react";
import type { Member } from "@hajsik/core";
import { initials } from "../lib/format";

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
