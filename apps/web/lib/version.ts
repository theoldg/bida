/**
 * What this build calls itself: `major.semi.minor`, shown on `/about` and
 * printed as the first line of `/diag`.
 *
 * The number lives in the root `package.json` and is inlined here at build time
 * by `next.config.mjs`. It is the only thing a pasted diagnostics report can be
 * read against — every other line in it describes a phone, and none of them say
 * which code that phone is running.
 *
 * `0.0.0` is not a release: it means the build lost the inlining, which is what
 * a bare `vitest` or a stray bundler does. Versions this project ships start at
 * `0.1.0` (scripts/version.mjs).
 */
export const VERSION = process.env.NEXT_PUBLIC_BIDA_VERSION ?? "0.0.0";
