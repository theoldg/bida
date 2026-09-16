import type { Metadata } from "next";
import { lateManifestScript } from "../../lib/install";

/**
 * `/install` ships with no manifest in its HTML, and puts one in by script only
 * when it isn't the page iOS bookmarks invites from.
 *
 * On a real iPhone the icon opened at `/` — the static manifest's start_url —
 * although the tab had swapped in the invites' manifest 41ms after load. So
 * Safari reads the manifest link at load, before any effect can touch it
 * (docs/ios.md#gotchas). With nothing in the head it has nothing to read early:
 * asked at the share sheet it finds the invites' manifest, and asked at load
 * it finds none and bookmarks the page URL, fragment and all.
 */
export const metadata: Metadata = { manifest: null };

export default function InstallLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: lateManifestScript }} />
      {children}
    </>
  );
}
