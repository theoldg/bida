"use client";

import { useSyncExternalStore } from "react";
import { Body, Screen, Scroll, TopBar } from "../../components/chrome";
import { Icon } from "../../components/icons";
import { copy } from "../../lib/copy";
import { route } from "../../lib/group-link";

const never = () => () => {};
const arrivedCopied = () => new URLSearchParams(location.search).has("copied");

/**
 * Putting bida on an iOS home screen, and what that does and doesn't bring
 * along (docs/ios.md). Reached from the groups list's banner, and — as
 * `?copied` — from a join's "Install first", which has just put the invite on
 * the clipboard. That arrival leads with the line for someone who already
 * installed: they can't be told apart from a newcomer, and their whole path is
 * one paste.
 *
 * Prose in `/about`'s register. There is no button onward: the way forward is
 * out of the browser, so back is the only exit.
 */
export default function InstallPage() {
  const copied = useSyncExternalStore(never, arrivedCopied, () => false);
  const { page } = copy.install;
  const share = <Icon name="share" size={15}
    style={{ display: "inline", verticalAlign: "-2px", color: "var(--ink)" }} />;

  return (
    <Screen>
      <Body>
        {/* From a join, back is that invite and its choice; from the list, the list. */}
        <TopBar title={page.title} back={copied ? true : route.groups()} />
        <Scroll>
          <div className="pad about">
            {copied ? (
              <p className="installcopied">
                <Icon name="check" size={14} /><span><strong>{page.copied}</strong> {page.copiedBody}</span>
              </p>
            ) : null}

            <section className="aboutsect">
              <h4>{page.why.title}</h4>
              <p>{page.why.body}</p>
            </section>

            <section className="aboutsect">
              <h4>{page.empty.title}</h4>
              <p>{page.empty.body}</p>
            </section>

            <section className="aboutsect">
              <h4>{page.how.title}</h4>
              <ol className="installsteps">
                <li><span>{page.how.tap} {share} {page.how.inBar}</span></li>
                <li><span>{page.how.add} <strong>{page.how.addLabel}</strong>.</span></li>
                <li>{page.how.open}</li>
                {copied ? <li>{page.how.paste}</li> : null}
              </ol>
            </section>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}
