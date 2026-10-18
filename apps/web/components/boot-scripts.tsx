"use client";
// Doc: docs/pwa.md
/**
 * The layout's inline scripts, which run from the exported HTML before React
 * does. A client component for the same reason as icon-sprite.tsx: a server one
 * serialized their text into every page's RSC payload as well as its HTML; here
 * the payload holds a reference, and the text sits once in a hashed chunk.
 * Hydration leaves a `<script>` alone, so nothing runs twice.
 */
import { ThemeScript } from "./theme";
import { arrivalScript } from "@/lib/diag";
import { firstFrameScript } from "@/lib/first-frame";
import { manifestScript, type WebManifest } from "@/lib/install";
import { handoverScript } from "@/lib/group-link";

export function HeadScripts({ manifest }: { manifest: WebManifest }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: manifestScript(manifest) }} />
      {/* An in-app browser's address opened in Safari, before anything paints (lib/group-link.ts). */}
      <script dangerouslySetInnerHTML={{ __html: handoverScript }} />
    </>
  );
}

export function BodyScripts() {
  return (
    <>
      <ThemeScript />
      {/* Before the body paints: a launch marks the frame it will show, so the
          route's own exported HTML never flashes first (lib/first-frame.ts). */}
      <script dangerouslySetInnerHTML={{ __html: firstFrameScript }} />
      {/* The URL this load arrived at, before the router can change it (lib/diag.ts). */}
      <script dangerouslySetInnerHTML={{ __html: arrivalScript }} />
    </>
  );
}
