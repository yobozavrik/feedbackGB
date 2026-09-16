"use client";

import {
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { ProLayout } from "@ant-design/pro-components";
import {
  App,
  Avatar,
  Dropdown,
  Tag,
  Tooltip,
  Typography,
  theme as antdTheme,
  Spin,
} from "antd";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useEffect } from "react";
import { NotificationsBell } from "@/components/admin/NotificationsBell";
import {
  adminBreadcrumbNames,
  adminPathToGroup,
  buildAdminRoute,
} from "@/lib/admin/menu";

const { Text } = Typography;

const SIDER_COLLAPSED_KEY = "admin-sider-collapsed";

interface AdminShellProps {
  children: React.ReactNode;
  user: {
    full_name: string;
    role: "admin" | "seller" | "super_admin";
  };
}

export function roleLabel(role: "admin" | "seller" | "super_admin"): string {
  if (role === "super_admin") return "супер-адмін";
  if (role === "admin") return "адмін";
  return "продавчиня";
}

function roleColor(role: "admin" | "seller" | "super_admin"): string {
  if (role === "super_admin") return "red";
  if (role === "admin") return "magenta";
  return "default";
}

function userInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

/** S6 — reads the persisted collapsed state. Only ever called client-side
 * (see the `mounted` gate below), so `window`/`localStorage` are safe here. */
function readPersistedCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDER_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function persistCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDER_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* private mode / blocked storage — collapsed state just won't persist */
  }
}

export function AdminShell({ children, user }: AdminShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { token } = antdTheme.useToken();

  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(readPersistedCollapsed());
    setMounted(true);
  }, []);

  const isSuperAdmin = user.role === "super_admin";
  const filteredRoute = useMemo(
    () => buildAdminRoute(isSuperAdmin),
    [isSuperAdmin],
  );

  const breadcrumbItems = useMemo(() => {
    if (!pathname) return [{ path: "/admin", breadcrumbName: "Огляд" }];
    const parts = pathname.split("/").filter(Boolean);
    const items: { path: string; breadcrumbName: string }[] = [];
    let current = "";
    for (const part of parts) {
      current += `/${part}`;
      const name =
        adminBreadcrumbNames[current] ??
        part.charAt(0).toUpperCase() + part.slice(1);
      items.push({ path: current, breadcrumbName: name });
    }
    return items;
  }, [pathname]);

  const currentCrumb =
    breadcrumbItems[breadcrumbItems.length - 1]?.breadcrumbName ?? "Огляд";
  // H1 — group name replaces the literal English "Admin" ahead of the page name.
  const currentGroup = adminPathToGroup[pathname ?? "/admin"] ?? "Робота";

  const onLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    router.push("/login");
    router.refresh();
  };

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      persistCollapsed(next);
      return next;
    });
  };

  if (!mounted) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: token.colorBgLayout }}>
        <div style={{ width: 240, background: token.colorBgContainer, borderRight: `1px solid ${token.colorBorder}` }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ height: 56, background: token.colorBgContainer, borderBottom: `1px solid ${token.colorBorder}` }} />
          <div style={{ flex: 1, padding: 24, display: "flex", justifyContent: "center", alignItems: "center" }}>
            <Spin size="large" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <ProLayout
      className="admin-shell"
      title="Галя слухає"
      // S7 — a small brand mark instead of the "♡" glyph.
      logo={<span className="admin-logo__mark" aria-hidden>Г</span>}
      menuHeaderRender={(logo) => (
        <div className="admin-logo">
          {logo}
          {!collapsed && (
            <span className="admin-logo__text">
              <span className="admin-logo__name">Галя слухає</span>
              <span className="admin-logo__sub">Адмін-панель</span>
            </span>
          )}
        </div>
      )}
      layout="side"
      contentWidth="Fluid"
      fixSiderbar
      fixedHeader
      siderWidth={240}
      // S6 — 56px icon-only rail (ProLayout has no `collapsedWidth` prop;
      // the width is forced via `.ant-layout-sider-collapsed` in globals.css).
      // State is persisted in localStorage.
      collapsed={collapsed}
      onCollapse={setCollapsed}
      // S6 — the fold/unfold control moves into the header (see below);
      // ProLayout's own footer toggle button is turned off.
      collapsedButtonRender={false}
      // S4 — top-level route nodes with no `icon` become non-clickable
      // group headers; their `routes` render as normal items underneath.
      siderMenuType="group"
      route={filteredRoute}
      location={{ pathname: pathname ?? "/admin" }}
      headerContentRender={() => (
        <div className="admin-shell__header-title">
          <button
            type="button"
            className="admin-shell__collapse-btn"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Розгорнути меню" : "Згорнути меню"}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </button>
          <span className="admin-shell__breadcrumb-muted">{currentGroup}</span>
          <RightOutlined className="admin-shell__breadcrumb-arrow" />
          <span className="admin-shell__breadcrumb-current">{currentCrumb}</span>
        </div>
      )}
      breadcrumbProps={{
        items: breadcrumbItems.map((it) => ({
          key: it.path,
          title: <Link href={it.path}>{it.breadcrumbName}</Link>,
        })),
      }}
      menuItemRender={(item, dom) => {
        const content =
          item.disabled || !item.path ? (
            <span style={{ cursor: "not-allowed", opacity: 0.55 }}>{dom}</span>
          ) : (
            <Link href={item.path}>{dom}</Link>
          );
        // S6 — antd's own collapsed-menu tooltip only wraps level-0 items;
        // ours sit one level down (inside a group), so it needs to be added
        // by hand once the rail is collapsed.
        if (!collapsed) return content;
        return (
          <Tooltip title={item.name} placement="right" mouseEnterDelay={0.2}>
            {content}
          </Tooltip>
        );
      }}
      // H2 (theme switch) is wired in stage 8, once AdminThemeProvider exists;
      // for now the header only carries the H3 notifications bell.
      actionsRender={() => [<NotificationsBell key="notifications" />]}
      // S8 — profile + sign-out replaces the old hard-coded "Supabase OK" line,
      // which never reflected a real health check.
      menuFooterRender={() => (
        <div className="admin-shell__footer">
          <Dropdown
            menu={{
              items: [
                {
                  key: "logout",
                  label: "Вийти",
                  icon: <LogoutOutlined />,
                  onClick: onLogout,
                },
              ],
            }}
            placement="topRight"
          >
            <div
              className="admin-shell__footer-trigger"
              role="button"
              tabIndex={0}
              aria-label={`${user.full_name} · ${roleLabel(user.role)} · Вийти`}
            >
              <Avatar
                size={28}
                className="admin-shell__footer-avatar"
                style={{
                  background: token.colorPrimaryBg,
                  color: token.colorPrimary,
                }}
              >
                {userInitials(user.full_name)}
              </Avatar>
              {!collapsed && (
                <div className="admin-shell__footer-who">
                  <Text className="admin-shell__footer-name">{user.full_name}</Text>
                  <Tag className="admin-shell__role-tag" color={roleColor(user.role)}>
                    {roleLabel(user.role)}
                  </Tag>
                </div>
              )}
            </div>
          </Dropdown>
        </div>
      )}
    >
      <App>
        <div className="admin-shell__content">{children}</div>
      </App>
    </ProLayout>
  );
}
