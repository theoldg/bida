import type { ReactNode } from "react";
import { AboutInstall } from "../../components/about-install";
import { AboutPrivacy } from "../../components/about-privacy";
import { Body, Screen, Scroll, TopBar } from "../../components/chrome";
import { Icon } from "../../components/icons";
import { copy } from "../../lib/copy";
import { route } from "../../lib/group-link";

/**
 * Who can edit, whether it works on a train, where to complain, and — folded at
 * the foot of it — who can read what you typed. Four claims, no pitch: this
 * screen is reached from the foot of the groups list, so whoever is on it
 * already has the app and does not need it described back to them.
 *
 * The page itself is prose and two links, so it stays a server component. Two
 * client islands sit in it, and both are there because a sentence alone would
 * be worse: the install offer under "Works offline", and the fold over the
 * privacy section (components/about-privacy.tsx).
 */
export default function AboutPage() {
  const { feedback } = copy.about;
  return (
    <Screen>
      <Body>
        <TopBar title={copy.about.title} back={route.groups()} />
        <Scroll>
          <div className="pad about">
            <Section title={copy.about.noAccounts.title}>{copy.about.noAccounts.body}</Section>

            <Section title={copy.about.offline.title} under={<AboutInstall />}>
              {copy.about.offline.body}
            </Section>

            {/* The two doors out of the app, and the only ones in it. A mailto
                rather than a form: a form needs an endpoint, an inbox and a
                spam story, and the address is the whole of what it would have
                sent. */}
            <Section title={feedback.title} under={
              <div className="aboutlinks">
                <a className="aboutlink" href={`mailto:${feedback.email}`}>
                  <Icon name="mail" size={14} />{feedback.email}
                </a>
                <a className="aboutlink" href={feedback.sourceUrl}
                  target="_blank" rel="noreferrer noopener">
                  <Icon name="link" size={14} />{feedback.source}
                </a>
              </div>
            }>{feedback.body}</Section>

            <AboutPrivacy />
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}

/**
 * One claim: its heading, its paragraph, and whatever hangs under that — the
 * install offer, or the links. Four of these and the screen is done; a card
 * apiece would have made a settings list out of something read top to bottom,
 * once.
 */
function Section({ title, children, under }: {
  title: string; children: string; under?: ReactNode;
}) {
  return (
    <section className="aboutsect">
      <h4>{title}</h4>
      <p>{children}</p>
      {under}
    </section>
  );
}
