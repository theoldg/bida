import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ReadErrorBoundary } from "@/components/chrome";
import { IconSprite } from "@/components/icons";
import { MeasureViewport } from "@/components/viewport";
import { NoLongPress } from "@/components/no-long-press";
import { NoPinchZoom } from "@/components/no-pinch-zoom";
import { RegisterServiceWorker } from "@/components/register-sw";
import { StartSync } from "@/components/start-sync";
import { ThemeScript } from "@/components/theme";
import { copy } from "@/lib/copy";
import { arrivalScript } from "@/lib/diag";
import { manifestScript, type WebManifest } from "@/lib/install";
import { CarryToHomeScreen } from "@/components/install";
import { EmbeddedGate } from "@/components/embedded";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// One face for the whole app; hierarchy is weight and tracking. Self-hosted
// by next/font at build time, so the PWA renders offline.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: copy.app.name,
  description: copy.app.description,
  // **A link to this app is nearly always sent in a chat**, so the preview card
  // is the first thing anyone sees. The tags are static and say nothing about a
  // group: the secret lives in the fragment, which never reaches a scraper.
  //
  // Absolute URLs via `metadataBase`, pinned to production: the build is
  // byte-identical on both Workers (docs/hosting.md#dev-and-production) and
  // only production links get shared.
  metadataBase: new URL("https://bida.bid"),
  openGraph: {
    type: "website",
    siteName: copy.app.name,
    title: copy.app.name,
    description: copy.app.description,
    // **No `og:url`** — as a root default every route would claim to be
    // `https://bida.bid`, and Messenger on iOS then pastes an invite as that bare
    // origin, path and fragment gone. Without it a scraper uses the fetched URL.
    // The 512 rather than the 192: Facebook drops images under 200px.
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: copy.app.name }],
  },
  // "summary", not "summary_large_image": the icon is square, and a square
  // stretched across a wide card is a logo with bars either side of it.
  twitter: {
    card: "summary",
    title: copy.app.name,
    description: copy.app.description,
    images: ["/icon-512.png"],
  },
  // No `manifest`: `manifestScript` writes the link first in the head, because
  // an iOS tab needs a different one. **Name the icons**, or every cold load
  // takes a /favicon.ico 404.
  icons: {
    icon: [{ url: "/icon-192.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/icon-192.png", sizes: "192x192" }],
  },
  // "default", so iOS lays the app out below the status bar. **Not
  // "black-translucent"**: it draws from the top but still takes the bar off the
  // height (iOS 26, WebKit bug 301108), stranding an unpaintable bottom strip.
  appleWebApp: { capable: true, title: copy.app.name, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // A pinch is a mis-grip, and zoom strands the fixed bottom bar. Android
  // honours this; iOS Safari only once installed, so CSS `touch-action` and
  // `NoPinchZoom` finish the job.
  maximumScale: 1,
  userScalable: false,
  // **One colour, never per-theme**, matching the manifest's theme_color: the
  // installed Android status bar is painted from the manifest and this tag only
  // picks icon contrast. Per-theme tags give white on white. docs/pwa.md#gotchas.
  themeColor: "#0E0F11",
};

/** Read at build: the static export renders this layout once per page. */
const manifest = JSON.parse(
  readFileSync(join(process.cwd(), "public/manifest.webmanifest"), "utf8"),
) as WebManifest;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` covers only this element's attributes, for
    // `data-theme`, which <ThemeScript /> writes before React runs
    // (components/theme.tsx). The export is prerendered light, so a dark phone
    // genuinely disagrees with the server HTML.
    <html lang="en" className={mono.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: manifestScript(manifest) }} />
      </head>
      <body>
        <ThemeScript />
        {/* The URL this load arrived at, before the router can change it (lib/diag.ts). */}
        <script dangerouslySetInnerHTML={{ __html: arrivalScript }} />
        <IconSprite />
        <MeasureViewport />
        <NoLongPress />
        <NoPinchZoom />
        {/* An in-app browser gets the way out of it and nothing else — the
            worker, the sync loop and the carry included, since none of them
            has anywhere to keep what it does (components/embedded.tsx). */}
        <EmbeddedGate>
          <RegisterServiceWorker />
          <StartSync />
          <CarryToHomeScreen />
          {/* Every screen, including the two that carry no QueryBoundary. */}
          <ReadErrorBoundary>{children}</ReadErrorBoundary>
        </EmbeddedGate>
      </body>
    </html>
  );
}
