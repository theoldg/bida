"use client";

import { copy } from "../lib/copy";
import { route } from "../lib/group-link";
import { useHost } from "../lib/hooks";

/**
 * The about screen's "Delete your data" section: the address, written out and
 * not linked, so reaching the screen that destroys a group costs typing.
 *
 * A client island for the reason `AboutOffline` is one — the sentence isn't
 * fixed at build time. Which server holds the group is whichever host this
 * copy of the app was opened from, which is `useHost`'s whole subject.
 */
export function AboutDelete() {
  const host = useHost();
  const { fromAbout } = copy.deleteData;

  return (
    <section className="aboutsect">
      <h4>{fromAbout.title}</h4>
      <p>{fromAbout.body(`${host}${route.deleteMyData()}`)}</p>
    </section>
  );
}
