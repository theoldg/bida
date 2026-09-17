import type { ReactNode } from "react";
import { AboutOffline } from "../../components/about-offline";
import { Body, Screen, Scroll, TopBar } from "../../components/chrome";
import { Icon } from "../../components/icons";
import { copy } from "../../lib/copy";
import { route } from "../../lib/group-link";
import { VERSION } from "../../lib/version";

/**
 * Who can edit, whether it works on a train, where to complain, and — last,
 * since it is the longest and the one fewest people are here for — who can
 * read what you typed. Four claims, no pitch: this screen is reached from the
 * foot of the groups list, so whoever is on it already has the app and does
 * not need it described back to them. The source link and the build's number
 * sit above all four, since they are the two things here somebody might come
 * looking for on their own.
 *
 * The page itself is prose and links, so it stays a server component. One
 * client island sits in it — the whole of "Works offline" (`AboutOffline`) —
 * because what that claim says depends on whether the phone already did it.
 */
export default function AboutPage() {
  const { feedback, privacy } = copy.about;
  return (
    <Screen>
      <Body>
        <TopBar title={copy.about.title} back={route.groups()} />
        <Scroll>
          <div className="pad about">
            {/* The build's number rides beside the source link rather than
                sitting under the claims: both are things somebody arrives at
                this screen already looking for, and neither is read on the
                way past. Quiet enough that the link still leads
                (lib/version.ts). */}
            <div className="aboutsrc">
              <a className="aboutlink" href={feedback.sourceUrl}
                target="_blank" rel="noreferrer noopener">
                <Icon name="link" size={14} />{feedback.source}
              </a>
              <span className="aboutver">{copy.about.version} {VERSION}</span>
            </div>

            <Section title={copy.about.noAccounts.title}>{copy.about.noAccounts.body}</Section>

            <AboutOffline />

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

            {/* Led by its own bold sentence, ahead of the paragraph it is an
                exception to: the photograph leaves for somebody else's server
                entirely, and it is the one thing about this app that is not
                sealed. Said after the rest, it would read like a footnote. */}
            <Section title={privacy.title} under={
              <>
                <p> <strong> {privacy.e2eTitle} </strong> {privacy.body}</p>
                <SealedRow />
                <p>{privacy.key}</p>
                <p>{privacy.shape}</p>
              </>
            }>
              <><strong>{privacy.scanTitle}</strong> {privacy.scan}</>
            </Section>
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
 * An actual table rather than the JSON it really is, and rather than a
 * label/value list — the reader of this screen is somebody splitting a dinner
 * bill, and braces would make the shape look like a developer's aside rather
 * than the short row it is. Four fields, three of them meaningless on their
 * own, and the fourth unreadable.
 */
function SealedRow() {
  const { sealed } = copy.about.privacy;
  return (
    <table className="aboutrow">
      <thead>
        <tr>{sealed.map(({ k }) => <th key={k}>{k}</th>)}</tr>
      </thead>
      <tbody>
        <tr>{sealed.map(({ k, v }) => <td key={k}>{v}</td>)}</tr>
      </tbody>
    </table>
  );
}

/**
 * One claim: its heading, its paragraph, and whatever hangs under that —
 * links, or the sealed-row table. `AboutOffline` draws its own version of the
 * same markup, because its paragraph isn't fixed at build time. A card apiece
 * would have made a settings list out of something read top to bottom, once.
 */
function Section({ title, children, under }: {
  title: string; children: ReactNode; under?: ReactNode;
}) {
  return (
    <section className="aboutsect">
      <h4>{title}</h4>
      <p>{children}</p>
      {under}
    </section>
  );
}
