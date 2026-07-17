import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hides the Next.js dev-mode route indicator badge (bottom-left "N" logo)
  // — a dev-only overlay, not part of the app, but distracting for a
  // desktop tool that's meant to feel finished.
  devIndicators: false,
};

export default nextConfig;
