"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { useBrowserName } from "./install";
import { copy } from "../lib/copy";
import { tick } from "../lib/haptics";

/**
 * "Have the app?" — under the claim list in an iOS tab, for someone who
 * already has bida on the home screen: a tapped invite always opens the
 * browser, whose storage the app can't see, so the link has to be pasted
 * there (docs/ios.md). No install ask: that is the groups list's banner.
 *
 * It tries the clipboard on arrival, but iOS writes it only inside a gesture,
 * so "Copied" shows only once a write has actually gone through.
 */
export function UseInApp({ link }: { link: string }) {
  const { inApp } = copy.claim;
  const browser = useBrowserName();
  const [copied, setCopied] = useState(false);

  const write = () => navigator.clipboard.writeText(link).then(() => { setCopied(true); return true; }, () => false);

  useEffect(() => {
    navigator.clipboard.writeText(link).then(() => setCopied(true), () => {});
  }, [link]);

  return (
    <div className="card inapp">
      <div className="inapptitle">{inApp.title}</div>
      <p className="hint">{inApp.body(browser)}</p>
      <button type="button" className={`linkbox${copied ? " on" : ""}`}
        onClick={() => void write().then((ok) => ok && tick())}>
        <span className="selectable">{link}</span>
        <span className="linkboxstate">
          <Icon name={copied ? "check" : "link"} size={13} />
          {copied ? inApp.copied : inApp.copyLink}
        </span>
      </button>
    </div>
  );
}
