"use client";

import {
  CalendarOutlined,
  CameraOutlined,
  CommentOutlined,
  DownloadOutlined,
  MessageOutlined,
  PictureOutlined,
  SendOutlined,
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
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ageMs,
  bucketFor,
  formatAge,
  isOpen,
  type AgingBucket,
} from "@/lib/sla";
import { getClientSupabase } from "@/lib/supabase";
import {
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_META,
  isFeedbackStatus,
  type FeedbackStatus,
} from "@/lib/feedbackStatus";
import type { AdminOption, FeedRow } from "./page";

const { Text, Paragraph, Title } = Typography;
const { TextArea } = Input;

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
  admins: AdminOption[];
  currentAdminId: string | null;
  assignedToMeOnly?: boolean;
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

const AGING_TAG: Record<AgingBucket, string> = {
  warm: "default",
  stale: "gold",
  overdue: "orange",
  critical: "red",
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

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    console.error("Audio playback failed", e);
  }
}

export function AdminClient({
  rows,
  stores,
  categories,
  admins,
  currentAdminId,
  assignedToMeOnly = false,
}: Props) {
  const { token } = antdTheme.useToken();
  const { notification } = App.useApp();
  const router = useRouter();
  const [period, setPeriod] = useState<Period>("all");
  const [active, setActive] = useState<FeedRow | null>(null);
  const [myQueueOnly, setMyQueueOnly] = useState(assignedToMeOnly);

  useEffect(() => {
    const supabase = getClientSupabase();
    if (!supabase) return;

    const channel = supabase
      .channel("admin_feedback_realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "feedbackgb",
          table: "feedback",
        },
        async (payload) => {
          // Trigger next.js server-side revalidation
          router.refresh();

          if (payload.eventType === "INSERT") {
            const rowData = payload.new;
            const categoryId = rowData.category_id;
            const summary = rowData.summary || "Нове звернення";

            const soundEnabled = localStorage.getItem("fbgb_sound_enabled") !== "false";
            const pushEnabled = localStorage.getItem("fbgb_push_enabled") === "true";

            if (categoryId === "defect" && soundEnabled) {
              playNotificationSound();
            }

            notification.info({
              message: "Нове звернення",
              description: summary,
              placement: "bottomRight",
            });

            if (pushEnabled && typeof window !== "undefined" && "Notification" in window) {
              if (Notification.permission === "granted") {
                new Notification("FeedbackGB: Нове звернення", {
                  body: summary,
                });
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [router, notification]);

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
      (Object.keys(FEEDBACK_STATUS_META) as FeedbackStatus[]).map((value) => ({
        text: FEEDBACK_STATUS_META[value].text,
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
        defaultSortOrder: "descend",
        sorter: (a, b) =>
          new Date(a.created_at).getTime() -
          new Date(b.created_at).getTime(),
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
          const meta = isFeedbackStatus(row.status)
            ? FEEDBACK_STATUS_META[row.status]
            : { text: row.status, color: "default" };
          return (
            <Tag color={meta.color} bordered={false}>
              {meta.text}
            </Tag>
          );
        },
      },
      {
        title: "Висить",
        key: "aging",
        width: 110,
        sorter: (a, b) => {
          // Closed rows always sink to the bottom regardless of sort direction;
          // among open rows we compare age (висить довше → більше значення).
          const aOpen = isOpen(a.status);
          const bOpen = isOpen(b.status);
          if (aOpen !== bOpen) return aOpen ? 1 : -1;
          if (!aOpen) return 0;
          return ageMs(a.created_at) - ageMs(b.created_at);
        },
        render: (_, row) => {
          if (!isOpen(row.status)) {
            return (
              <Text type="secondary" style={{ fontSize: 12 }}>
                —
              </Text>
            );
          }
          const ms = ageMs(row.created_at);
          const bucket = bucketFor(ms);
          const tagColor = AGING_TAG[bucket];
          return (
            <Tag
              color={tagColor}
              bordered={false}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatAge(ms)}
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
        className="admin-feed-table"
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
          currentAdminId && !assignedToMeOnly ? (
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
  const [draftStatus, setDraftStatus] = useState<FeedbackStatus>("new");
  const [draftAssignee, setDraftAssignee] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  if (row && row.id !== draftKey) {
    setDraftKey(row.id);
    setDraftStatus(isFeedbackStatus(row.status) ? row.status : "new");
    setDraftAssignee(row.assigned_to);
    setComment("");
  } else if (!row && draftKey !== null) {
    // Скидаємо draftKey при закритті — щоб повторне відкриття того ж рядка
    // підхопило свіжі серверні значення (а не залишилось зі stale draft-ом).
    setDraftKey(null);
  }

  const [commentsList, setCommentsList] = useState<any[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newCommentText, setNewCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  const fetchComments = useCallback(async (feedbackId: string) => {
    setLoadingComments(true);
    try {
      const res = await fetch(`/api/admin/feedback/${feedbackId}/comments`);
      if (res.ok) {
        const data = await res.json();
        setCommentsList(data.comments ?? []);
      }
    } catch (e) {
      console.error("Failed to load comments", e);
    } finally {
      setLoadingComments(false);
    }
  }, []);

  useEffect(() => {
    if (row?.id) {
      fetchComments(row.id);
    } else {
      setCommentsList([]);
    }
  }, [row?.id, fetchComments]);

  const handleAddComment = useCallback(async () => {
    if (!row || !newCommentText.trim()) return;
    setSubmittingComment(true);
    try {
      const res = await fetch(`/api/admin/feedback/${row.id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: newCommentText }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        message.error(data.error ?? "Не вдалося додати коментар");
        return;
      }
      message.success("Коментар додано");
      setNewCommentText("");
      fetchComments(row.id);
    } catch (e) {
      message.error("Помилка мережі");
    } finally {
      setSubmittingComment(false);
    }
  }, [row, newCommentText, fetchComments, message]);

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
  const meta = isFeedbackStatus(row.status)
    ? FEEDBACK_STATUS_META[row.status]
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
      className="admin-feed-drawer"
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

        {row.product_name ? (
          <div
            style={{
              background: token.colorInfoBg,
              border: `1px solid ${token.colorInfoBorder}`,
              borderRadius: token.borderRadiusLG,
              padding: "8px 12px",
            }}
          >
            <Text
              type="secondary"
              style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}
            >
              Обраний товар
            </Text>
            <div style={{ marginTop: 2 }}>
              <Text strong style={{ fontSize: 14 }}>
                {row.product_name}
              </Text>
              {row.product_unit ? (
                <Text type="secondary" style={{ marginLeft: 6, fontSize: 13 }}>
                  ({row.product_unit})
                </Text>
              ) : null}
            </div>
          </div>
        ) : null}

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
                <Segmented<FeedbackStatus>
                  value={draftStatus}
                  onChange={(v) => setDraftStatus(v as FeedbackStatus)}
                  options={FEEDBACK_STATUSES.map((s) => ({
                    label: FEEDBACK_STATUS_META[s].text,
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
                    setDraftStatus(isFeedbackStatus(row.status) ? row.status : "new");
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

        {/* === ОБГОВОРЕННЯ (КОМЕНТАРІ) === */}
        <div
          style={{
            marginTop: 8,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            paddingTop: 16,
          }}
        >
          <Title level={5} style={{ margin: 0, marginBottom: 12 }}>
            <CommentOutlined style={{ marginRight: 6 }} /> Обговорення
          </Title>

          {/* Comments List */}
          <div
            style={{
              maxHeight: 300,
              overflowY: "auto",
              marginBottom: 16,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {loadingComments ? (
              <Text type="secondary" style={{ fontSize: 13 }}>Завантаження коментарів...</Text>
            ) : commentsList.length === 0 ? (
              <Text type="secondary" style={{ fontSize: 13, fontStyle: "italic" }}>
                Коментарів ще немає. Ви можете написати повідомлення продавчині.
              </Text>
            ) : (
              commentsList.map((c) => {
                const isAdmin = c.author_role === "admin" || c.author_role === "super_admin";
                return (
                  <div
                    key={c.id}
                    style={{
                      background: isAdmin ? token.colorFillAlter : "transparent",
                      border: `1px solid ${token.colorBorderSecondary}`,
                      borderRadius: token.borderRadius,
                      padding: "8px 12px",
                      maxWidth: "90%",
                      alignSelf: isAdmin ? "flex-start" : "flex-end",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
                      <Space size={4}>
                        <Text strong style={{ fontSize: 12 }}>{c.author_name}</Text>
                        <Tag
                          color={c.author_role === "super_admin" ? "red" : c.author_role === "admin" ? "magenta" : "default"}
                          bordered={false}
                          style={{ fontSize: 10, lineHeight: "14px", height: "16px", paddingInline: 4 }}
                        >
                          {c.author_role === "super_admin" ? "супер-адмін" : c.author_role === "admin" ? "адмін" : "продавець"}
                        </Tag>
                      </Space>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {formatRelative(c.created_at)}
                      </Text>
                    </div>
                    <Paragraph style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>
                      {c.body}
                    </Paragraph>
                  </div>
                );
              })
            )}
          </div>

          {/* New Comment Form */}
          <Space.Compact style={{ width: "100%" }}>
            <Input
              value={newCommentText}
              onChange={(e) => setNewCommentText(e.target.value)}
              placeholder="Написати повідомлення продавчині..."
              onPressEnter={handleAddComment}
              disabled={submittingComment}
              maxLength={2000}
            />
            <Button
              type="primary"
              onClick={handleAddComment}
              loading={submittingComment}
              disabled={!newCommentText.trim()}
              icon={<SendOutlined />}
            />
          </Space.Compact>
        </div>
      </Space>
    </Drawer>
  );
}
