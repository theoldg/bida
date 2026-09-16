"use client";

import { Body, Screen, Scroll, TopBar } from "../../components/chrome";
import { useBrowserName } from "../../components/install";
import { copy } from "../../lib/copy";

/**
 * Putting bida on an iOS home screen, and what that does and doesn't bring
 * along (docs/ios.md). One page whoever sends here — the groups list's banner
 * or a join's "Add to home screen" — so back is a plain back to either.
 *
 * Prose in `/about`'s register. There is no button onward: the way forward is
 * out of the browser, so back is the only exit.
 */
export default function InstallPage() {
  const browser = useBrowserName();
  const { page } = copy.install;

  return (
    <Screen>
      <Body>
        <TopBar title={page.title} back />
        <Scroll>
          <div className="pad about">
            <section className="aboutsect"><p>{page.why(browser)}</p></section>
            <section className="aboutsect">
              {/* A recording of Safari, not numbered steps: the share sheet has
                  moved between iOS versions, and a picture of it settles which
                  button is meant faster than prose can. */}
              <img className="installclip" src="/media/safari-add-to-home-screen.gif"
                width={440} height={956} alt={page.clipAlt} />
            </section>
            <section className="aboutsect">
              <h4>{page.empty.title}</h4>
              <p>{page.empty.body(browser)}</p>
            </section>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}
