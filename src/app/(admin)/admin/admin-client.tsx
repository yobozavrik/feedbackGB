"use client";

import {
  CalendarOutlined,
  CameraOutlined,
  DownloadOutlined,
  PictureOutlined,
  ShopOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import {
  Button,
  Drawer,
  Image,
  Segmented,
  Space,
  Tag,
  Typography,
  theme as antdTheme,
} from "antd";
import { useMemo, useState } from "react";
import type { FeedRow } from "./page";

const { Text, Paragraph, Title } = Typography;

type Period = "all" | "today" | "week" | "month";

interface CategoryMeta {
  id: string;
  title: string;
  emoji: string;
  tint: string;
}

interface Props {
  rows: FeedRow[];
  stores: string[];
  categories: CategoryMeta[];
}

const PERIOD_LABELS: Record<Period, string> = {
  all: "Все",
  today: "Сьогодні",
  week: "Тиждень",
  month: "Місяць",
};

const TINT_COLOR: Record<string, string> = {
  missing: "orange",
  overstock: "blue",
  defect: "red",
  supply: "geekblue",
  idea: "purple",
  spotted: "cyan",
  tech: "gold",
  voice: "magenta",
};

const STATUS_META: Record<
  string,
  { text: string; color: string }
> = {
  new: { text: "Нове", color: "green" },
  in_progress: { text: "В роботі", color: "gold" },
  resolved: { text: "Закрито", color: "default" },
  duplicate: { text: "Дубль", color: "purple" },
};

function periodCutoff(p: Period): number {
  const now = Date.now();
  switch (p) {
    case "today":
      return now - 24 * 60 * 60 * 1000;
    case "week":
      return now - 7 * 24 * 60 * 60 * 1000;
    case "month":
      return now - 30 * 24 * 60 * 60 * 1000;
    default:
      return 0;
  }
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "щойно";
  if (min < 60) return `${min} хв тому`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} год тому`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} дн тому`;
  return new Date(iso).toLocaleDateString("uk-UA");
}

function authorOf(r: FeedRow): string {
  return (
    r.user_full_name ||
    r.tg_display_name ||
    r.tg_username ||
    "анонім"
  );
}

