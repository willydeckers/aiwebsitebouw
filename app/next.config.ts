import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Spec v9 section 2: static export, no dynamic routes, no Server
  // Actions/Middleware/Route Handlers — this is now a pure client-side SPA
  // against Supabase (data via RLS-scoped client calls, secret-requiring
  // logic moved to Supabase Edge Functions / the separate worker service).
  output: "export",
  images: { unoptimized: true },
  // Hides the Next.js dev-mode route indicator badge (bottom-left "N" logo)
  // — a dev-only overlay, not part of the app, but distracting for a
  // desktop tool that's meant to feel finished.
  devIndicators: false,
};

export default nextConfig;
