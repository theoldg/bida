/** @type {import('next').NextConfig} */
const nextConfig = {
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
    return config;
  },
};

export default nextConfig;
