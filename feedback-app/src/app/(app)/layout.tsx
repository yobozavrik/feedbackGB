import { TelegramProvider } from "@/components/TelegramProvider";

/**
 * Layout для Telegram Mini App (продавчині).
 * Тримає вузький мобільний контейнер та TelegramProvider з валідацією initData.
 *
 * Сам telegram-web-app SDK завантажується з кореневого layout
 * (Next.js 14 не підтримує `<Script strategy="beforeInteractive">` у вкладених
 * layout-ах — див. коментар у `src/app/layout.tsx`).
 */
export default function MiniAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TelegramProvider>
      <div className="relative mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-10 pt-5 sm:px-6">
        {children}
      </div>
    </TelegramProvider>
  );
}
