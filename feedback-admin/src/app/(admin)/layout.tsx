import { AntdRegistry } from "@ant-design/nextjs-registry";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminThemeProvider } from "@/components/admin/AdminThemeProvider";
import { AdminThemeScript } from "@/components/admin/AdminThemeScript";
import {
  ADMIN_THEME_COOKIE,
  DEFAULT_ADMIN_THEME_MODE,
  isAdminThemeMode,
} from "@/lib/admin/themeMode";
import { SESSION_COOKIE, isAdminTier, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Layout-каркас для всієї адмін-панелі. Відповідає за:
 *   - antd 5 SSR-реєстр (через `@ant-design/nextjs-registry`)
 *   - `AdminThemeScript` + `AdminThemeProvider` — light/dark/system тема
 *     (план N1/N6): нема жодного окремого `ConfigProvider` тут — обидва
 *     антд-теми (`adminLightTheme`/`adminDarkTheme`, `theme.ts`) і сам
 *     `ConfigProvider` живуть всередині `AdminThemeProvider`.
 *   - `AdminShell` (ProLayout) — sider, header, breadcrumbs
 *   - перевірку сесії: тільки `admin` або `super_admin` бачать /admin/*
 *
 * Сторінки всередині лишаються звичайними server components і отримують
 * повний viewport — без обмеження `max-w-md` від Mini App.
 */
export default async function AdminGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess || !isAdminTier(sess.role)) {
    redirect("/login?next=/admin");
  }

  const rawMode = cookies().get(ADMIN_THEME_COOKIE)?.value;
  const initialMode = isAdminThemeMode(rawMode) ? rawMode : DEFAULT_ADMIN_THEME_MODE;

  return (
    <AntdRegistry>
      <AdminThemeScript />
      <AdminThemeProvider initialMode={initialMode}>
        <AdminShell user={{ full_name: sess.full_name, role: sess.role }}>
          {children}
        </AdminShell>
      </AdminThemeProvider>
    </AntdRegistry>
  );
}
