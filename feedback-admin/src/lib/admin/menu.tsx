import {
  AreaChartOutlined,
  AuditOutlined,
  DashboardOutlined,
  FunnelPlotOutlined,
  SettingOutlined,
  ShopOutlined,
  TeamOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import type { ProLayoutProps } from "@ant-design/pro-components";

/**
 * Структура sidebar-у адмінки.
 *
 * Активні розділи:
 *   /admin            — Огляд (KPI + heatmap + стрічка фідбеку ProTable)
 *   /admin/analytics  — Аналітика (графіки)
 *   /admin/funnel     — Воронка (PostHog: де відвалюються користувачі)
 *   /admin/stores     — Магазини (список з метриками + Drawer-деталь)
 *   /admin/users      — Користувачі
 *   /admin/audit      — Журнал дій
 *   /admin/tools      — Інструменти (звіт / дзеркало / експорт)
 *   /admin/settings   — Налаштування (профіль, крон, інтеграції)
 */
export const adminRoute: ProLayoutProps["route"] = {
  path: "/admin",
  routes: [
    {
      path: "/admin",
      name: "Огляд",
      icon: <DashboardOutlined />,
    },
    {
      path: "/admin/analytics",
      name: "Аналітика",
      icon: <AreaChartOutlined />,
    },
    {
      path: "/admin/funnel",
      name: "Воронка",
      icon: <FunnelPlotOutlined />,
    },
    {
      path: "/admin/stores",
      name: "Магазини",
      icon: <ShopOutlined />,
    },
    {
      path: "/admin/users",
      name: "Користувачі",
      icon: <TeamOutlined />,
    },
    {
      path: "/admin/audit",
      name: "Журнал",
      icon: <AuditOutlined />,
    },
    {
      path: "/admin/tools",
      name: "Інструменти",
      icon: <ToolOutlined />,
    },
    {
      path: "/admin/settings",
      name: "Налаштування",
      icon: <SettingOutlined />,
    },
  ],
};

/**
 * Текстові «крихти» (breadcrumb names) для кожного відомого маршруту.
 * Використовуються `AdminShell` для `breadcrumbRender`.
 */
export const adminBreadcrumbNames: Record<string, string> = {
  "/admin": "Огляд",
  "/admin/users": "Користувачі",
  "/admin/audit": "Журнал",
  "/admin/tools": "Інструменти",
  "/admin/analytics": "Аналітика",
  "/admin/funnel": "Воронка",
  "/admin/stores": "Магазини",
  "/admin/settings": "Налаштування",
};
