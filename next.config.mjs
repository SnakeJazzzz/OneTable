// Security headers (hardening T2): the pure builder lives in
// lib/security-headers.ts — this config only consumes it. The explicit
// `.ts` extension is required: Node loads this file natively and resolves
// the TypeScript module via type stripping (default-on since Node
// 22.18/23.6; CI builds on Node 24).
import {
  buildSecurityHeaders,
  resolveCspEnv,
} from './lib/security-headers.ts';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // T6 (ZAP Z-8): drop the `X-Powered-By: Next.js` fingerprinting header.
  // No unit test can see this (runtime server behavior, not the builder);
  // verified via curl on the preview/prod deploy.
  poweredByHeader: false,
  async headers() {
    // VERCEL_ENV is resolved at BUILD time — preview and production are
    // separate builds, so each gets its own CSP mode (T2 brief §2.3).
    const env = resolveCspEnv(process.env.VERCEL_ENV);
    return [
      {
        source: '/(.*)',
        headers: buildSecurityHeaders(env),
      },
    ];
  },
};

export default nextConfig;
