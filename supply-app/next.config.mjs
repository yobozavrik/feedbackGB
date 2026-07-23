/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV === "development";
const scriptSrc = [
  "'self'",
  "'unsafe-inline'",
  "https://telegram.org",
  ...(isDev ? ["'unsafe-eval'"] : []),
].join(" ");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
let supabaseConnect = "https://*.supabase.co wss://*.supabase.co";
if (supabaseUrl) {
  try {
    const urlObj = new URL(supabaseUrl);
    const wsProto = urlObj.protocol === "https:" ? "wss:" : "ws:";
    supabaseConnect += ` ${supabaseUrl} ${wsProto}//${urlObj.host}`;
  } catch {
    // ignore malformed URL — fall back to the wildcard hosts above
  }
}

// CSP relies on `frame-ancestors` (not X-Frame-Options) so the Telegram Mini
// App iframe from web.telegram.org keeps working. X-Frame-Options SAMEORIGIN
// would break that embedding — see docs/supply-app/ADR/0001-two-channel-app.md.
const csp = [
  "default-src 'self'",
  "img-src 'self' data: blob: https:",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${supabaseConnect} https://telegram.org`,
  "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig = {
  // Compile imports from the repo-level shared/ directory (single source for
  // lib code reused across feedback-app, feedback-admin and supply-app).
  experimental: { externalDir: true },
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
        ],
      },
    ];
  },
};

export default nextConfig;
