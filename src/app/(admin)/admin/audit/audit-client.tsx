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
  Tooltip,
  Typography,
  theme as antdTheme,
} from "antd";
import { useMemo } from "react";
import { countryFlag, formatGeoLines } from "@/lib/geoip";
import type { AuditRow } from "./page";

const { Text, Paragraph } = Typography;

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

function formatTime(iso: string): string {
  const t = new Date(iso);
  const now = new Date();
  const sameDay =
    t.getFullYear() === now.getFullYear() &&
    t.getMonth() === now.getMonth() &&
    t.getDate() === now.getDate();
  if (sameDay) {
    return t.toLocaleTimeString("uk-UA", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  return t.toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
        title: "Хто",
        dataIndex: "actor_full_name",
        width: 200,
        ellipsis: true,
        filters: actorFilters.length > 0 ? actorFilters : undefined,
        filterSearch: true,
        onFilter: (value, row) => row.actor_user_id === value,
        render: (_, row) => {
          if (row.actor_full_name) {
            return (
              <Space size={6}>
                <Text>{row.actor_full_name}</Text>
                {row.actor_role === "admin" ? (
                  <Tag color="magenta" bordered={false}>
                    адмін
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
        <Text key="hint" type="secondary" style={{ fontSize: 12 }}>
          Останні 500 подій. Розгортай рядок щоб побачити meta і diff.
        </Text>,
      ]}
    />
  );
}

interface GeoIpMeta {
  country?: string | null;
  city?: string | null;
  asn?: string | null;
  isp?: string | null;
}

function readGeo(meta: AuditRow["meta"]): GeoIpMeta | null {
  if (!meta || typeof meta !== "object") return null;
  const raw = (meta as Record<string, unknown>).geoip;
  if (!raw || typeof raw !== "object") return null;
  return raw as GeoIpMeta;
}

function LocationCell({ row }: { row: AuditRow }) {
  const geo = readGeo(row.meta);
  if (!row.ip && !geo) {
    return <Text type="secondary">—</Text>;
  }
  const flag = countryFlag(geo?.country ?? undefined);
  const { cityCountry, ispAsn } = formatGeoLines(geo);
  const secondary = ispAsn || row.ip;
  return (
    <Space direction="vertical" size={2} style={{ lineHeight: 1.2 }}>
      <Space size={6} wrap>
        {flag ? <span style={{ fontSize: 14 }}>{flag}</span> : null}
        {cityCountry ? (
          <Text style={{ fontSize: 12 }}>{cityCountry}</Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            —
          </Text>
        )}
      </Space>
      {secondary ? (
        <Tooltip title={row.ip ? `IP: ${row.ip}` : undefined}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {secondary}
          </Text>
        </Tooltip>
      ) : null}
    </Space>
  );
}

function AuditDetails({ row }: { row: AuditRow }) {
  const { token } = antdTheme.useToken();
  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {row.user_agent ? (
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            User-Agent:
          </Text>{" "}
          <Text style={{ fontSize: 12 }}>{row.user_agent}</Text>
        </div>
      ) : null}
      {row.meta && Object.keys(row.meta).length > 0 ? (
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
            meta:
          </Text>
          <Paragraph
            style={{
              margin: 0,
              padding: 12,
              background: token.colorFillTertiary,
              borderRadius: 8,
              fontSize: 12,
              fontFamily: "monospace",
              whiteSpace: "pre-wrap",
            }}
          >
            {JSON.stringify(row.meta, null, 2)}
          </Paragraph>
        </div>
      ) : null}
      {row.diff && Object.keys(row.diff).length > 0 ? (
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
            diff:
          </Text>
          <Paragraph
            style={{
              margin: 0,
              padding: 12,
              background: token.colorFillTertiary,
              borderRadius: 8,
              fontSize: 12,
              fontFamily: "monospace",
              whiteSpace: "pre-wrap",
            }}
          >
            {JSON.stringify(row.diff, null, 2)}
          </Paragraph>
        </div>
      ) : null}
    </Space>
  );
}
