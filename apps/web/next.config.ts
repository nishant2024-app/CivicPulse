import path from "node:path";
import type { NextConfig } from "next";

const apiUrl = (process.env.API_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");
const isDev = process.env.NODE_ENV !== "production";

// Map tiles and styles for MapLibre come from OpenFreeMap (no API key).
const csp = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts; dev mode additionally needs eval for React refresh.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tiles.openfreemap.org",
  "font-src 'self' data:",
  "connect-src 'self' https://tiles.openfreemap.org",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const config: NextConfig = {
  output: "standalone",
  // In a monorepo the standalone server must trace files from the repository root.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@civicpulse/shared"],
  // The browser only ever talks to this origin; the API stays first-party for cookies.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
        ],
      },
    ];
  },
};

export default config;
