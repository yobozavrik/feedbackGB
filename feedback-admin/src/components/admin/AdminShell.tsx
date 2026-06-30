"use client";

import { LogoutOutlined, UserOutlined } from "@ant-design/icons";
import { ProLayout } from "@ant-design/pro-components";
import {
  App,
  Avatar,
  Button,
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

const { Text } = Typography;

interface AdminShellProps {
  children: React.ReactNode;
  user: {
    full_name: string;
    role: "admin" | "seller" | "super_admin";
  };
}

function roleLabel(role: "admin" | "seller" | "super_admin"): string {
  if (role === "super_admin") return "супер-адмін";
  if (role === "admin") return "адмін";
  return "продавчиня";
}

function roleColor(role: "admin" | "seller" | "super_admin"): string {
  if (role === "super_admin") return "red";
  if (role === "admin") return "magenta";
  return "default";
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
      if (r.path === "/admin/analytics" || r.path === "/admin/funnel" || r.path === "/admin/audit") {
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
      <div style={{ display: "flex", minHeight: "100vh", background: "#f5f5f5" }}>
        <div style={{ width: 232, background: "#001529" }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ height: 56, background: "#fff", borderBottom: "1px solid #f0f0f0" }} />
          <div style={{ flex: 1, padding: 24, display: "flex", justifyContent: "center", alignItems: "center" }}>
            <Spin size="large" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <ProLayout
      title="Галя слухає"
      logo={
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 8,
            background: token.colorPrimary,
            color: "#fff",
            fontSize: 16,
            fontWeight: 600,
          }}
        >
          ♡
        </span>
      }
      layout="mix"
      contentWidth="Fluid"
      fixSiderbar
      fixedHeader
      siderWidth={232}
      route={filteredRoute}
      location={{ pathname: pathname ?? "/admin" }}
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
        render: (_, defaultDom) => (
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
            <Space size={8} style={{ cursor: "pointer" }}>
              {defaultDom}
              <Text strong style={{ fontSize: 13 }}>
                {user.full_name}
              </Text>
              <Tag color={roleColor(user.role)}>{roleLabel(user.role)}</Tag>
            </Space>
          </Dropdown>
        ),
      }}
      actionsRender={() => [
        <Button key="logout" type="text" icon={<LogoutOutlined />} onClick={onLogout}>
          Вийти
        </Button>,
      ]}
      menuFooterRender={(props) =>
        props?.collapsed ? null : (
          <div style={{ padding: 12, fontSize: 12, color: token.colorTextTertiary }}>
            <div>v1 · Галя Балувана</div>
            <div style={{ marginTop: 4 }}>
              <Avatar size={6} style={{ background: token.colorSuccess }} /> Supabase OK
            </div>
          </div>
        )
      }
    >
      <App>{children}</App>
    </ProLayout>
  );
}
