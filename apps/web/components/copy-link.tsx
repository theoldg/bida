"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { tick } from "../lib/haptics";

/**
 * A link in a box that is its own copy button, reading **Copied** once a write
 * has actually gone through.
 *
 * It tries the clipboard on arrival as well, since the link is nearly always
 * wanted — but iOS writes it only inside a gesture, so the state follows what
 * succeeded rather than what was attempted, and the tap is always there.
 *
 * Shared by the two screens that can only hand the person a link and a place
 * to put it: "Have the app?" on a claim in an iOS tab (`use-in-app.tsx`), and
 * the way out of an in-app browser (`embedded.tsx`).
 */
export function CopyLink({ link }: { link: string }) {
  const { inApp } = copy.claim;
  const [copied, setCopied] = useState(false);

  const write = () => navigator.clipboard.writeText(link).then(() => { setCopied(true); return true; }, () => false);

  useEffect(() => {
    navigator.clipboard.writeText(link).then(() => setCopied(true), () => {});
  }, [link]);

  return (
    <button type="button" className={`linkbox${copied ? " on" : ""}`}
      onClick={() => void write().then((ok) => ok && tick())}>
      <span className="selectable">{link}</span>
      <span className="linkboxstate">
        <Icon name={copied ? "check" : "link"} size={13} />
        {copied ? inApp.copied : inApp.copyLink}
      </span>
    </button>
  );
}
