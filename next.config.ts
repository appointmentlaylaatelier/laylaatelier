import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Next.js scoped to this app even if a parent folder contains another lockfile.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
