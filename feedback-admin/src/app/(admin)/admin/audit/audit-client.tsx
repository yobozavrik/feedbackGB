"use client";

import {
  ApartmentOutlined,
  KeyOutlined,
  MessageOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import {
  Space,
  Tag,
  Typography,
  theme as antdTheme,
} from "antd";
import { useMemo } from "react";
import { AuditDetails } from "@/components/admin/audit/AuditDetails";
import { LocationCell } from "@/components/admin/audit/LocationCell";
import { MetaText } from "@/components/admin/ui/typography";
import {
  appSurfaceLabel,
  formatTime,
  readAppSurface,
} from "@/lib/auditFormat";
import type { AuditRow } from "./page";

const { Text } = Typography;

interface Props {
  rows: AuditRow[];
}

const SECTION_META: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  auth: {
    label: "Вхід",
    color: "blue",
    icon: <KeyOutlined />,
  },
  feedback: {
    label: "Фідбек",
    color: "purple",
    icon: <MessageOutlined />,
  },
  admin: {
    label: "Адмін",
    color: "magenta",
    icon: <ToolOutlined />,
  },
  system: {
    label: "Система",
    color: "default",
    icon: <ApartmentOutlined />,
  },
};

export function AuditClient({ rows }: Props) {
  const { token } = antdTheme.useToken();

  const sectionFilters = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) seen.add(r.section);
    return Array.from(seen)
      .sort()
      .map((s) => ({ text: SECTION_META[s]?.label ?? s, value: s }));
  }, [rows]);

  const actorFilters = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (r.actor_user_id && r.actor_full_name) {
        seen.set(r.actor_user_id, r.actor_full_name);
      }
    }
    return Array.from(seen.entries())
      .sort((a, b) => a[1].localeCompare(b[1], "uk"))
      .map(([id, name]) => ({ text: name, value: id }));
  }, [rows]);

  const actionFilters = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (!seen.has(r.action)) seen.set(r.action, r.action_title);
    }
    return Array.from(seen.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([action, title]) => ({ text: title, value: action }));
  }, [rows]);

  const columns: ProColumns<AuditRow>[] = useMemo(
    () => [
      {
        title: "Час",
        dataIndex: "occurred_at",
        width: 130,
        fixed: "left",
        sorter: (a, b) =>
          new Date(a.occurred_at).getTime() -
          new Date(b.occurred_at).getTime(),
        defaultSortOrder: "descend",
        render: (_, row) => (
          <Text style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
            {formatTime(row.occurred_at)}
          </Text>
        ),
      },
      {
        title: "Розділ",
        dataIndex: "section",
        width: 130,
        filters: sectionFilters,
        onFilter: (value, row) => row.section === value,
        render: (_, row) => {
          const meta = SECTION_META[row.section] ?? {
            label: row.section,
            color: "default",
            icon: null,
          };
          return (
            <Tag color={meta.color} icon={meta.icon} bordered={false}>
              {meta.label}
            </Tag>
          );
        },
      },
      {
        title: "Дія",
        dataIndex: "action_title",
        ellipsis: true,
        filters: actionFilters,
        filterSearch: true,
        onFilter: (value, row) => row.action === value,
        render: (_, row) => {
          const failed = row.action === "auth.login.failure";
          return (
            <Space size={6} wrap>
              <Text
                strong={failed}
                style={{ color: failed ? token.colorError : undefined }}
              >
                {row.action_title}
              </Text>
              <Text
                code
                style={{
                  fontSize: 11,
                  color: token.colorTextTertiary,
                }}
              >
                {row.action}
              </Text>
            </Space>
          );
        },
      },
      {
        title: "Куди",
        dataIndex: "meta",
        width: 120,
        filters: [
          { text: "Веб-апп", value: "web_app" },
          { text: "Адмінка", value: "admin_panel" },
        ],
        onFilter: (value, row) => readAppSurface(row.meta) === value,
        render: (_, row) => {
          const surface = appSurfaceLabel(readAppSurface(row.meta));
          return surface ? (
            <Tag color={surface.color} bordered={false}>
              {surface.label}
            </Tag>
          ) : (
            <Text type="secondary">—</Text>
          );
        },
      },
      {
        title: "Хто",
        dataIndex: "actor_full_name",
        width: 200,
        ellipsis: true,
        filters: actorFilters.length > 0 ? actorFilters : undefined,
        filterSearch: true,
        onFilter: (value, row) => row.actor_user_id === value,
        render: (_, row) => {
          if (row.actor_full_name) {
            const tag =
              row.actor_role === "super_admin"
                ? { color: "red", label: "супер-адмін" }
                : row.actor_role === "admin"
                  ? { color: "magenta", label: "адмін" }
                  : null;
            return (
              <Space size={6}>
                <Text>{row.actor_full_name}</Text>
                {tag ? (
                  <Tag color={tag.color} bordered={false}>
                    {tag.label}
                  </Tag>
                ) : null}
              </Space>
            );
          }
          if (row.actor_user_id) {
            return (
              <Text code style={{ fontSize: 11 }}>
                {row.actor_user_id.slice(0, 8)}…
              </Text>
            );
          }
          return <Text type="secondary">anon</Text>;
        },
      },
      {
        title: "Кому",
        dataIndex: "target_full_name",
        width: 180,
        ellipsis: true,
        render: (_, row) =>
          row.target_full_name ? (
            <Text>{row.target_full_name}</Text>
          ) : row.target_user_id ? (
            <Text code style={{ fontSize: 11 }}>
              {row.target_user_id.slice(0, 8)}…
            </Text>
          ) : (
            <Text type="secondary">—</Text>
          ),
      },
      {
        title: "Звідки",
        dataIndex: "ip",
        width: 220,
        render: (_, row) => <LocationCell row={row} />,
      },
    ],
    [sectionFilters, actorFilters, actionFilters, token],
  );

  return (
    <ProTable<AuditRow>
      className="admin-audit-table"
      rowKey="id"
      dataSource={rows}
      columns={columns}
      search={false}
      options={{
        density: true,
        fullScreen: true,
        reload: false,
        setting: true,
      }}
      pagination={{
        pageSize: 50,
        showSizeChanger: true,
        showTotal: (total) => `${total} подій`,
      }}
      scroll={{ x: 1100 }}
      expandable={{
        expandedRowRender: (row) => <AuditDetails row={row} />,
        rowExpandable: (row) =>
          (row.meta != null && Object.keys(row.meta).length > 0) ||
          (row.diff != null && Object.keys(row.diff).length > 0) ||
          row.user_agent != null,
      }}
      headerTitle={
        <Space size={8}>
          <Text strong>Останні події</Text>
          <Tag color="magenta" bordered={false}>
            {rows.length}
          </Tag>
        </Space>
      }
      toolBarRender={() => [
        <MetaText key="hint">
          Останні 500 подій. Розгортай рядок щоб побачити meta і diff.
        </MetaText>,
      ]}
    />
  );
}
