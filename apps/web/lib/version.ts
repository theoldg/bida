/**
 * What this build calls itself: `major.semi.minor`, shown on `/about` and the
 * first line of `/diag`. Lives in the root `package.json`, inlined here at
 * build time by `next.config.mjs` — the only line of a pasted diagnostics
 * report that says which code the phone is running.
 *
 * `0.0.0` is not a release: it means the build lost the inlining, which a bare
 * `vitest` or a stray bundler does. Shipped versions start at `0.1.0`
 * (scripts/version.mjs).
 */
export const VERSION = process.env.NEXT_PUBLIC_BIDA_VERSION ?? "0.0.0";
