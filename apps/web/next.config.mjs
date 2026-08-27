/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the whole app is client-side and served as files by the
  // Worker. See docs/decisions/0004-static-export-fragment-routing.md — this
  // is why there are no route handlers, no middleware, and no dynamic params.
  output: "export",
  reactStrictMode: true,
  images: { unoptimized: true },
  transpilePackages: ["@hajsik/core"],
};

export default nextConfig;
