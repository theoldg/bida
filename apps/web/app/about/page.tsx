import type { ReactNode } from "react";
import { AboutInstall } from "../../components/about-install";
import { Body, Screen, Scroll, TopBar } from "../../components/chrome";
import { Icon } from "../../components/icons";
import { copy } from "../../lib/copy";
import { route } from "../../lib/group-link";

/**
 * Who can edit, whether it works on a train, where to complain, and who can
 * read what you typed. Four claims, no pitch: this screen is reached from the
 * foot of the groups list, so whoever is on it already has the app and does
 * not need it described back to them. The source link sits above all four,
 * since it is the one thing here somebody might come looking for on its own.
 *
 * The page itself is prose and links, so it stays a server component. One
 * client island sits in it — the install offer under "Works offline" — because
 * a sentence alone would be worse.
 */
export default function AboutPage() {
  const { feedback, privacy } = copy.about;
  return (
    <Screen>
      <Body>
        <TopBar title={copy.about.title} back={route.groups()} />
        <Scroll>
          <div className="pad about">
            <a className="aboutlink" href={feedback.sourceUrl}
              target="_blank" rel="noreferrer noopener">
              <Icon name="link" size={14} />{feedback.source}
            </a>

            <Section title={copy.about.noAccounts.title}>{copy.about.noAccounts.body}</Section>

            <Section title={copy.about.offline.title} under={<AboutInstall />}>
              {copy.about.offline.body}
            </Section>

            <Section title={privacy.title} under={
              <>
                <SealedRow />
                <p>{privacy.key}</p>
                <p>{privacy.shape}</p>
                {/* Set apart and led by its own bold sentence: the photograph
                    leaves for somebody else's server entirely, and it is the
                    one thing about this app that is not sealed. An exception
                    buried in a paragraph is a lie. */}
                <p className="aboutwarn"><strong>{privacy.scanTitle}</strong> {privacy.scan}</p>
              </>
            }>{privacy.body}</Section>

            {/* The one door out of the app besides the source link above. A
                mailto rather than a form: a form needs an endpoint, an inbox
                and a spam story, and the address is the whole of what it
                would have sent. */}
            <Section title={feedback.title} under={
              <div className="aboutlinks">
                <a className="aboutlink" href={`mailto:${feedback.email}`}>
                  <Icon name="mail" size={14} />{feedback.email}
                </a>
              </div>
            }>{feedback.body}</Section>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}

/**
 * One saved expense as the database actually holds it: the answer to "what can
 * you see?", shown instead of asserted.
 *
 * A labelled table rather than the JSON it really is — the reader of this
 * screen is somebody splitting a dinner bill, and braces would make the shape
 * look like a developer's aside rather than the short list it is. Four rows,
 * three of them meaningless on their own, and the fourth unreadable.
 */
function SealedRow() {
  return (
    <dl className="aboutrow">
      {copy.about.privacy.sealed.map(({ k, v }) => (
        <div className="aboutrowline" key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
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
