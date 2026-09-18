import type { ReactNode } from "react";
import { AboutDelete } from "../../components/about-delete";
import { AboutOffline } from "../../components/about-offline";
import { Body, Screen, Scroll, TopBar } from "../../components/chrome";
import { Icon } from "../../components/icons";
import { copy } from "../../lib/copy";
import { route } from "../../lib/group-link";
import { VERSION } from "../../lib/version";

/**
 * Who can edit, whether it works on a train, where to complain, who can read
 * what you typed, and — last, being the one line here nobody is meant to act
 * on lightly — where to ask for a group to be erased. Five claims, no pitch:
 * this screen is reached from the foot of the groups list, so whoever is on it
 * already has the app and does not need it described back to them. The source
 * link sits above all five, since it is the one thing here somebody might come
 * looking for on its own, and the build's number sits in the bar's far corner,
 * out of the reading altogether.
 *
 * The page itself is prose and links, so it stays a server component. The two
 * sections whose sentences aren't fixed at build time draw themselves —
 * "Works offline" (`AboutOffline`), which depends on whether the phone already
 * did it, and "Delete your data" (`AboutDelete`), which names the host it is
 * being read from.
 */
export default function AboutPage() {
  const { feedback, privacy } = copy.about;
  return (
    <Screen>
      <Body>
        {/* The number rides in the bar's corner rather than in the prose:
            nobody opens this screen to read it, but it is the first thing
            worth knowing about a phone behaving oddly, and a corner is where
            an app's version is looked for (lib/version.ts). */}
        <TopBar title={copy.about.title} back={route.groups()}
          right={<span className="topbarver">{copy.about.version}{VERSION}</span>} />
        <Scroll>
          <div className="pad about">
            <a className="aboutlink" href={feedback.sourceUrl}
              target="_blank" rel="noreferrer noopener">
              <Icon name="link" size={14} />{feedback.source}
            </a>

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
              <>
                <strong>{privacy.scanTitle}</strong> {privacy.scan}
                {" "}{privacy.scanOwnKey}{" "}<em>{privacy.scanOwnKeyWarning}</em>
              </>
            </Section>

            {/* Last, under the promises it is the other half of: a server that
                cannot read a group can still be asked to stop holding one.
                Written out and not linked, so getting there is deliberate
                (lib/copy.ts, deleteData.fromAbout). */}
            <AboutDelete />
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
 * links, or the sealed-row table. `AboutOffline` and `AboutDelete` draw their
 * own version of the same markup, their paragraphs not being fixed at build
 * time. A card apiece
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
