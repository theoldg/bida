import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ReadErrorBoundary } from "../components/chrome";
import { IconSprite } from "../components/icons";
import { MeasureViewport } from "../components/viewport";
import { NoLongPress } from "../components/no-long-press";
import { NoPinchZoom } from "../components/no-pinch-zoom";
import { RegisterServiceWorker } from "../components/register-sw";
import { StartSync } from "../components/start-sync";
import { ThemeScript } from "../components/theme";
import { copy } from "../lib/copy";
import { arrivalScript } from "../lib/diag";
import { manifestScript, type WebManifest } from "../lib/install";
import { CarryToHomeScreen } from "../components/install";
import { EmbeddedGate } from "../components/embedded";
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
  // No `manifest`: `manifestScript` writes the link, first thing in the head,
  // because an iOS tab needs a different one there before Safari reads it.
  // Without this every cold load asks for /favicon.ico and takes a 404 for
  // it — a wasted request on the one visit that can least afford one. The
  // PWA icons are already on disk; point at them rather than adding a file.
  icons: {
    icon: [{ url: "/icon-192.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/icon-192.png", sizes: "192x192" }],
  },
  // "default", so iOS lays the app out below the status bar rather than under
  // it. "black-translucent" drew from the top of the screen but still took the
  // bar off the height (iOS 26, WebKit bug 301108), stranding a strip nothing
  // can paint at the bottom, and iOS blurs the top bar it draws over.
  appleWebApp: { capable: true, title: copy.app.name, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // A pinch on a ledger is a mis-grip, not a request to zoom: the layout is
  // already sized for a thumb, and a zoomed page strands the fixed bottom bar
  // off-screen with no obvious way back. Android honours this pair; iOS Safari
  // ignores it in a tab (it obeys it once installed to the home screen), so
  // CSS `touch-action` and `NoPinchZoom` finish the job.
  maximumScale: 1,
  userScalable: false,
  // One colour, deliberately not per-theme, and the same value as the
  // manifest's theme_color: an installed Android app paints its status bar
  // from the manifest and this tag only decides whether the icons on it are
  // light or dark. Media-scoped or toggled tags flip the icons over a bar
  // that cannot follow — white on white. See frontend.md#gotchas.
  themeColor: "#0E0F11",
};

/** Read at build: the static export renders this layout once per page. */
const manifest = JSON.parse(
  readFileSync(join(process.cwd(), "public/manifest.webmanifest"), "utf8"),
) as WebManifest;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` is here for one attribute and one only:
    // `data-theme`, which <ThemeScript /> writes before React ever runs (see
    // components/theme.tsx). The export is prerendered light, so on a phone
    // set to dark the server HTML and the hydrating client genuinely
    // disagree — deliberately, because the alternative is a flash of paper
    // white. It suppresses this element's own attributes, not its subtree, so
    // a real mismatch inside the app still reports itself.
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
