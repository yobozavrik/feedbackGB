import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "@/styles/globals.css";
import { TelegramProvider } from "@/components/TelegramProvider";

export const metadata: Metadata = {
  title: "Галя слухає — фідбек",
  description:
    "Внутрішній інструмент для продавчинь Галя Балувана: швидкий фідбек про асортимент, постачання та ідеї.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FFE4EC",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="uk">
      <head>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        <TelegramProvider>
          <div className="relative mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-10 pt-6 sm:px-6">
            {children}
          </div>
        </TelegramProvider>
      </body>
    </html>
  );
}
