"use client";

import { useEffect, useState } from "react";
import { copy } from "../lib/copy";
import { route } from "../lib/group-link";

/**
 * The about screen's "Delete your data" section: the address, written out and
 * not linked, so reaching the screen that destroys a group costs typing.
 *
 * A client island for the reason `AboutOffline` is one — the sentence isn't
 * fixed at build time. Which server holds the group is whichever host this
 * copy of the app was opened from (the dev Worker is its own), and only the
 * browser knows it. Until the bundle lands the sentence names the path alone,
 * which is still the right address from where it is being read.
 */
export function AboutDelete() {
  const [host, setHost] = useState("");
  useEffect(() => setHost(location.host), []);
  const { fromAbout } = copy.deleteData;

  return (
    <section className="aboutsect">
      <h4>{fromAbout.title}</h4>
      <p>{fromAbout.body(`${host}${route.deleteMyData()}`)}</p>
    </section>
  );
}
