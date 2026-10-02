import type { Metadata } from "next";
import { copy } from "@/lib/copy";

/**
 * The card a chat app draws for a pasted link (docs/pwa.md). A route that sets
 * `openGraph` replaces the root's whole object rather than merging into it, so
 * every route builds its card here and only the title differs.
 *
 * Static, and nothing about a group: the secret is in the fragment, which
 * never reaches a scraper, and the server cannot read a group (ADR-0036).
 */
export function preview(title: string): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: {
      type: "website",
      siteName: copy.app.name,
      title,
      description: copy.app.description,
      // **No `og:url`** — as a root default every route would claim to be
      // `https://bida.bid`, and Messenger on iOS then pastes an invite as that bare
      // origin, path and fragment gone. Without it a scraper uses the fetched URL.
      //
      // **A wide banner, not the square icon**: a square puts most chat apps in
      // their compact card, a thumbnail the size of an emoji. The page cannot pick
      // an image per app, so one 1200×630 keeps its point inside the centre square
      // some crop to. Drawn by `pnpm icons` from design/brand/banner.svg.
      images: [{ url: "/og.png", width: 1200, height: 630, alt: copy.app.banner }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: copy.app.description,
      images: [{ url: "/og.png", alt: copy.app.banner }],
    },
  };
}
