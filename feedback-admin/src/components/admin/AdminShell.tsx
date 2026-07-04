"use client";

import { LogoutOutlined, UserOutlined } from "@ant-design/icons";
import { ProLayout } from "@ant-design/pro-components";
import {
  App,
  Avatar,
  Dropdown,
  Space,
  Tag,
  Typography,
  theme as antdTheme,
  Spin,
} from "antd";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useEffect } from "react";
import {
  adminBreadcrumbNames,
  adminRoute,
} from "@/lib/admin/menu";
import { NotificationsBell } from "@/components/admin/NotificationsBell";

const { Text } = Typography;

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

export function AdminShell({ children, user }: AdminShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { token } = antdTheme.useToken();

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const filteredRoute = useMemo(() => {
    if (!adminRoute?.routes) return adminRoute;
    const isSuper = user.role === "super_admin";
    const routes = adminRoute.routes.filter((r: any) => {
      if (
        r.path === "/admin/analytics" ||
        r.path === "/admin/funnel" ||
        r.path === "/admin/audit"
      ) {
        return isSuper;
      }
      return true;
    });
    return { ...adminRoute, routes };
  }, [user.role]);

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

  const onLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    router.push("/login");
    router.refresh();
  };

  if (!mounted) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: token.colorBgLayout }}>
        <div style={{ width: 236, background: token.colorBgContainer, borderRight: `1px solid ${token.colorBorder}` }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ height: 58, background: token.colorBgContainer, borderBottom: `1px solid ${token.colorBorder}` }} />
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
      logo={
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            borderRadius: 9,
            background: token.colorPrimary,
            color: token.colorWhite,
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          ♡
        </span>
      }
      layout="side"
      contentWidth="Fluid"
      fixSiderbar
      fixedHeader
      siderWidth={236}
      route={filteredRoute}
      location={{ pathname: pathname ?? "/admin" }}
      headerContentRender={() => (
        <div className="admin-shell__header-title">
          <span className="admin-shell__breadcrumb-muted">Admin</span>
          <span className="admin-shell__breadcrumb-separator">/</span>
          <span className="admin-shell__breadcrumb-current">{currentCrumb}</span>
        </div>
      )}
      actionsRender={() => [<NotificationsBell key="notifications" />]}
      breadcrumbProps={{
        items: breadcrumbItems.map((it) => ({
          key: it.path,
          title: <Link href={it.path}>{it.breadcrumbName}</Link>,
        })),
      }}
      menuItemRender={(item, dom) =>
        item.disabled || !item.path ? (
          <span style={{ cursor: "not-allowed", opacity: 0.55 }}>{dom}</span>
        ) : (
          <Link href={item.path}>{dom}</Link>
        )
      }
      avatarProps={{
        icon: <UserOutlined />,
        size: "small",
        title: user.full_name,
        render: () => (
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
            placement="bottomRight"
          >
            <Space className="admin-shell__user" size={8}>
              <Avatar
                size={30}
                style={{
                  background: token.colorPrimaryBg,
                  color: token.colorPrimary,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {userInitials(user.full_name)}
              </Avatar>
              <Text strong className="admin-shell__user-name">
                {user.full_name}
              </Text>
              <Tag className="admin-shell__role-tag" color={roleColor(user.role)}>
                {roleLabel(user.role)}
              </Tag>
            </Space>
          </Dropdown>
        ),
      }}
      menuFooterRender={(props) =>
        props?.collapsed ? null : (
          <div className="admin-shell__footer">
            <div>v1 · Галя Балувана</div>
            <div style={{ marginTop: 4 }}>
              <Avatar size={6} style={{ background: token.colorSuccess }} /> Supabase OK
            </div>
          </div>
        )
      }
    >
      <App>
        <div className="admin-shell__content">{children}</div>
      </App>
    </ProLayout>
  );
}
