#!/usr/bin/env node
/**
 * Pre-build: copy scanic's ML model and its runtime out of node_modules into
 * `public/scanic/<version>/`, so the Worker serves them and no scan depends on
 * a CDN. Copied rather than committed: 3.4 MB of binary nobody should diff.
 * `lib/scan/find-bill.ts` names the same version; its test holds them together.
 */
import { cp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const pkgPath = createRequire(import.meta.url).resolve("scanic-ml/package.json");
const { version } = JSON.parse(await readFile(pkgPath, "utf8"));
const out = resolve(import.meta.dirname, "../public/scanic");
await rm(out, { recursive: true, force: true });
await cp(join(dirname(pkgPath), "dist"), join(out, version), { recursive: true });
