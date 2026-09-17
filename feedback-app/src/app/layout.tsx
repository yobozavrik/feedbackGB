import type { Metadata, Viewport } from "next";
import { Manrope, Onest } from "next/font/google";
import Script from "next/script";
import { Suspense } from "react";
import "@/styles/globals.css";
import { PostHogProvider } from "@/components/PostHogProvider";
import { InteractionTracker } from "@/components/InteractionTracker";
import { ClientErrorReporter } from "@/components/ClientErrorReporter";

// T3: Onest reads better at small sizes in Cyrillic (taller x-height, more
// open "а/е/с", distinct "і/ї/й") than Inter, which this replaces.
const onest = Onest({
  subsets: ["latin", "cyrillic", "cyrillic-ext"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Галя слухає — фідбек",
  description:
    "Внутрішній інструмент для продавчинь Галя Балувана: швидкий фідбек про асортимент, постачання та ідеї.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // T7: matches --bg (F9F9FF) so there's no seam between the Telegram/browser
  // chrome and the page. The app is light-only for now (dark theme is tech
  // debt, see plan §13), so both entries point at the same light value.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f9ff" },
    { media: "(prefers-color-scheme: dark)", color: "#f9f9ff" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="uk"
      className={`${onest.variable} ${manrope.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Telegram Mini App SDK. Next.js 14 forces `beforeInteractive` scripts
            to live in the root layout — see
            https://nextjs.org/docs/app/api-reference/components/script#beforeinteractive
            The script is harmless on admin pages (small, no-op without
            `window.Telegram.WebApp`), and TelegramProvider in (app)/ relies on
            it being available as early as possible. */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
      </head>
      <body className="min-h-[var(--app-h)] font-sans antialiased">
        <Suspense fallback={null}>
          <PostHogProvider>
            <ClientErrorReporter />
            <InteractionTracker />
            {children}
          </PostHogProvider>
        </Suspense>
      </body>
    </html>
  );
}
