import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // watch-face owns /_next behind the gateway; back-stage's chunks need their own path or its pages never hydrate.
  assetPrefix: "/back-stage-assets",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  transpilePackages: ["@hyper-clock/ha-console"],
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),
  turbopack: { root: path.join(import.meta.dirname, "..") },
  experimental: { serverActions: { bodySizeLimit: "512kb" } },
};
export default nextConfig;
