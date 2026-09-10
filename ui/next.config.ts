import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // This is a running App Router application. Express owns /api and the
  // browser WebSockets; all frontend requests go to the Next.js runtime.
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
};

export default nextConfig;
