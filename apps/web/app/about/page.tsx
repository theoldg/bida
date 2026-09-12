import type { ReactNode } from "react";
import { Body, Screen, Scroll, TopBar } from "../../components/chrome";
import { Icon } from "../../components/icons";
import { copy } from "../../lib/copy";
import { route } from "../../lib/group-link";

/**
 * What this is, who can read it, and where to complain.
 *
 * The one screen the app spends on itself, reached from the quiet "About bida"
 * line at the foot of the groups list — which was drawn and dead until this
 * existed. It is prose and two links, so it is a server component: nothing here
 * reads the database, the clock or the phone.
 *
 * The privacy section is the reason the screen is worth its slot. There are no
 * accounts and the group is a link, which makes "who can see this?" the first
 * question a person actually has — and the honest answer today is that the
 * server stores what syncs as plain text (todo.md, "Assess privacy"). Saying so
 * costs a paragraph; discovering it later costs the project its one asset.
 */
export default function AboutPage() {
  return (
    <Screen>
      <Body>
        <TopBar title={copy.about.title} back={route.groups()} />
        <Scroll>
          <div className="pad about">
            <p className="aboutlede">{copy.about.lede}</p>

            <Section title={copy.about.noAccounts.title}>{copy.about.noAccounts.body}</Section>
            <Section title={copy.about.onYourPhone.title}>{copy.about.onYourPhone.body}</Section>
            {/* The scan line is a second paragraph rather than a clause in the
                first: the photograph leaves for somebody else's server
                entirely, which is a different claim from "ours keeps it in the
                clear". */}
            <Section title={copy.about.privacy.title} under={
              <p className="hint">{copy.about.privacy.scan}</p>
            }>{copy.about.privacy.body}</Section>

            {/* The two doors out of the app, and the only ones in it. A
                mailto rather than a form: a form needs an endpoint, an inbox
                and a spam story, and the address is the whole of what a form
                would have sent. */}
            <Section title={copy.about.feedback.title} under={
              <div className="aboutlinks">
                <a className="aboutlink" href={`mailto:${copy.about.feedback.email}`}>
                  <Icon name="mail" size={14} />{copy.about.feedback.email}
                </a>
                <a className="aboutlink" href={copy.about.feedback.sourceUrl}
                  target="_blank" rel="noreferrer noopener">
                  <Icon name="link" size={14} />{copy.about.feedback.source}
                </a>
              </div>
            }>{copy.about.feedback.body}</Section>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}

/**
 * One claim: its heading, its paragraph, and whatever hangs under that — a
 * second line, or the links. Four of these and the screen is done; a card
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
