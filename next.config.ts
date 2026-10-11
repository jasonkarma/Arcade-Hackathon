import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hostname-only entries (no scheme, no port), matched against the Origin/Referer
  // hostname. localtunnel subdomains look like `real-snakes-beg.loca.lt`.
  allowedDevOrigins: ["*.loca.lt"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    // Without this, Turbopack walks up to /Users/karma for a lockfile and warns.
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
