/** @type {import('next').NextConfig} */

const csp = [
  "default-src 'self'",
  "img-src 'self' data: blob: https:",
  // 'unsafe-inline' on scripts is needed for Next.js inline bootstrap; we keep
  // it narrow by pinning script-src to self + telegram.org.
  "script-src 'self' 'unsafe-inline' https://telegram.org",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://telegram.org",
  // Telegram Mini App runs inside an iframe from web.telegram.org / *.telegram.org.
  "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig = {
  experimental: {
    typedRoutes: false,
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
          { key: "Content-Security-Policy", value: csp },
          // We rely on CSP `frame-ancestors` rather than X-Frame-Options,
          // since X-Frame-Options=DENY would break the Telegram Mini App iframe.
        ],
      },
    ];
  },
};

export default nextConfig;
