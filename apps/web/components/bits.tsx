"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { initials } from "../lib/format";
import { caretOnPress, isTyping } from "../lib/viewport";

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

/**
 * Props for a control pressed while a field still has the caret: it keeps
 * that focus. Otherwise the press blurs the field on `mousedown`, the keyboard
 * retracts, the page reflows, and the `click` lands where the button no
 * longer is.
 *
 * **Only the pointer is held off** — Tab and Enter still focus and fire.
 *
 * **And only while a keyboard is up.** Android's back closes the keyboard but
 * leaves the caret; holding focus through the next press makes Chrome reopen
 * the keyboard over the answer. So then the field is `blur()`ed by hand
 * (whether `mousedown` moves focus varies by browser and target). `data-kb`
 * says whether a keyboard is up (components/viewport.tsx).
 */
export const keepsFocus = {
  onMouseDown: (e: React.MouseEvent) => {
    const focused = document.activeElement;
    switch (caretOnPress(document.documentElement.hasAttribute("data-kb"), isTyping(focused))) {
      case "hold": e.preventDefault(); break;
      case "blur": if (focused instanceof HTMLElement) focused.blur(); break;
      case "free": break;
    }
  },
} as const;
