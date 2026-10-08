import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: { "/*": ["./.env*", "./reconstruction/**/.env*"] },
  async headers() {
    return [{ source: "/sw.js", headers: [
      { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      { key: "Content-Type", value: "application/javascript; charset=utf-8" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ] }];
  },
  logging: { incomingRequests: { ignore: [/\/api\/auth\/callback\//] } },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
