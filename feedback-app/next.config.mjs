/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV === "development";
const scriptSrc = [
  "'self'",
  "'unsafe-inline'",
  "https://telegram.org",
  "https://*.i.posthog.com",
  ...(isDev ? ["'unsafe-eval'"] : []),
].join(" ");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
let supabaseConnect = "https://*.supabase.co wss://*.supabase.co";

if (supabaseUrl) {
  try {
    const urlObj = new URL(supabaseUrl);
    const host = urlObj.host;
    const wsProto = urlObj.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProto}//${host}`;
    supabaseConnect += ` ${supabaseUrl} ${wsUrl}`;
  } catch (e) {
    // Ignore
  }
}

const csp = [
  "default-src 'self'",
  "img-src 'self' data: blob: https:",
  // In development Next.js react-refresh needs eval; keep it disabled in production.
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${supabaseConnect} https://telegram.org https://*.i.posthog.com https://*.posthog.com`,
  // Telegram Mini App runs inside an iframe from web.telegram.org / *.telegram.org.
  "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig = {
  experimental: {
    typedRoutes: false,
    // Compile imports from the repo-level shared/ directory (single source
    // for lib code duplicated across both apps).
    externalDir: true,
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
