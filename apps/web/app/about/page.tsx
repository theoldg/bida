import Link from "next/link";
import type { ReactNode } from "react";
import { AboutDelete } from "@/components/about-delete";
import { AboutOffline } from "@/components/about-offline";
import { Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { Icon } from "@/components/icons";
import { copy } from "@/lib/copy";
import { route } from "@/lib/group-link";
import { VERSION } from "@/lib/version";

/**
 * Who can edit, whether it works on a train, where to complain, who can read
 * what you typed, what is and isn't promised, and — last, being the one nobody
 * should act on lightly — where to ask for a group to be erased.
 *
 * **Six claims, no pitch**: this screen is reached from the foot of the groups
 * list, so whoever is on it already has the app. Email and source sit above
 * them all, on one line, being the two things somebody might come looking for
 * on their own, and the build number sits in the bar's far corner, out of the
 * reading.
 *
 * Prose and links, so it stays a server component. The two sections whose
 * sentences aren't fixed at build time draw themselves — `AboutOffline`, which
 * depends on whether the phone already did it, and `AboutDelete`, which names
 * the host it is being read from.
 */
export default function AboutPage() {
  const { feedback, privacy, guarantees } = copy.about;
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
            {/* Email and source, together on one line: the two doors out of
                the app that somebody might come looking for on their own,
                ahead of the six claims rather than one of them. */}
            <div className="aboutcontact">
              <a className="aboutlink" href={`mailto:${feedback.email}`}>
                <Icon name="mail" size={14} />{feedback.emailLabel}
              </a>
              <a className="aboutlink" href={feedback.sourceUrl}
                target="_blank" rel="noreferrer noopener">
                <Icon name="link" size={14} />{feedback.source}
              </a>
            </div>

            <Section title={copy.about.noAccounts.title}>{copy.about.noAccounts.body}</Section>

            <AboutOffline />

            {/* The mailto above is the door; a form needs an endpoint, an
                inbox and a spam story, and the address is the whole of what
                it would have sent. */}
            <Section title={feedback.title}>{feedback.body}</Section>

            {/* Led by its own bold sentence, ahead of the paragraph it is an
                exception to: the photograph leaves for somebody else's server
                entirely, and it is the one thing about this app that is not
                sealed. Said after the rest, it would read like a footnote. */}
            <Section title={privacy.title} under={
              <>
                <p><strong>{privacy.importTitle}</strong> {privacy.import}</p>
                <p> <strong> {privacy.e2eTitle} </strong> {privacy.body}</p>
                <SealedRow />
                <p>{privacy.key}</p>
                <p>{privacy.shape}</p>
              </>
            }>
              <>
                <strong>{privacy.scanTitle}</strong> {privacy.scan}{" "}
                {/* The way out of the rate limits is the last clause of the
                    paragraph it belongs to, not a paragraph of its own: it is
                    an aside about scanning, and set apart it read as a second
                    claim. */}
                {privacy.ownKeyPointer}{" "}
                <Link href={route.advanced()}>{copy.advanced.key.title}</Link>.
              </>
            </Section>

            {/* After the sealed row, because the sentence that matters here
                — a lost link is a group nobody can recover — is a consequence
                of it rather than a disclaimer that happens to sit nearby. */}
            <Section title={guarantees.title} under={
              <ul className="warnlist">
                <li><Icon name="info" size={14} />{guarantees.warnings[0]}</li>
                {/* One span around the whole sentence: the row is a two-column
                    grid, so a bare <Link> beside the text would be a third grid
                    item and start its own row under the icon. */}
                <li><Icon name="info" size={14} />
                  <span>
                    {guarantees.scanBreaks.lede}
                    <Link href={route.support()}>{guarantees.scanBreaks.link}</Link>
                    {guarantees.scanBreaks.tail}
                  </span>
                </li>
                <li><Icon name="info" size={14} />{guarantees.warnings[1]}</li>
              </ul>
            }>{guarantees.lede}</Section>

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
 * you see?", shown instead of asserted. A table rather than the JSON it really
 * is — the reader is somebody splitting a dinner bill, and braces would make it
 * look like a developer's aside rather than the short row it is.
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
 * One claim: its heading, its paragraph, and whatever hangs under that — links,
 * or the sealed-row table. `AboutOffline` and `AboutDelete` draw their own
 * version of the same markup, their paragraphs not being fixed at build time.
 * **No card apiece** — that makes a settings list out of something read top to
 * bottom, once.
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
