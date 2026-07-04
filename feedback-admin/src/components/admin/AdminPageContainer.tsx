"use client";

import { PageContainer } from "@ant-design/pro-components";
import type { ReactNode } from "react";
import { NotificationsBell } from "@/components/admin/NotificationsBell";

interface AdminPageContainerProps {
  title: string;
  subTitle?: string;
  extra?: ReactNode;
  tabs?: {
    activeKey?: string;
    onChange?: (key: string) => void;
    items: Array<{ key: string; label: string }>;
  };
  children: ReactNode;
}

/**
 * Тоненька обгортка над antd `PageContainer`, щоб усі сторінки адмінки
 * мали узгоджений PR-style header (заголовок + субтитр + extra-кнопки)
 * і автоматично підхоплювали breadcrumbs з ProLayout.
 *
 * Створена як client component, щоб PageContainer працював з табами/extra
 * без додаткового boilerplate в page-файлах (page.tsx залишаються server).
 */
export function AdminPageContainer({
  title,
  subTitle,
  extra,
  tabs,
  children,
}: AdminPageContainerProps) {
  return (
    <PageContainer
      className="admin-page"
      header={{
        title,
        subTitle,
        breadcrumb: undefined, // ProLayout сам рендерить breadcrumbs
        extra: (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {extra}
            <NotificationsBell />
          </div>
        ),
      }}
      tabList={tabs?.items.map((it) => ({ tab: it.label, key: it.key }))}
      tabActiveKey={tabs?.activeKey}
      onTabChange={tabs?.onChange}
    >
      {children}
    </PageContainer>
  );
}
