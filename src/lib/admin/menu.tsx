import {
  AreaChartOutlined,
  AuditOutlined,
  DashboardOutlined,
  FormOutlined,
  SettingOutlined,
  ShopOutlined,
  TeamOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import type { ProLayoutProps } from "@ant-design/pro-components";

/**
 * Структура sidebar-у адмінки (v1, skeleton).
 *
 * Поки активні тільки три пункти, які відповідають реальним сторінкам:
 *   /admin            — Огляд / Стрічка фідбеку
 *   /admin/users      — Користувачі
 *   /admin/audit      — Журнал дій
 *
 * Решта розділів — "coming-soon" (`disabled: true`), щоб користувач бачив
 * повну мапу адмінки і на яких етапах будуть нові розділи. Кожен наступний
 * PR (Аналітика, Магазини, Інструменти, Налаштування) умикатиме свій
 * пункт меню.
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
      path: "/admin/feedback",
      name: "Фідбек",
      icon: <FormOutlined />,
      disabled: true,
      tooltip: "Окремий розділ зі стрічкою фідбеку — наступний PR",
    },
    {
      path: "/admin/analytics",
      name: "Аналітика",
      icon: <AreaChartOutlined />,
    },
    {
      path: "/admin/stores",
      name: "Магазини & товари",
      icon: <ShopOutlined />,
      disabled: true,
      tooltip: "Каталог магазинів і товарів",
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
      disabled: true,
      tooltip: "Профіль і інтеграції",
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
};
