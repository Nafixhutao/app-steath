import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Dashboard HTML is authenticated UI that changes on every deploy. Next.js
  // marks prerendered routes with s-maxage=31536000, which keeps browsers on a
  // stale shell long after a new build ships. Keep these responses uncached.
  async headers() {
    return [
      // Applied to every route: the console and its APIs must not be framed
      // (no clickjacking), sniffed, or leak a Referer to third parties.
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
      {
        source: "/dashboard/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
  // The admin console moved out of the customer dashboard into the standalone
  // /admin area; old links keep working through these redirects.
  async redirects() {
    return [
      {
        source: "/dashboard/admin",
        destination: "/admin",
        permanent: true,
      },
      {
        source: "/dashboard/admin/:path*",
        destination: "/admin/:path*",
        permanent: true,
      },
      // The admin console had two duplicate routes: a second Overview and the old
      // host-metrics page. Both now serve the Forge pages, so old links redirect
      // instead of keeping a parallel implementation alive. Not permanent, so the
      // redirect stays reversible while the console is still being consolidated.
      {
        source: "/admin/overview",
        destination: "/admin",
        permanent: false,
      },
      {
        source: "/admin/host-metrics",
        destination: "/admin/infrastructure",
        permanent: false,
      },
    ];
  },
  watchOptions: {
    pollIntervalMs: 1000,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
