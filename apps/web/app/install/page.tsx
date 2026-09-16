"use client";

import { useSyncExternalStore } from "react";
import { Body, Screen, Scroll, TopBar } from "../../components/chrome";
import { Icon } from "../../components/icons";
import { useBrowserName } from "../../components/install";
import { copy } from "../../lib/copy";
import { route } from "../../lib/group-link";

const never = () => () => {};
const arrivedCopied = () => new URLSearchParams(location.search).has("copied");

/**
 * Putting bida on an iOS home screen, and what that does and doesn't bring
 * along (docs/ios.md). Reached from the groups list's banner, and — as
 * `?copied` — from a join's "Add to home screen", which has just put the invite on
 * the clipboard. That arrival leads with the line for someone who already
 * installed: they can't be told apart from a newcomer, and their whole path is
 * one paste.
 *
 * Prose in `/about`'s register. There is no button onward: the way forward is
 * out of the browser, so back is the only exit.
 */
export default function InstallPage() {
  const copied = useSyncExternalStore(never, arrivedCopied, () => false);
  const browser = useBrowserName();
  const { page } = copy.install;

  /* A recording of Safari, not numbered steps: the share sheet has moved
     between iOS versions, and a picture of it settles which button is meant
     faster than prose can. */
  const clip = (
    <img className="installclip" src="/media/safari-add-to-home-screen.gif"
      width={440} height={956} alt={page.how.clipAlt} />
  );

  return (
    <Screen>
      <Body>
        {/* From a join, back is that invite and its choice; from the list, the list. */}
        <TopBar title={page.title} back={copied ? true : route.groups()} />
        <Scroll>
          {copied ? (
            <div className="pad about">
              <p className="installcopied">
                <Icon name="check" size={14} /><span><strong>{page.copied}</strong> {page.copiedBody}</span>
              </p>
              <section className="aboutsect">
                <h4>{page.why.title}</h4>
                <p>{page.why.body(browser)}</p>
              </section>
              <section className="aboutsect">
                <h4>{page.empty.title}</h4>
                <p>{page.empty.bodyCopied(browser)}</p>
              </section>
              <section className="aboutsect">
                <h4>{page.how.title}</h4>
                {clip}
                <p>{page.how.thenPaste}</p>
              </section>
            </div>
          ) : (
            <div className="pad about">
              <section className="aboutsect"><p>{page.why.body(browser)}</p></section>
              <section className="aboutsect">{clip}</section>
              <section className="aboutsect">
                <h4>{page.empty.title}</h4>
                <p>{page.empty.body(browser)}</p>
              </section>
            </div>
          )}
        </Scroll>
      </Body>
    </Screen>
  );
}
