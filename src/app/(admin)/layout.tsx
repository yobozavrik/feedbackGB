import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ConfigProvider } from "antd";
import ukUA from "antd/locale/uk_UA";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminTheme } from "@/lib/admin/theme";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Layout-каркас для всієї адмін-панелі. Відповідає за:
 *   - antd 5 SSR-реєстр (через `@ant-design/nextjs-registry`)
 *   - `ConfigProvider` з українською локаллю та токенами теплої FeedbackGB-теми
 *   - `AdminShell` (ProLayout) — sider, header, breadcrumbs
 *   - перевірку сесії: тільки `role === "admin"` може бачити /admin/*
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
  if (!sess || sess.role !== "admin") {
    redirect("/login?next=/admin");
  }

  return (
    <AntdRegistry>
      <ConfigProvider locale={ukUA} theme={adminTheme}>
        <AdminShell user={{ full_name: sess.full_name, role: sess.role }}>
          {children}
        </AdminShell>
      </ConfigProvider>
    </AntdRegistry>
  );
}
