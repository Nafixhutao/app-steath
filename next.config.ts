import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
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
