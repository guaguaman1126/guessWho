import type { NextConfig } from "next";
const config: NextConfig = { transpilePackages: ["@guesswho/shared"], devIndicators: false, distDir: process.env.NEXT_DIST_DIR ?? ".next" };
export default config;
