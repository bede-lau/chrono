import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets parallel agents run isolated dev servers: NEXT_DIST_DIR=.next-ui npx next dev -p 3101
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