export function AdminClient({ rows, stores, categories }: Props) {
  const { token } = antdTheme.useToken();
  const [period, setPeriod] = useState<Period>("all");
  const [active, setActive] = useState<FeedRow | null>(null);

  const filteredByPeriod = useMemo(() => {
    const cutoff = periodCutoff(period);
    if (cutoff === 0) return rows;
    return rows.filter((r) => new Date(r.created_at).getTime() >= cutoff);
  }, [rows, period]);

  const newLast7Days = useMemo(
    () =>
      rows.filter(
        (r) =>
          new Date(r.created_at).getTime() >
          Date.now() - 7 * 24 * 60 * 60 * 1000,
      ).length,
    [rows],
  );

  const storeFilters = useMemo(
    () => stores.map((s) => ({ text: s, value: s })),
    [stores],
  );

  const categoryFilters = useMemo(
    () => categories.map((c) => ({ text: `${c.emoji} ${c.title}`, value: c.id })),
    [categories],
  );

  const statusFilters = useMemo(
    () =>
      Object.entries(STATUS_META).map(([value, m]) => ({
        text: m.text,
        value,
      })),
    [],
  );

  const categoryById = useMemo(() => {
    const m = new Map<string, CategoryMeta>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  const columns: ProColumns<FeedRow>[] = useMemo(
    () => [
      {
        title: "Час",
        dataIndex: "created_at",
        width: 130,
        fixed: "left",
        sorter: (a, b) =>
          new Date(a.created_at).getTime() -
          new Date(b.created_at).getTime(),
        defaultSortOrder: "descend",
        render: (_, row) => (
          <Text style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
            {formatRelative(row.created_at)}
          </Text>
        ),
      },
      {
        title: "Категорія",
        dataIndex: "category",
        width: 180,
        filters: categoryFilters,
        onFilter: (value, row) => row.category === value,
        render: (_, row) => {
          const cat = categoryById.get(row.category);
          const color = cat ? TINT_COLOR[cat.tint] ?? "default" : "default";
          return (
            <Tag color={color} bordered={false}>
              <span aria-hidden style={{ marginInlineEnd: 4 }}>
                {row.category_emoji ?? cat?.emoji ?? "📝"}
              </span>
              {row.category_title ?? cat?.title ?? row.category}
            </Tag>
          );
        },
      },
      {
        title: "Магазин",
        dataIndex: "store_name",
        width: 160,
        ellipsis: true,
        filters: storeFilters.length > 0 ? storeFilters : undefined,
        filterSearch: true,
        onFilter: (value, row) => row.store_name === value,
        render: (_, row) =>
          row.store_name ?? <Text type="secondary">—</Text>,
      },
      {
        title: "Хто",
        dataIndex: "user_full_name",
        width: 160,
        ellipsis: true,
        render: (_, row) => {
          const a = authorOf(row);
          return (
            <Space size={4}>
              <Text style={{ fontSize: 13 }}>{a}</Text>
              {row.user_role === "admin" ? (
                <Tag color="magenta" bordered={false}>
                  адмін
                </Tag>
              ) : null}
            </Space>
          );
        },
      },
      {
        title: "Резюме",
        dataIndex: "summary",
        ellipsis: true,
        render: (_, row) => (
          <Text style={{ fontSize: 13 }}>{row.summary}</Text>
        ),
      },
      {
        title: "Статус",
        dataIndex: "status",
        width: 120,
        filters: statusFilters,
        onFilter: (value, row) => row.status === value,
        render: (_, row) => {
          const meta = STATUS_META[row.status] ?? {
            text: row.status,
            color: "default",
          };
          return (
            <Tag color={meta.color} bordered={false}>
              {meta.text}
            </Tag>
          );
        },
      },
      {
        title: <PictureOutlined />,
        dataIndex: "photo_url",
        width: 50,
        align: "center",
        render: (_, row) =>
          row.photo_url ? (
            <CameraOutlined style={{ color: token.colorPrimary }} />
          ) : (
            <Text type="secondary" style={{ fontSize: 11 }}>
              —
            </Text>
          ),
      },
    ],
    [
      categoryFilters,
      categoryById,
      storeFilters,
      statusFilters,
      token,
    ],
  );

  return (
    <>
      <ProTable<FeedRow>
        rowKey="id"
        dataSource={filteredByPeriod}
        columns={columns}
        search={false}
        options={{
          density: true,
          fullScreen: true,
          reload: false,
          setting: true,
        }}
        pagination={{
          pageSize: 25,
          showSizeChanger: true,
          showTotal: (total) => `${total} записів`,
        }}
        scroll={{ x: 1100 }}
        onRow={(row) => ({
          onClick: () => setActive(row),
          style: { cursor: "pointer" },
        })}
        headerTitle={
          <Space size={8}>
            <Text strong>Стрічка фідбеку</Text>
            <Tag color="magenta" bordered={false}>
              {newLast7Days} нових за 7 днів
            </Tag>
          </Space>
        }
        toolBarRender={() => [
          <Segmented<Period>
            key="period"
            value={period}
            onChange={(v) => setPeriod(v as Period)}
            options={(Object.keys(PERIOD_LABELS) as Period[]).map((p) => ({
              label: PERIOD_LABELS[p],
              value: p,
            }))}
          />,
          <Button
            key="export-csv"
            icon={<DownloadOutlined />}
            href="/api/feedback?format=csv"
          >
            CSV
          </Button>,
        ]}
      />

      <FeedDrawer
        row={active}
        category={active ? categoryById.get(active.category) ?? null : null}
        onClose={() => setActive(null)}
      />
    </>
  );
}

function FeedDrawer({
  row,
  category,
  onClose,
}: {
  row: FeedRow | null;
  category: CategoryMeta | null;
  onClose: () => void;
}) {
  const { token } = antdTheme.useToken();
  if (!row) {
    return <Drawer open={false} onClose={onClose} />;
  }

  const fieldEntries = row.fields ? Object.entries(row.fields) : [];
  const meta = STATUS_META[row.status] ?? {
    text: row.status,
    color: "default",
  };
  const tintColor = category ? TINT_COLOR[category.tint] ?? "default" : "default";

  return (
    <Drawer
      open
      onClose={onClose}
      width={520}
      title={
        <Space size={8} wrap>
          <Tag color={tintColor} bordered={false}>
            <span aria-hidden style={{ marginInlineEnd: 4 }}>
              {row.category_emoji ?? category?.emoji ?? "📝"}
            </span>
            {row.category_title ?? category?.title ?? row.category}
          </Tag>
          <Tag color={meta.color} bordered={false}>
            {meta.text}
          </Tag>
        </Space>
      }
      extra={
        <Text type="secondary" style={{ fontSize: 12 }}>
          {new Date(row.created_at).toLocaleString("uk-UA")}
        </Text>
      }
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Space size={12} wrap>
          {row.store_name ? (
            <Space size={4}>
              <ShopOutlined style={{ color: token.colorPrimary }} />
              <Text>{row.store_name}</Text>
            </Space>
          ) : null}
          <Space size={4}>
            <UserOutlined style={{ color: token.colorPrimary }} />
            <Text>{authorOf(row)}</Text>
            {row.user_role === "admin" ? (
              <Tag color="magenta" bordered={false}>
                адмін
              </Tag>
            ) : null}
          </Space>
          <Space size={4}>
            <CalendarOutlined style={{ color: token.colorPrimary }} />
            <Text type="secondary">{formatRelative(row.created_at)}</Text>
          </Space>
        </Space>

        {fieldEntries.length > 0 ? (
          <div>
            <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
              Деталі
            </Title>
            <dl style={{ margin: 0 }}>
              {fieldEntries.map(([k, v]) =>
                v == null || v === "" ? null : (
                  <div
                    key={k}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      paddingBlock: 6,
                      borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    }}
                  >
                    <Text
                      type="secondary"
                      style={{
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                      }}
                    >
                      {k}
                    </Text>
                    <Paragraph
                      style={{
                        margin: 0,
                        marginTop: 2,
                        whiteSpace: "pre-wrap",
                        fontSize: 14,
                      }}
                    >
                      {String(v)}
                    </Paragraph>
                  </div>
                ),
              )}
            </dl>
          </div>
        ) : (
          <Paragraph style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {row.summary}
          </Paragraph>
        )}

        {row.photo_url ? (
          <div>
            <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
              Фото
            </Title>
            <Image
              src={row.photo_url}
              alt="фото фідбеку"
              style={{
                borderRadius: 8,
                maxHeight: 480,
                objectFit: "contain",
              }}
            />
          </div>
        ) : null}

        {row.tg_username || row.tg_display_name ? (
          <div>
            <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
              Telegram
            </Title>
            <Space size={4} wrap>
              {row.tg_username ? (
                <Tag bordered={false}>@{row.tg_username}</Tag>
              ) : null}
              {row.tg_display_name &&
              row.tg_display_name !== row.user_full_name ? (
                <Tag bordered={false}>{row.tg_display_name}</Tag>
              ) : null}
              {row.tg_verified ? (
                <Tag color="green" bordered={false}>
                  verified
                </Tag>
              ) : null}
            </Space>
          </div>
        ) : null}
      </Space>
    </Drawer>
  );
}
