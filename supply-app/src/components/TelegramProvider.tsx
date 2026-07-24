"use client";

// Supply-app shim. The seller feedback-app version wires up the Telegram Mini
// App SDK (initData, HapticFeedback, MainButton, …) so its components can call
// useTelegram() unconditionally. Supply-app doesn't embed the SDK yet — this
// no-op keeps the ported ConsumablesCartForm importable without pulling in
// the WebApp script. When (if) supply-app opens as a Mini App, swap this file
// for the real provider (see feedback-app for the reference implementation).

// Match the shape used by ported seller components so `webApp?.foo?.bar()`
// stays type-safe under the shim; every capability is optional and always
// undefined here, so all optional-chain calls silently no-op at runtime.
interface TelegramWebAppShim {
  HapticFeedback?: {
    notificationOccurred: (type: "success" | "warning" | "error") => void;
    impactOccurred: (style: "light" | "medium" | "heavy") => void;
  };
  MainButton?: {
    show: () => void;
    hide: () => void;
    setText: (text: string) => void;
  };
}

interface TelegramShim {
  initData: string | undefined;
  webApp: TelegramWebAppShim | null;
}

const SHIM: TelegramShim = { initData: undefined, webApp: null };

export function useTelegram(): TelegramShim {
  return SHIM;
}

export function TelegramProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
