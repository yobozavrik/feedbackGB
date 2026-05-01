import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import Script from "next/script";
import { Suspense } from "react";
import "@/styles/globals.css";
import { PostHogProvider } from "@/components/PostHogProvider";

const inter = Inter({
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdf8f3" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1313" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="uk" className={`${inter.variable} ${manrope.variable}`}>
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
      <body className="min-h-dvh font-sans antialiased">
        <Suspense fallback={null}>
          <PostHogProvider>{children}</PostHogProvider>
        </Suspense>
      </body>
    </html>
  );
}
