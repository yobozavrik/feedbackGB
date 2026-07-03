"use client";

import { PlusOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Drawer,
  Empty,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
  theme as antdTheme,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import type { AdminUser } from "@/app/(admin)/admin/users/page";
import { CATEGORIES } from "@/lib/categories";
import {
  createDirection,
  fetchDirections,
  setDirectionActive,
  type AdminDirectionRow,
} from "@/lib/adminDirectionsApi";

const { Text } = Typography;

interface Props {
  target: AdminUser | null;
  stores: Array<{ id: number; name: string }>;
  currentUserRole: "admin" | "super_admin";
  onClose: () => void;
  /** Called after a rule is added or toggled, so the parent can refresh the
   * server-fetched `directions` list (used for the at-a-glance emoji next
   * to each admin's name in the table). */
  onChanged?: () => void;
}

/**
 * Per-admin "напрямки" (responsibility) editor. See
 * feedback-admin/docs/ADMIN_DIRECTIONS_PLAN.md. Only super_admin can
 * add/toggle rules; a regular admin viewing their own card sees a
 * read-only list (matches the write endpoints, which reject non-super_admin
 * server-side regardless of what this UI shows).
 */
export function DirectionsDrawer({ target, stores, currentUserRole, onClose, onChanged }: Props) {
  const { message } = App.useApp();
  const { token } = antdTheme.useToken();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AdminDirectionRow[]>([]);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [storeId, setStoreId] = useState<number | undefined>(undefined); // undefined = all stores
  const [saving, setSaving] = useState(false);

  const canEdit = currentUserRole === "super_admin";

  useEffect(() => {
    if (!target) {
      setRows([]);
      return;
    }
    let active = true;
    setLoading(true);
    fetchDirections()
      .then((all) => {
        if (!active) return;
        setRows((all ?? []).filter((r) => r.admin_id === target.id));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [target]);

  const storeOptions = useMemo(
    () => stores.map((s) => ({ label: s.name, value: s.id })),
    [stores],
  );

  async function refresh() {
    if (!target) return;
    const all = await fetchDirections();
    setRows((all ?? []).filter((r) => r.admin_id === target.id));
  }

  async function handleAdd() {
    if (!target || !category) return;
    setSaving(true);
    const result = await createDirection({
      admin_id: target.id,
      category,
      store_id: storeId ?? null,
    });
    setSaving(false);
    if (!result.ok) {
      message.error(result.error ?? "Не вдалося створити напрямок");
      return;
    }
    message.success("Напрямок додано");
    setCategory(undefined);
    setStoreId(undefined);
    await refresh();
    onChanged?.();
  }

  async function handleToggle(row: AdminDirectionRow, nextActive: boolean) {
    const result = await setDirectionActive(row.id, nextActive);
    if (!result.ok) {
      message.error(result.error ?? "Не вдалося оновити напрямок");
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, is_active: nextActive } : r)));
    onChanged?.();
  }

  return (
    <Drawer
      title={`Напрямки: ${target?.full_name ?? ""}`}
      placement="right"
      width={420}
      onClose={onClose}
      open={target != null}
      destroyOnClose
    >
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <Spin size="large" />
        </div>
      ) : rows.length === 0 ? (
        <Empty description="Напрямки ще не налаштовано" />
      ) : (
        <Space direction="vertical" style={{ width: "100%" }} size={8}>
          {rows.map((row) => (
            <div
              key={row.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 8,
              }}
            >
              <div>
                <Text strong>{row.category_title ?? row.category}</Text>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {row.store_name ?? "Всі магазини"}
                  </Text>
                </div>
              </div>
              {canEdit ? (
                <Switch checked={row.is_active} onChange={(checked) => handleToggle(row, checked)} />
              ) : (
                <Tag color={row.is_active ? "green" : "default"} bordered={false}>
                  {row.is_active ? "активний" : "вимкнено"}
                </Tag>
              )}
            </div>
          ))}
        </Space>
      )}

      {canEdit ? (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
          <Text strong style={{ display: "block", marginBottom: 8 }}>
            Додати напрямок
          </Text>
          <Space direction="vertical" style={{ width: "100%" }} size={8}>
            <Select
              placeholder="Категорія заявки"
              style={{ width: "100%" }}
              value={category}
              onChange={setCategory}
              options={CATEGORIES.map((c) => ({ label: `${c.emoji} ${c.title}`, value: c.id }))}
            />
            <Select
              placeholder="Всі магазини"
              allowClear
              style={{ width: "100%" }}
              value={storeId}
              onChange={setStoreId}
              options={storeOptions}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              block
              loading={saving}
              disabled={!category}
              onClick={handleAdd}
            >
              Додати
            </Button>
          </Space>
        </div>
      ) : null}
    </Drawer>
  );
}
