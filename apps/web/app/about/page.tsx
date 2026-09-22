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
 * Who can edit, whether it works offline, where to complain, who can read what
 * you typed, what is promised, and — last — where to ask for a group to be
 * erased.
 *
 * **Six claims, no pitch**: whoever is here already has the app. Email and
 * source sit above them on one line; the build number is in the bar's corner.
 *
 * A server component. `AboutOffline` (depends on the phone) and `AboutDelete`
 * (names the host) draw themselves.
 */
export default function AboutPage() {
  const { feedback, privacy, guarantees } = copy.about;
  return (
    <Screen>
      <Body>
        {/* The version in the bar's corner, where an app's version is looked for
            — the first thing to know about a phone behaving oddly (lib/version.ts). */}
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

            {/* Led by its own bold sentence: the photograph leaves for somebody
                else's server, the one thing that isn't sealed. After the rest it
                would read like a footnote. */}
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
                {/* The own-key pointer is the paragraph's last clause, an aside about
                    scanning, not a claim of its own. */}
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

            {/* Last, under the promises it completes. Written out, not linked, so
                getting there is deliberate (lib/copy.ts, deleteData.fromAbout). */}
            <AboutDelete />
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}

/**
 * One saved expense as the database holds it: "what can you see?" shown, not
 * asserted. A table, not the JSON it is — braces read as a developer aside.
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
 * One claim: heading, paragraph, and whatever hangs under it.
 * `AboutOffline` and `AboutDelete` repeat this markup. **No card apiece** —
 * that turns reading into a settings list.
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
