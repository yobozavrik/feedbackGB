import {
  AimOutlined,
  CameraOutlined,
  DashboardOutlined,
  FunnelPlotOutlined,
  HistoryOutlined,
  InboxOutlined,
  ScheduleOutlined,
  CalendarOutlined,
  SettingOutlined,
  ShopOutlined,
  TeamOutlined,
  ToolOutlined,
  BuildOutlined,
  TruckOutlined,
} from "@ant-design/icons";
import type { ProLayoutProps } from "@ant-design/pro-components";
import { createElement } from "react";

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
 *   /admin/network/schedules — Графіки роботи магазинів
 *   /admin/network/absences — Графік відсутностей продавчинь
 *   /admin/production/* — Виробництво (тільки super_admin на MVP)
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
      { path: "/admin", name: "Огляд", icon: createElement(DashboardOutlined) },
      { path: "/admin/tasks", name: "Мої завдання", icon: createElement(InboxOutlined) },
      { path: "/admin/photo-report", name: "Фотозвіт", icon: createElement(CameraOutlined) },
    ],
  },
  {
    key: "network",
    name: "Мережа",
    items: [
      { path: "/admin/stores", name: "Магазини", icon: createElement(ShopOutlined) },
      { path: "/admin/users", name: "Співробітники", icon: createElement(TeamOutlined) },
      { path: "/admin/network/schedules", name: "Графіки роботи", icon: createElement(ScheduleOutlined) },
      { path: "/admin/network/absences", name: "Графік відсутностей", icon: createElement(CalendarOutlined) },
    ],
  },
  {
    key: "production",
    name: "Виробництво",
    superAdminOnly: true,
    items: [
      { path: "/admin/production/schedules", name: "Графіки роботи", icon: createElement(ScheduleOutlined), superAdminOnly: true },
      { path: "/admin/production/workshops", name: "Цехи", icon: createElement(BuildOutlined), superAdminOnly: true },
      { path: "/admin/production/supplies", name: "Постачання", icon: createElement(TruckOutlined), superAdminOnly: true },
    ],
  },
  {
    key: "analytics",
    name: "Аналітика",
    superAdminOnly: true,
    items: [
      { path: "/admin/analytics", name: "Кліки", icon: createElement(AimOutlined), superAdminOnly: true },
      { path: "/admin/funnel", name: "Воронка", icon: createElement(FunnelPlotOutlined), superAdminOnly: true },
    ],
  },
  {
    key: "system",
    name: "Система",
    items: [
      { path: "/admin/audit", name: "Журнал дій", icon: createElement(HistoryOutlined), superAdminOnly: true },
      { path: "/admin/tools", name: "Інструменти", icon: createElement(ToolOutlined) },
      { path: "/admin/settings", name: "Налаштування", icon: createElement(SettingOutlined) },
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
  "/admin/network/schedules": "Графіки роботи",
  "/admin/network/absences": "Графік відсутностей",
  "/admin/production/schedules": "Графіки роботи",
  "/admin/production/workshops": "Цехи",
  "/admin/production/supplies": "Постачання",
  "/admin/photo-report": "Фотозвіт",
  "/admin/settings": "Налаштування",
};

/** Group label for a given page path, used by the H1 breadcrumb ("Робота / Огляд"). */
export const adminPathToGroup: Record<string, string> = Object.fromEntries(
  adminGroups.flatMap((group) => group.items.map((item) => [item.path, group.name])),
);
