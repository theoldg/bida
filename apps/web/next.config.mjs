import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const scanicMl = join(
  dirname(createRequire(import.meta.url).resolve("scanic")), "scanic-mlDetector.js");

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
  transpilePackages: ["@bida/core"],
  webpack(config) {
    // packages/core imports its siblings as "./hlc.js" etc — valid under
    // TS's "bundler" moduleResolution (which tsc/next dev understand), but
    // webpack's production build doesn't map .js imports back to .ts files
    // without this.
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    // The scan's crop model, without the rest of scanic (lib/scan/scanic-ml.d.ts).
    config.resolve.alias["scanic/ml"] = scanicMl;
    // Its ONNX runtime names a worker file with `new URL(…, import.meta.url)`
    // on a path only Node takes; left to webpack, that is a missing module.
    config.module.rules.push({ test: /scanic-ort\.wasm\.min\.js$/, parser: { url: false } });
    return config;
  },
};

export default nextConfig;
