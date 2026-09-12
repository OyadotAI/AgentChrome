import type { NextConfig } from "next";

/**
 * Headers that do not vary per request. The Content-Security-Policy is NOT
 * here: it carries a per-request nonce and is set in src/middleware.ts.
 */
const SECURITY_HEADERS = [
  // frame-ancestors in the CSP is the modern form; X-Frame-Options is kept for
  // the proxies and scanners that still only read this one.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing in the console asks for any of these.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  // This is a running App Router application. Express owns /api and the
  // browser WebSockets; all frontend requests go to the Next.js runtime.
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
