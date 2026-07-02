"use client";

import {
  CameraOutlined,
  DownloadOutlined,
  PictureOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import {
  App,
  Button,
  Segmented,
  Space,
  Switch,
  Tag,
  Typography,
  theme as antdTheme,
} from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { FeedDrawer } from "@/components/admin/feed/FeedDrawer";
import {
  authorOf,
  formatRelative,
  TINT_COLOR,
  type CategoryMeta,
} from "@/lib/feedFormat";
import {
  ageMs,
  bucketFor,
  formatAge,
  isOpen,
  type AgingBucket,
} from "@/lib/sla";
import { getClientSupabase } from "@/lib/supabase";
import {
  FEEDBACK_STATUS_META,
  isFeedbackStatus,
  type FeedbackStatus,
} from "@/lib/feedbackStatus";
import type { AdminOption, FeedRow } from "./page";

const { Text } = Typography;

type Period = "all" | "today" | "week" | "month";

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
            <Space key="my-queue" size={6} style={{ whiteSpace: "nowrap" }}>
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
