import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files; load it from node_modules instead of bundling it.
  serverExternalPackages: ["@electric-sql/pglite"],
  // The hosted deployment only serves the connector API (/api/connector/*). The app itself runs on people's computers.
  async redirects() {
    if (!process.env.VERCEL) return [];
    return ["/", "/capture", "/history", "/settings"].map((source) => ({ source, destination: "https://publikhq.com/looseends", permanent: false }));
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
