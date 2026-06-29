"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { TelegramUser } from "@/lib/types";

interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  initData: string;
  initDataUnsafe: { user?: TelegramUser };
  themeParams: Record<string, string>;
  colorScheme: "light" | "dark";
  HapticFeedback?: {
    impactOccurred: (style: "light" | "medium" | "heavy") => void;
    notificationOccurred: (type: "success" | "warning" | "error") => void;
  };
  MainButton?: {
    text: string;
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
    setText: (t: string) => void;
    enable: () => void;
    disable: () => void;
  };
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  close: () => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

interface Ctx {
  webApp: TelegramWebApp | null;
  user: TelegramUser | null;
  initData: string;
  isTelegram: boolean;
}

const TelegramContext = createContext<Ctx>({
  webApp: null,
  user: null,
  initData: "",
  isTelegram: false,
});

export function useTelegram() {
  return useContext(TelegramContext);
}

export function TelegramProvider({ children }: { children: React.ReactNode }) {
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null);

  useEffect(() => {
    let cancelled = false;
    function attach() {
      const wa = window.Telegram?.WebApp;
      if (!wa) return false;
      if (cancelled) return true;
      wa.ready();
      wa.expand();
      setWebApp(wa);
      return true;
    }
    if (attach()) return;
    const interval = window.setInterval(() => {
      if (attach()) window.clearInterval(interval);
    }, 200);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      webApp,
      user: webApp?.initDataUnsafe?.user ?? null,
      initData: webApp?.initData ?? "",
      isTelegram: Boolean(webApp),
    }),
    [webApp],
  );

  return <TelegramContext.Provider value={value}>{children}</TelegramContext.Provider>;
}
