import { TelegramProvider } from "@/components/TelegramProvider";
import { OfflineSyncProvider } from "@/components/OfflineSyncProvider";

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
      <OfflineSyncProvider>
        <div className="relative mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-10 pt-5 sm:px-6">
          {children}
        </div>
      </OfflineSyncProvider>
    </TelegramProvider>
  );
}
