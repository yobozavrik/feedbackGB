import {
  AimOutlined,
  CameraOutlined,
  DashboardOutlined,
  FunnelPlotOutlined,
  HistoryOutlined,
  InboxOutlined,
  SettingOutlined,
  ShopOutlined,
  TeamOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import type { ProLayoutProps } from "@ant-design/pro-components";

/**
 * Структура sidebar-у адмінки, згрупована по розділах (план S4).
 *
 * Кожна група — вузол верхнього рівня без `path`/`icon`: з увімкненим
 * `siderMenuType="group"` (AdminShell.tsx) ProLayout рендерить такий вузол
 * як некликабельний заголовок групи (antd `Menu` `type: "group"`), а його
 * `routes` — як звичайні пункти меню з іконками (BaseMenu.js:
 * `children = item.children || item.routes`).
 *
 * Активні розділи:
 *   /admin            — Огляд (KPI + heatmap + стрічка фідбеку ProTable)
 *   /admin/tasks      — Мої завдання (призначені мені фідбеки)
 *   /admin/photo-report — Фотозвіт
 *   /admin/stores     — Магазини (список з метриками + Drawer-деталь)
 *   /admin/users      — Співробітники
 *   /admin/analytics  — Кліки (теплові карти взаємодій Mini App)
 *   /admin/funnel     — Воронка (PostHog: де відвалюються користувачі)
 *   /admin/audit      — Журнал дій
 *   /admin/tools      — Інструменти (звіт / дзеркало / експорт)
 *   /admin/settings   — Налаштування (профіль, крон, інтеграції)
 */
interface AdminGroupDef {
  key: string;
  name: string;
  /** super_admin-only routes are filtered out by AdminShell for other roles. */
  superAdminOnly?: boolean;
  items: Array<{
    path: string;
    name: string;
    icon: React.ReactNode;
    superAdminOnly?: boolean;
  }>;
}

const adminGroups: AdminGroupDef[] = [
  {
    key: "work",
    name: "Робота",
    items: [
      { path: "/admin", name: "Огляд", icon: <DashboardOutlined /> },
      { path: "/admin/tasks", name: "Мої завдання", icon: <InboxOutlined /> },
      { path: "/admin/photo-report", name: "Фотозвіт", icon: <CameraOutlined /> },
    ],
  },
  {
    key: "network",
    name: "Мережа",
    items: [
      { path: "/admin/stores", name: "Магазини", icon: <ShopOutlined /> },
      { path: "/admin/users", name: "Співробітники", icon: <TeamOutlined /> },
    ],
  },
  {
    key: "analytics",
    name: "Аналітика",
    superAdminOnly: true,
    items: [
      { path: "/admin/analytics", name: "Кліки", icon: <AimOutlined />, superAdminOnly: true },
      { path: "/admin/funnel", name: "Воронка", icon: <FunnelPlotOutlined />, superAdminOnly: true },
    ],
  },
  {
    key: "system",
    name: "Система",
    items: [
      { path: "/admin/audit", name: "Журнал дій", icon: <HistoryOutlined />, superAdminOnly: true },
      { path: "/admin/tools", name: "Інструменти", icon: <ToolOutlined /> },
      { path: "/admin/settings", name: "Налаштування", icon: <SettingOutlined /> },
    ],
  },
];

/** Builds the grouped `route` tree for ProLayout, filtered by role (S4). */
export function buildAdminRoute(isSuperAdmin: boolean): ProLayoutProps["route"] {
  const routes = adminGroups
    .filter((group) => isSuperAdmin || !group.superAdminOnly)
    .map((group) => ({
      path: `/admin/_group/${group.key}`,
      name: group.name,
      routes: group.items
        .filter((item) => isSuperAdmin || !item.superAdminOnly)
        .map((item) => ({
          path: item.path,
          name: item.name,
          icon: item.icon,
        })),
    }))
    .filter((group) => group.routes.length > 0);
  return { path: "/admin", routes };
}

/**
 * Текстові «крихти» (breadcrumb names) для кожного відомого маршруту.
 * Використовуються `AdminShell` для `breadcrumbRender`.
 */
export const adminBreadcrumbNames: Record<string, string> = {
  "/admin": "Огляд",
  "/admin/tasks": "Мої завдання",
  "/admin/users": "Співробітники",
  "/admin/audit": "Журнал дій",
  "/admin/tools": "Інструменти",
  "/admin/analytics": "Кліки",
  "/admin/funnel": "Воронка",
  "/admin/stores": "Магазини",
  "/admin/photo-report": "Фотозвіт",
  "/admin/settings": "Налаштування",
};

/** Group label for a given page path, used by the H1 breadcrumb ("Робота / Огляд"). */
export const adminPathToGroup: Record<string, string> = Object.fromEntries(
  adminGroups.flatMap((group) => group.items.map((item) => [item.path, group.name])),
);
