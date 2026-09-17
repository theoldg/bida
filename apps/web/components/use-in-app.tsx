"use client";

import { CopyLink } from "./copy-link";
import { useBrowserName } from "./install";
import { copy } from "../lib/copy";

/**
 * "Have the app?" — pinned under the claim list in an iOS tab, for someone who
 * already has bida on the home screen: a tapped invite always opens the
 * browser, whose storage the app can't see, so the link has to be pasted
 * there (docs/ios.md). No install ask: that is the groups list's banner.
 */
export function UseInApp({ link }: { link: string }) {
  const { inApp } = copy.claim;
  const browser = useBrowserName();

  return (
    <div className="card inapp">
      <div className="inapptitle">{inApp.title}</div>
      <p className="hint">{inApp.body(browser)}</p>
      <CopyLink link={link} />
    </div>
  );
}
