"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { hasClipboard, writeClipboardText } from "../lib/clipboard";
import { tick } from "../lib/haptics";

/**
 * A link in a box that is its own copy button, reading **Copied** once a write
 * has actually gone through.
 *
 * It tries the clipboard on arrival as well, since the link is nearly always
 * wanted — but iOS writes it only inside a gesture, so the state follows what
 * succeeded rather than what was attempted, and the tap is always there.
 *
 * **Except where there is no clipboard at all** (`lib/clipboard.ts`), which is
 * a real in-app browser and not a hypothetical: then there is nothing for a
 * tap to do, so this is a box of text that says to hold it rather than a
 * button that answers a press with nothing. Both screens below are the last
 * thing the app can offer the person, so the link has to stay takeable.
 *
 * Shared by the two screens that can only hand the person a link and a place
 * to put it: "Have the app?" on a claim in an iOS tab (`use-in-app.tsx`), and
 * the way out of an in-app browser (`embedded.tsx`).
 */
export function CopyLink({ link }: { link: string }) {
  const { inApp } = copy.claim;
  const [copied, setCopied] = useState(false);
  const can = hasClipboard();

  const write = () => writeClipboardText(link).then(() => { setCopied(true); return true; }, () => false);

  useEffect(() => {
    if (!can) return;
    writeClipboardText(link).then(() => setCopied(true), () => {});
  }, [can, link]);

  const inside = (
    <>
      <span className="selectable">{link}</span>
      <span className="linkboxstate">
        <Icon name={copied ? "check" : "link"} size={13} />
        {copied ? inApp.copied : can ? inApp.copyLink : inApp.hold}
      </span>
    </>
  );

  if (!can) return <div className="linkbox">{inside}</div>;

  return (
    <button type="button" className={`linkbox${copied ? " on" : ""}`}
      onClick={() => void write().then((ok) => ok && tick())}>
      {inside}
    </button>
  );
}
