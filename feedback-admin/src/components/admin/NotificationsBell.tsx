"use client";

import { BellOutlined, CheckOutlined } from "@ant-design/icons";
import { Badge, Button, Empty, List, Popover, Spin, Typography, theme as antdTheme } from "antd";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const { Text } = Typography;

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  feedback_id: string | null;
  is_read: boolean;
  created_at: string;
}

const POLL_MS = 30_000;

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "щойно";
  if (min < 60) return `${min} хв тому`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} год тому`;
  return `${Math.floor(hr / 24)} дн тому`;
}

export function NotificationsBell() {
  const { token } = antdTheme.useToken();
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/notifications?limit=20");
      if (!res.ok) throw new Error("bad_status");
      const json = (await res.json()) as {
        notifications: NotificationItem[];
        unread_count: number;
      };
      if (!mountedRef.current) return;
      setItems(json.notifications ?? []);
      setUnreadCount(json.unread_count ?? 0);
      setError(false);
    } catch {
      if (mountedRef.current) setError(true);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    const interval = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await fetch(`/api/admin/notifications/${id}/read`, { method: "POST" });
    } catch {
      // Optimistic update; a stale bell recovers on the next poll.
    }
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    try {
      await fetch("/api/admin/notifications/read-all", { method: "POST" });
    } catch {
      // Optimistic update; a stale bell recovers on the next poll.
    }
  }, []);

  const onItemClick = useCallback(
    (item: NotificationItem) => {
      if (!item.is_read) markRead(item.id);
      setOpen(false);
      router.push("/admin/tasks");
    },
    [markRead, router],
  );

  const content = (
    <div style={{ width: 320 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <Text strong>Сповіщення</Text>
        {unreadCount > 0 ? (
          <Button type="link" size="small" icon={<CheckOutlined />} onClick={markAllRead}>
            Прочитати всі
          </Button>
        ) : null}
      </div>
      {loading && items.length === 0 ? (
        <div style={{ textAlign: "center", padding: 16 }}>
          <Spin size="small" />
        </div>
      ) : error && items.length === 0 ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          Не вдалося завантажити сповіщення.
        </Text>
      ) : items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Немає сповіщень"
          style={{ margin: "16px 0" }}
        />
      ) : (
        <List
          style={{ maxHeight: 360, overflowY: "auto" }}
          dataSource={items}
          renderItem={(item) => (
            <List.Item
              onClick={() => onItemClick(item)}
              style={{
                cursor: "pointer",
                padding: "8px 6px",
                background: item.is_read ? "transparent" : token.colorPrimaryBg,
                borderRadius: 8,
              }}
            >
              <div style={{ width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <Text strong style={{ fontSize: 13 }}>
                    {item.title}
                  </Text>
                  {!item.is_read ? (
                    <span
                      aria-hidden
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: token.colorPrimary,
                        marginTop: 4,
                        flexShrink: 0,
                      }}
                    />
                  ) : null}
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {item.body}
                </Text>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {formatRelative(item.created_at)}
                  </Text>
                </div>
              </div>
            </List.Item>
          )}
        />
      )}
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
    >
      <Badge count={unreadCount} size="small" offset={[-2, 2]}>
        <Button
          type="text"
          shape="circle"
          icon={<BellOutlined style={{ fontSize: 18 }} />}
          aria-label="Сповіщення"
        />
      </Badge>
    </Popover>
  );
}
