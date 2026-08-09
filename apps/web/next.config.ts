import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The tokens package ships TypeScript source rather than a build artefact.
  transpilePackages: ["@werft/tokens"],
  experimental: {
    serverActions: {
      // Statement uploads go through a server action, and the default cap is
      // 1 MB — a year of one account's CSV clears that easily, and the failure
      // arrives as an opaque error rather than "your file is too big".
      bodySizeLimit: "8mb",
    },
  },
}

export default nextConfig
