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
  App,
  Button,
  Drawer,
  Image,
  Input,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  theme as antdTheme,
} from "antd";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import type { AdminOption, FeedRow } from "./page";

const { Text, Paragraph, Title } = Typography;
const { TextArea } = Input;

type Period = "all" | "today" | "week" | "month";
type Status = "new" | "in_progress" | "resolved" | "rejected";

const STATUSES: Status[] = ["new", "in_progress", "resolved", "rejected"];

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
  admins: AdminOption[];
  currentAdminId: string | null;
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

const STATUS_META: Record<Status, { text: string; color: string }> = {
  new: { text: "Нове", color: "green" },
  in_progress: { text: "В роботі", color: "gold" },
  resolved: { text: "Закрито", color: "default" },
  rejected: { text: "Відхилено", color: "purple" },
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

function isStatus(s: string): s is Status {
  return (STATUSES as string[]).includes(s);
}

export function AdminClient({
  rows,
  stores,
  categories,
  admins,
  currentAdminId,
}: Props) {
  const { token } = antdTheme.useToken();
  const [period, setPeriod] = useState<Period>("all");
  const [active, setActive] = useState<FeedRow | null>(null);
  const [myQueueOnly, setMyQueueOnly] = useState(false);

  const filteredByPeriod = useMemo(() => {
    const cutoff = periodCutoff(period);
    let out = cutoff === 0
      ? rows
      : rows.filter((r) => new Date(r.created_at).getTime() >= cutoff);
    if (myQueueOnly && currentAdminId) {
      out = out.filter((r) => r.assigned_to === currentAdminId);
    }
    return out;
  }, [rows, period, myQueueOnly, currentAdminId]);

  const newLast7Days = useMemo(
    () =>
      rows.filter(
        (r) =>
          new Date(r.created_at).getTime() >
          Date.now() - 7 * 24 * 60 * 60 * 1000,
      ).length,
    [rows],
  );

  const myQueueCount = useMemo(
    () =>
      currentAdminId
        ? rows.filter((r) => r.assigned_to === currentAdminId).length
        : 0,
    [rows, currentAdminId],
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
      (Object.keys(STATUS_META) as Status[]).map((value) => ({
        text: STATUS_META[value].text,
        value,
      })),
    [],
  );

  const adminFilters = useMemo(
    () => [
      { text: "— не призначено", value: "__none__" },
      ...admins.map((a) => ({ text: a.full_name, value: a.id })),
    ],
    [admins],
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
        title: "Призначено",
        dataIndex: "assigned_to",
        width: 150,
        ellipsis: true,
        filters: adminFilters,
        onFilter: (value, row) => {
          if (value === "__none__") return row.assigned_to == null;
          return row.assigned_to === value;
        },
        render: (_, row) =>
          row.assigned_full_name ? (
            <Space size={4}>
              <UserOutlined style={{ color: token.colorPrimary }} />
              <Text style={{ fontSize: 13 }}>{row.assigned_full_name}</Text>
              {row.assigned_to === currentAdminId ? (
                <Tag color="magenta" bordered={false}>
                  я
                </Tag>
              ) : null}
            </Space>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              —
            </Text>
          ),
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
          const meta = isStatus(row.status)
            ? STATUS_META[row.status]
            : { text: row.status, color: "default" };
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
      adminFilters,
      currentAdminId,
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
        scroll={{ x: 1250 }}
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
          currentAdminId ? (
            <Space key="my-queue" size={6}>
              <Switch
                checked={myQueueOnly}
                onChange={setMyQueueOnly}
                size="small"
              />
              <Text style={{ fontSize: 13 }}>Моя черга</Text>
              {myQueueCount > 0 ? (
                <Tag bordered={false}>{myQueueCount}</Tag>
              ) : null}
            </Space>
          ) : null,
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
        admins={admins}
        currentAdminId={currentAdminId}
        onClose={() => setActive(null)}
      />
    </>
  );
}

function FeedDrawer({
  row,
  category,
  admins,
  currentAdminId,
  onClose,
}: {
  row: FeedRow | null;
  category: CategoryMeta | null;
  admins: AdminOption[];
  currentAdminId: string | null;
  onClose: () => void;
}) {
  const { token } = antdTheme.useToken();
  const { message } = App.useApp();
  const router = useRouter();

  // Драфт-стан керується ключем по id, щоб при перемиканні рядка все
  // скинулось без явних effect-ів.
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<Status>("new");
  const [draftAssignee, setDraftAssignee] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  if (row && row.id !== draftKey) {
    setDraftKey(row.id);
    setDraftStatus(isStatus(row.status) ? row.status : "new");
    setDraftAssignee(row.assigned_to);
    setComment("");
  }

  const handleSave = useCallback(async () => {
    if (!row) return;
    const body: Record<string, unknown> = {};
    if (draftStatus !== row.status) body.status = draftStatus;
    if (draftAssignee !== row.assigned_to) body.assigned_to = draftAssignee;
    const trimmed = comment.trim();
    if (trimmed.length > 0) body.comment = trimmed;
    if (Object.keys(body).length === 0) {
      message.info("Немає змін для збереження.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/feedback/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        message.error(data.error ?? `Помилка ${res.status}`);
        return;
      }
      message.success("Збережено");
      setComment("");
      router.refresh();
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Помилка мережі");
    } finally {
      setSaving(false);
    }
  }, [row, draftStatus, draftAssignee, comment, message, router, onClose]);

  if (!row) {
    return <Drawer open={false} onClose={onClose} />;
  }

  const fieldEntries = row.fields ? Object.entries(row.fields) : [];
  const meta = isStatus(row.status)
    ? STATUS_META[row.status]
    : { text: row.status, color: "default" };
  const tintColor = category ? TINT_COLOR[category.tint] ?? "default" : "default";

  const adminOptions = admins.map((a) => ({
    label: a.id === currentAdminId ? `${a.full_name} (я)` : a.full_name,
    value: a.id,
  }));

  const dirty =
    draftStatus !== row.status ||
    draftAssignee !== row.assigned_to ||
    comment.trim().length > 0;

  return (
    <Drawer
      open
      onClose={onClose}
      width={560}
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

        {/* === КЕРУВАННЯ === */}
        <div
          style={{
            background: token.colorFillAlter,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG,
            padding: 12,
          }}
        >
          <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
            Управління
          </Title>
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <div>
              <Text
                type="secondary"
                style={{ fontSize: 11, textTransform: "uppercase" }}
              >
                Статус
              </Text>
              <div style={{ marginTop: 4 }}>
                <Segmented<Status>
                  value={draftStatus}
                  onChange={(v) => setDraftStatus(v as Status)}
                  options={STATUSES.map((s) => ({
                    label: STATUS_META[s].text,
                    value: s,
                  }))}
                />
              </div>
            </div>
            <div>
              <Text
                type="secondary"
                style={{ fontSize: 11, textTransform: "uppercase" }}
              >
                Призначено
              </Text>
              <div style={{ marginTop: 4 }}>
                <Space size={6} wrap>
                  <Select
                    style={{ minWidth: 220 }}
                    placeholder="— не призначено"
                    value={draftAssignee ?? undefined}
                    onChange={(v) => setDraftAssignee(v ?? null)}
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    options={adminOptions}
                  />
                  {currentAdminId && draftAssignee !== currentAdminId ? (
                    <Button
                      size="small"
                      onClick={() => setDraftAssignee(currentAdminId)}
                    >
                      На себе
                    </Button>
                  ) : null}
                </Space>
              </div>
            </div>
            <div>
              <Text
                type="secondary"
                style={{ fontSize: 11, textTransform: "uppercase" }}
              >
                Коментар (опціонально)
              </Text>
              <TextArea
                style={{ marginTop: 4 }}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Що зробив / куди передав / коли очікувати… Запис потрапить у Журнал."
                maxLength={500}
                showCount
                autoSize={{ minRows: 2, maxRows: 4 }}
              />
            </div>
            <Space>
              <Button
                type="primary"
                onClick={handleSave}
                loading={saving}
                disabled={!dirty}
              >
                Зберегти
              </Button>
              {dirty ? (
                <Button
                  onClick={() => {
                    setDraftStatus(isStatus(row.status) ? row.status : "new");
                    setDraftAssignee(row.assigned_to);
                    setComment("");
                  }}
                  disabled={saving}
                >
                  Скинути
                </Button>
              ) : null}
            </Space>
          </Space>
        </div>

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
