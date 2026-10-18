// Doc: docs/scan-worker.md
/**
 * scanic's ONNX runtime names its own file with `new URL("ort.wasm.min.mjs",
 * import.meta.url)` on a branch only Node takes (`import.meta.url` is `file:`),
 * and Turbopack, reading every such URL as an asset to emit, fails on a file the
 * package does not ship. Its base wrapped in `String()` is the same URL but no
 * longer the pattern, and the line is never run in a browser. Throws rather than passing through, so a scanic update that
 * moves the line fails the build instead of the scan.
 */
const NODE_ONLY = 'new URL("ort.wasm.min.mjs",import.meta.url)';

module.exports = function ortNodeUrl(source) {
  if (!source.includes(NODE_ONLY)) {
    throw new Error(`ort-node-url: ${NODE_ONLY} is gone from ${this.resourcePath}; see docs/scan-worker.md`);
  }
  return source.replace(NODE_ONLY, 'new URL("ort.wasm.min.mjs",String(import.meta.url))');
};
