"use client";

import { ConfigProvider } from "antd";
import ukUA from "antd/locale/uk_UA";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { adminDarkTheme, adminLightTheme } from "@/lib/admin/theme";
import {
  ADMIN_THEME_ATTR,
  ADMIN_THEME_COOKIE,
  resolveAdminTheme,
  type AdminThemeMode,
  type ResolvedAdminTheme,
} from "@/lib/admin/themeMode";

interface AdminThemeContextValue {
  mode: AdminThemeMode;
  resolved: ResolvedAdminTheme;
  setMode: (mode: AdminThemeMode) => void;
}

const AdminThemeContext = createContext<AdminThemeContextValue | null>(null);

/** H2 — read by ThemeModeSwitch. */
export function useAdminTheme(): AdminThemeContextValue {
  const ctx = useContext(AdminThemeContext);
  if (!ctx) {
    throw new Error("useAdminTheme must be used within AdminThemeProvider");
  }
  return ctx;
}

function readPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function writeModeCookie(mode: AdminThemeMode): void {
  try {
    document.cookie = `${ADMIN_THEME_COOKIE}=${mode}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    /* private mode / blocked storage — the choice just won't persist */
  }
}

/**
 * N1 — light/dark/system switching for the admin. `initialMode` comes from
 * the `admin-theme` cookie, read server-side in `(admin)/layout.tsx`, so
 * the very first render already picks the right antd theme (adminLightTheme
 * / adminDarkTheme, stage 1) for an explicit light/dark choice. For
 * "system" the actual color still depends on `prefers-color-scheme`, which
 * only the browser knows — `AdminThemeScript` (N6) paints that before
 * hydration via a plain `<html data-admin-theme>` attribute + CSS
 * (globals.css), and this effect below only has to agree with it, not
 * correct a visible flash.
 */
export function AdminThemeProvider({
  initialMode,
  children,
}: {
  initialMode: AdminThemeMode;
  children: React.ReactNode;
}) {
  const [mode, setModeState] = useState<AdminThemeMode>(initialMode);
  const [prefersDark, setPrefersDark] = useState(false);

  useEffect(() => {
    setPrefersDark(readPrefersDark());
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setPrefersDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const resolved = useMemo(
    () => resolveAdminTheme(mode, prefersDark),
    [mode, prefersDark],
  );

  // Keeps `<html data-admin-theme>` (set by the inline script before
  // hydration) in sync with React state from here on — toggling mode,
  // or the OS theme changing under a "system" choice.
  useEffect(() => {
    document.documentElement.setAttribute(ADMIN_THEME_ATTR, resolved);
  }, [resolved]);

  const setMode = useCallback((next: AdminThemeMode) => {
    setModeState(next);
    writeModeCookie(next);
  }, []);

  const contextValue = useMemo(
    () => ({ mode, resolved, setMode }),
    [mode, resolved, setMode],
  );

  return (
    <AdminThemeContext.Provider value={contextValue}>
      <ConfigProvider
        locale={ukUA}
        theme={resolved === "dark" ? adminDarkTheme : adminLightTheme}
        wave={{ disabled: true }}
      >
        {children}
      </ConfigProvider>
    </AdminThemeContext.Provider>
  );
}
