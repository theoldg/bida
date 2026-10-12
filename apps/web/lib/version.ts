// Doc: docs/hosting.md#versions
/**
 * What this build calls itself, inlined from the root `package.json` at build
 * time. `0.0.0` is not a release: it means the build lost the inlining, which
 * a bare `vitest` or a stray bundler does.
 */
export const VERSION = process.env.NEXT_PUBLIC_BIDA_VERSION ?? "0.0.0";
