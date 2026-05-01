import Script from "next/script";
import { TelegramProvider } from "@/components/TelegramProvider";

/**
 * Layout для Telegram Mini App (продавчині).
 * Тримає вузький мобільний контейнер, telegram-web-app SDK
 * та TelegramProvider з валідацією initData.
 */
export default function MiniAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="beforeInteractive"
      />
      <TelegramProvider>
        <div className="relative mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-10 pt-5 sm:px-6">
          {children}
        </div>
      </TelegramProvider>
    </>
  );
}
