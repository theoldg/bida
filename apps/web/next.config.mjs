import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";

// Turbopack takes an alias as a path from the app, not an absolute one.
const scanicMl = "./" + relative(import.meta.dirname, join(
  dirname(createRequire(import.meta.url).resolve("scanic")), "scanic-mlDetector.js"));

// The app's one version (scripts/version.mjs), read from the root manifest at
// build time and inlined by `env` below, so a phone can say which build it is
// running without asking anything. Read rather than imported: a JSON import
// needs an attribute Next's own config loader has no reason to keep supporting.
const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_BIDA_VERSION: version },
  // Static export: the whole app is client-side and served as files by the
  // Worker. See docs/decisions/0004-static-export-and-offline.md — this
  // is why there are no route handlers, no middleware, and no dynamic params.
  output: "export",
  reactStrictMode: true,
  images: { unoptimized: true },
  // Only when `pnpm check --ci` runs the build beside its own typecheck, which
  // fails the same step: checking again here was a third of the build's time.
  typescript: { ignoreBuildErrors: process.env.BIDA_TYPECHECKED_BESIDE === "1" },
  transpilePackages: ["@bida/core"],
  turbopack: {
    // The scan's crop model, without the rest of scanic (lib/scan/scanic-ml.d.ts).
    resolveAlias: { "scanic/ml": scanicMl },
    rules: { "scanic-ort.wasm.min.js": { loaders: ["./loaders/ort-node-url.cjs"] } },
  },
};

export default nextConfig;
