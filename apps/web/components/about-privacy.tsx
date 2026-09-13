"use client";

import { useState } from "react";
import { Icon } from "./icons";
import { copy } from "../lib/copy";

/**
 * The last thing on the about screen, and the only folded one.
 *
 * It is the longest section and the one fewest people want: someone splitting a
 * dinner bill does not need a stored database row to use the app, and a wall of
 * cryptography above the feedback address would push the address off the screen
 * for everybody. Folded and last, it costs one line until it is asked for, and
 * the person who *does* ask "who can read this?" still finds the answer without
 * leaving the app.
 *
 * Shut by default for the same reason. What is behind it is reassurance, not a
 * warning — the one thing here that is a warning, the receipt scan, is also the
 * one thing the app says again at the point it matters, on the scan screen.
 */
export function AboutPrivacy() {
  const [open, setOpen] = useState(false);
  const { privacy } = copy.about;

  return (
    <section className="aboutsect">
      <button type="button" className="aboutfold" aria-expanded={open}
        onClick={() => setOpen(!open)}>
        <h4>{privacy.title}</h4>
        <Icon name="chev" size={11} className={`kvchev${open ? " on" : ""}`} />
      </button>
      {open ? (
        <div className="aboutfolded">
          <p>{privacy.body}</p>
          <SealedRow />
          <p>{privacy.key}</p>
          <p>{privacy.shape}</p>
          {/* The scan line is set apart and led by its own bold sentence: the
              photograph leaves for somebody else's server entirely, and it is
              the one thing about this app that is not sealed. An exception
              buried in a paragraph is a lie. */}
          <p className="aboutwarn"><strong>{privacy.scanTitle}</strong> {privacy.scan}</p>
        </div>
      ) : null}
    </section>
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
