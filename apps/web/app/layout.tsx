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

// One face for the whole app — headings, prose and figures alike; hierarchy is
// carried by weight and tracking instead. Self-hosted at build time by
// next/font, so nothing is fetched from Google at runtime, which matters for a
// PWA that has to render offline.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: copy.app.name,
  description: copy.app.description,
  // **A link to this app is nearly always sent in a chat**, so the card the
  // chat app draws around it is the first thing anyone sees of bida — and with
  // no Open Graph tags it drew a bare one: a title if the scraper bothered to
  // parse the head, no icon, and different every time depending on what it had
  // cached. The tags are static and say nothing about the group: the secret
  // lives in the fragment, which never leaves the phone, and a scraper reading
  // `/join` learns only that bida exists.
  //
  // Absolute URLs, via `metadataBase` — a crawler has no page to resolve a
  // relative one against. Pinned to production rather than read from the
  // environment, because the build is byte-identical on both Workers
  // (docs/hosting.md#dev-and-production) and only production's links get sent
  // to anybody.
  metadataBase: new URL("https://bida.bid"),
  openGraph: {
    type: "website",
    siteName: copy.app.name,
    title: copy.app.name,
    description: copy.app.description,
    // **No `og:url`** — it is a root-level default, so every route would claim
    // to be `https://bida.bid`. An invite pasted into Messenger on iOS arrives
    // as exactly that bare origin, path and fragment gone, where the same paste
    // on Android keeps the whole link — and this is the only string we hand a
    // scraper that matches it. Left out, a scraper uses the URL it fetched; the
    // card these tags exist for never needed it.
    // The 512 rather than the 192: Facebook drops an image under 200px, and
    // this is the icon the app is already installed under.
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
  // No `manifest`: `manifestScript` writes the link first thing in the head,
  // because an iOS tab needs a different one there before Safari reads it.
  // **Name the icons**, or every cold load asks for /favicon.ico and takes a
  // 404 — a wasted request on the visit that can least afford one. The PWA
  // icons are already on disk; point at them rather than adding a file.
  icons: {
    icon: [{ url: "/icon-192.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/icon-192.png", sizes: "192x192" }],
  },
  // "default", so iOS lays the app out below the status bar rather than under
  // it. **Not "black-translucent"**: it draws from the top of the screen but
  // still takes the bar off the height (iOS 26, WebKit bug 301108), stranding
  // a strip nothing can paint at the bottom.
  appleWebApp: { capable: true, title: copy.app.name, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // A pinch on a ledger is a mis-grip: the layout is already sized for a thumb,
  // and a zoomed page strands the fixed bottom bar off-screen. Android honours
  // this pair; iOS Safari ignores it in a tab (but obeys once installed), so
  // CSS `touch-action` and `NoPinchZoom` finish the job.
  maximumScale: 1,
  userScalable: false,
  // **One colour, never per-theme**, and the same value as the manifest's
  // theme_color: an installed Android app paints its status bar from the
  // manifest, and this tag only decides whether the icons on it are light or
  // dark. Media-scoped or toggled tags flip the icons over a bar that cannot
  // follow — white on white. See frontend.md#gotchas.
  themeColor: "#0E0F11",
};

/** Read at build: the static export renders this layout once per page. */
const manifest = JSON.parse(
  readFileSync(join(process.cwd(), "public/manifest.webmanifest"), "utf8"),
) as WebManifest;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` is for one attribute only: `data-theme`,
    // which <ThemeScript /> writes before React runs (components/theme.tsx).
    // The export is prerendered light, so on a phone set to dark the server
    // HTML and the hydrating client genuinely disagree — the alternative is a
    // flash of paper white. It covers this element's own attributes, not its
    // subtree, so a real mismatch inside the app still reports itself.
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
