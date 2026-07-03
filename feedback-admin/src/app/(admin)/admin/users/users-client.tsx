"use client";

import {
  KeyOutlined,
  ReloadOutlined,
  UnlockOutlined,
  EditOutlined,
  PlusOutlined,
  StopOutlined,
  CheckCircleOutlined,
  HistoryOutlined,
  TeamOutlined,
  CompassOutlined,
} from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import {
  App,
  Button,
  Popconfirm,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme as antdTheme,
  Form,
  Segmented,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ActivityDrawer } from "@/components/admin/users/ActivityDrawer";
import { CreateUserModal } from "@/components/admin/users/CreateUserModal";
import { DirectionsDrawer } from "@/components/admin/users/DirectionsDrawer";
import { EditUserModal } from "@/components/admin/users/EditUserModal";
import {
  ResetPinModal,
  type ResetPinValues,
} from "@/components/admin/users/ResetPinModal";
import {
  createUser,
  fetchAdminActivity,
  patchUser,
  setUserPin,
  unlockUser,
  type ActivityLogEntry,
  type CreateUserValues,
  type EditUserValues,
} from "@/lib/adminUsersApi";
import { countryFlag, formatGeoLines } from "@/lib/geoip";
import { CATEGORIES } from "@/lib/categories";
import type { AdminDirectionSummary, AdminUser, FeedbacksStat } from "./page";

const { Text } = Typography;

interface Props {
  users: AdminUser[];
  stores: Array<{ id: number; name: string }>;
  feedbacks: FeedbacksStat[];
  directions: AdminDirectionSummary[];
  currentUserId: string;
  currentUserRole: "admin" | "super_admin";
}

const MAX_DIRECTION_EMOJI = 4;

type RowState = "active" | "locked" | "inactive" | "no_pin";

function rowState(u: AdminUser): RowState {
  if (!u.is_active) return "inactive";
  if (u.locked_until != null && new Date(u.locked_until) > new Date()) {
    return "locked";
  }
  if (!u.has_pin) return "no_pin";
  return "active";
}

const STATE_META: Record<
  RowState,
  { text: string; status: "Success" | "Error" | "Default" | "Warning" }
> = {
  active: { text: "Активна", status: "Success" },
  locked: { text: "Заблокована", status: "Error" },
  inactive: { text: "Неактивна", status: "Default" },
  no_pin: { text: "Без PIN", status: "Warning" },
};

export function UsersClient({ users, stores, feedbacks, directions, currentUserId, currentUserRole }: Props) {
  const router = useRouter();
  const [list, setList] = useState<AdminUser[]>(users);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();

  const [activityTarget, setActivityTarget] = useState<AdminUser | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [directionsTarget, setDirectionsTarget] = useState<AdminUser | null>(null);

  // Emoji-at-a-glance next to each admin's name (Ім'я column, fixed left —
  // always visible regardless of horizontal scroll). Sourced from the
  // server-fetched `directions` prop; refreshed via router.refresh() after
  // edits in DirectionsDrawer, same pattern as every other mutation here.
  const categoryMetaById = useMemo(() => {
    const m = new Map<string, { emoji: string; title: string }>();
    for (const c of CATEGORIES) m.set(c.id, { emoji: c.emoji, title: c.title });
    return m;
  }, []);

  const directionsByAdmin = useMemo(() => {
    // Dedupe by category per admin: the same category can now have
    // multiple rows (one per store scope, or shared with other admins) —
    // this badge is a "which categories" summary, not a store breakdown
    // (that detail lives in the DirectionsDrawer itself).
    const seenByAdmin = new Map<string, Set<string>>();
    const m = new Map<string, Array<{ emoji: string; title: string }>>();
    for (const d of directions) {
      const meta = categoryMetaById.get(d.category);
      if (!meta) continue;
      const seen = seenByAdmin.get(d.admin_id) ?? new Set<string>();
      if (seen.has(d.category)) continue;
      seen.add(d.category);
      seenByAdmin.set(d.admin_id, seen);
      const arr = m.get(d.admin_id) ?? [];
      arr.push(meta);
      m.set(d.admin_id, arr);
    }
    return m;
  }, [directions, categoryMetaById]);

  // Tab state
  const [activeTab, setActiveTab] = useState<"sellers" | "admin">("sellers");

  const { token } = antdTheme.useToken();
  const { message } = App.useApp();

  useEffect(() => {
    if (createOpen) {
      createForm.resetFields();
    }
  }, [createForm, createOpen]);

  const sellerStats = useMemo(() => {
    const stats = new Map<string, { total: number; categories: Record<string, number> }>();
    for (const f of feedbacks) {
      if (!f.user_id) continue;
      if (!stats.has(f.user_id)) {
        stats.set(f.user_id, { total: 0, categories: {} });
      }
      const uStat = stats.get(f.user_id)!;
      uStat.total += 1;
      uStat.categories[f.category] = (uStat.categories[f.category] ?? 0) + 1;
    }
    return stats;
  }, [feedbacks]);

  // Category emoji/title lookup built from feedbacks data (not imported from feedback-app)
  const categoryLookup = useMemo(() => {
    const map = new Map<string, { emoji: string; title: string }>();
    for (const f of feedbacks) {
      if (!map.has(f.category)) {
        map.set(f.category, {
          emoji: f.category_emoji ?? "📝",
          title: f.category_title ?? f.category,
        });
      }
    }
    return map;
  }, [feedbacks]);

  const sellers = useMemo(() => {
    return list.filter((u) => u.role === "seller");
  }, [list]);

  useEffect(() => {
    if (!activityTarget) {
      setActivityLogs([]);
      return;
    }
    const targetId = activityTarget.id;

    if (activityTarget.role === "seller") {
      const sellerFeeds = feedbacks
        .filter((f) => f.user_id === targetId)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setActivityLogs(
        sellerFeeds.map((f) => ({
          isFeedback: true,
          id: f.id,
          category: f.category,
          category_emoji: f.category_emoji,
          category_title: f.category_title,
          store_name: f.store_name,
          summary: f.summary,
          status: f.status,
          occurred_at: f.created_at,
        }))
      );
      setLoadingActivity(false);
      return;
    }

    let active = true;
    async function fetchActivity() {
      setLoadingActivity(true);
      try {
        const logs = await fetchAdminActivity(targetId);
        if (active) {
          setActivityLogs(logs);
        }
      } catch (err) {
        message.error("Помилка при завантаженні активності");
        console.error("Activity load error:", err);
      } finally {
        if (active) setLoadingActivity(false);
      }
    }
    void fetchActivity();
    return () => {
      active = false;
    };
  }, [activityTarget, feedbacks, message]);

  const updateUser = useCallback(
    (patch: Partial<AdminUser> & { id: string }) =>
      setList((prev) =>
        prev.map((u) => (u.id === patch.id ? { ...u, ...patch } : u)),
      ),
    [],
  );

  const handleUnlock = useCallback(
    async (u: AdminUser) => {
      const result = await unlockUser(u.id);
      if (!result.ok) {
        message.error("Не вдалося розблокувати. Спробуй ще раз.");
        return;
      }
      updateUser({ id: u.id, failed_attempts: 0, locked_until: null });
      message.success(`${u.full_name} розблокована.`);
    },
    [message, updateUser],
  );

  const handleResetPin = useCallback(
    async (values: ResetPinValues) => {
      if (!resetTarget) return false;
      if (values.pin !== values.confirmPin) {
        message.error("Підтвердження не співпадає.");
        return false;
      }
      const result = await setUserPin(resetTarget.id, values.pin);
      if (!result.ok) {
        message.error(result.error ?? "Помилка сервера");
        return false;
      }
      updateUser({
        id: resetTarget.id,
        has_pin: true,
        failed_attempts: 0,
        locked_until: null,
      });
      message.success(
        `PIN для ${resetTarget.full_name} ${
          resetTarget.has_pin ? "оновлено" : "встановлено"
        }.`,
      );
      setResetTarget(null);
      return true;
    },
    [resetTarget, message, updateUser],
  );

  const handleCreateUser = useCallback(
    async (values: CreateUserValues) => {
      const result = await createUser(values);
      if (!result.ok) {
        message.error(result.error ?? "Помилка при створенні");
        return false;
      }
      setList((prev) => [...prev, result.user].sort((a, b) => a.full_name.localeCompare(b.full_name, "uk")));
      message.success(`Користувача ${values.full_name} успішно створено.`);
      setCreateOpen(false);
      createForm.resetFields();
      return true;
    },
    [createForm, message],
  );

  const handleEditUser = useCallback(
    async (values: EditUserValues) => {
      if (!editTarget) return false;
      const result = await patchUser(editTarget.id, values);
      if (!result.ok) {
        message.error(result.error ?? "Помилка при збереженні");
        return false;
      }
      updateUser(result.user);
      message.success(`Зміни для ${result.user.full_name} збережено.`);
      setEditTarget(null);
      editForm.resetFields();
      return true;
    },
    [editTarget, editForm, message, updateUser],
  );

  const handleToggleActive = useCallback(
    async (u: AdminUser, makeActive: boolean) => {
      const result = await patchUser(u.id, { is_active: makeActive });
      if (!result.ok) {
        message.error(result.error ?? "Помилка при зміні статусу");
        return;
      }
      updateUser(result.user);
      message.success(
        `Користувача ${u.full_name} успішно ${makeActive ? "активовано" : "деактивовано"}.`,
      );
    },
    [message, updateUser],
  );

  const storeOptions = useMemo(() => {
    return stores.map((s) => ({ label: s.name, value: s.id }));
  }, [stores]);

  const filterStoreOptions = useMemo(() => {
    const seen = new Map<string, { text: string; value: string }>();
    for (const u of list) {
      if (u.store_name && !seen.has(u.store_name)) {
        seen.set(u.store_name, { text: u.store_name, value: u.store_name });
      }
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.text.localeCompare(b.text, "uk"),
    );
  }, [list]);

  const columns: ProColumns<AdminUser>[] = useMemo(
    () => [
      {
        title: "Імʼя (ФІО)",
        dataIndex: "full_name",
        fixed: "left",
        width: 220,
        ellipsis: true,
        sorter: (a, b) => a.full_name.localeCompare(b.full_name, "uk"),
        render: (_, row) => {
          const adminDirections = row.role !== "seller" ? directionsByAdmin.get(row.id) ?? [] : [];
          const visible = adminDirections.slice(0, MAX_DIRECTION_EMOJI);
          const overflow = adminDirections.length - MAX_DIRECTION_EMOJI;
          return (
            <Space size={6} wrap>
              <Text strong style={{ color: row.is_active ? undefined : token.colorTextDisabled }}>
                {row.full_name}
              </Text>
              {!row.is_active ? (
                <Tag color="default" bordered={false}>
                  неактивна
                </Tag>
              ) : !row.has_pin ? (
                <Tag color="orange" bordered={false}>
                  без PIN
                </Tag>
              ) : null}
              {visible.length > 0 ? (
                <Tooltip
                  title={
                    <div>
                      {adminDirections.map((d, i) => (
                        <div key={i}>
                          {d.emoji} {d.title}
                        </div>
                      ))}
                    </div>
                  }
                >
                  <span aria-hidden style={{ fontSize: 13 }}>
                    {visible.map((d) => d.emoji).join(" ")}
                    {overflow > 0 ? ` +${overflow}` : ""}
                  </span>
                </Tooltip>
              ) : null}
            </Space>
          );
        },
      },
      {
        title: "Отображуване ім'я",
        dataIndex: "display_label",
        width: 220,
        ellipsis: true,
        render: (_, row) => row.display_label ?? <Text type="secondary">—</Text>,
      },
      {
        title: "Роль",
        dataIndex: "role",
        width: 140,
        valueEnum: {
          super_admin: { text: "Супер-адмін" },
          admin: { text: "Адмін" },
          seller: { text: "Продавчиня" },
        },
        filters: [
          { text: "Супер-адмін", value: "super_admin" },
          { text: "Адмін", value: "admin" },
          { text: "Продавчиня", value: "seller" },
        ],
        onFilter: (value, row) => row.role === value,
        render: (_, row) => {
          const color =
            row.role === "super_admin"
              ? "red"
              : row.role === "admin"
                ? "magenta"
                : "default";
          const label =
            row.role === "super_admin"
              ? "супер-адмін"
              : row.role === "admin"
                ? "адмін"
                : "продавчиня";
          return (
            <Tag color={color} bordered={false}>
              {label}
            </Tag>
          );
        },
      },
      {
        title: "Магазин",
        dataIndex: "store_name",
        width: 180,
        ellipsis: true,
        filters: filterStoreOptions.length > 0 ? filterStoreOptions : undefined,
        onFilter: (value, row) => row.store_name === value,
        render: (_, row) =>
          row.store_name ?? <Text type="secondary">—</Text>,
      },
      {
        title: "Стан",
        key: "state",
        width: 120,
        filters: (Object.keys(STATE_META) as RowState[]).map((k) => ({
          text: STATE_META[k].text,
          value: k,
        })),
        onFilter: (value, row) => rowState(row) === value,
        render: (_, row) => {
          const state = rowState(row);
          const meta = STATE_META[state];
          return (
            <Tag
              color={
                state === "active"
                  ? "green"
                  : state === "locked"
                    ? "red"
                    : state === "no_pin"
                      ? "orange"
                      : "default"
              }
              bordered={false}
            >
              {meta.text}
            </Tag>
          );
        },
      },
      {
        title: "Помилок",
        dataIndex: "failed_attempts",
        width: 92,
        align: "right",
        sorter: (a, b) => a.failed_attempts - b.failed_attempts,
        render: (_, row) => {
          if (row.failed_attempts <= 0) {
            return <Text type="secondary">—</Text>;
          }
          const isLocked =
            row.locked_until != null &&
            new Date(row.locked_until) > new Date();
          return (
            <Text
              style={{
                color: isLocked ? token.colorError : token.colorWarning,
              }}
            >
              {row.failed_attempts}
            </Text>
          );
        },
      },
      {
        title: "Останній вхід",
        dataIndex: "last_login",
        width: 190,
        sorter: (a, b) => {
          const ta = a.last_login ? new Date(a.last_login).getTime() : 0;
          const tb = b.last_login ? new Date(b.last_login).getTime() : 0;
          return ta - tb;
        },
        render: (_, row) =>
          row.last_login ? (
            <Space
              direction="vertical"
              size={2}
              style={{ lineHeight: 1.2 }}
            >
              <Text style={{ fontSize: 12 }}>
                {new Date(row.last_login).toLocaleString("uk-UA")}
              </Text>
              <UserLastLocation row={row} />
            </Space>
          ) : (
            <Text type="secondary">жодного</Text>
          ),
      },
      {
        title: "Активність",
        key: "activity",
        width: 140,
        render: (_, row) => {
          const isAllowed =
            currentUserRole === "super_admin" ||
            (currentUserRole === "admin" && row.role === "seller");
          return (
            <Button
              size="small"
              icon={<HistoryOutlined />}
              disabled={!isAllowed}
              onClick={() => setActivityTarget(row)}
            >
              Активність
            </Button>
          );
        },
      },
      {
        title: "Напрямки",
        key: "directions",
        width: 130,
        render: (_, row) => {
          if (row.role === "seller") return null;
          const canView = currentUserRole === "super_admin" || row.id === currentUserId;
          if (!canView) return <Text type="secondary">—</Text>;
          return (
            <Button
              size="small"
              icon={<CompassOutlined />}
              onClick={() => setDirectionsTarget(row)}
            >
              Напрямки
            </Button>
          );
        },
      },
      {
        title: "Дії",
        key: "actions",
        valueType: "option",
        fixed: "right",
        width: 380,
        render: (_, row) => {
          const isLocked =
            row.locked_until != null &&
            new Date(row.locked_until) > new Date();

          // RBAC: admin can only edit/manage sellers
          const isEditable =
            currentUserRole === "super_admin" ||
            (currentUserRole === "admin" && row.role === "seller");

          const isSelf = currentUserId === row.id;

          return [
            <Button
              key="edit"
              type="link"
              size="small"
              icon={<EditOutlined />}
              disabled={!isEditable}
              onClick={() => {
                setEditTarget(row);
                editForm.setFieldsValue({
                  full_name: row.full_name,
                  display_label: row.display_label,
                  role: row.role,
                  store_id: row.store_id,
                  is_active: row.is_active,
                });
              }}
            >
              Редагувати
            </Button>,
            <Button
              key="reset"
              type="link"
              size="small"
              disabled={!isEditable}
              icon={row.has_pin ? <ReloadOutlined /> : <KeyOutlined />}
              onClick={() => setResetTarget(row)}
            >
              {row.has_pin ? "Змінити PIN" : "Створити PIN"}
            </Button>,
            isLocked ? (
              <Popconfirm
                key="unlock"
                title="Розблокувати акаунт?"
                description={`Скинути лічильник помилок для ${row.full_name}.`}
                okText="Так"
                cancelText="Скасувати"
                disabled={!isEditable}
                onConfirm={() => handleUnlock(row)}
              >
                <Button key="unlock-btn" type="link" size="small" icon={<UnlockOutlined />} disabled={!isEditable}>
                  Розблокувати
                </Button>
              </Popconfirm>
            ) : row.is_active ? (
              <Popconfirm
                key="deactivate"
                title="Деактивувати акаунт?"
                description={`Користувач ${row.full_name} більше не зможе увійти.`}
                okText="Деактивувати"
                cancelText="Скасувати"
                okButtonProps={{ danger: true }}
                disabled={!isEditable || isSelf}
                onConfirm={() => handleToggleActive(row, false)}
              >
                <Button
                  key="deactivate-btn"
                  type="link"
                  size="small"
                  danger
                  icon={<StopOutlined />}
                  disabled={!isEditable || isSelf}
                >
                  Деактивувати
                </Button>
              </Popconfirm>
            ) : (
              <Popconfirm
                key="activate"
                title="Активувати акаунт?"
                description={`Активувати доступ для ${row.full_name}.`}
                okText="Активувати"
                cancelText="Скасувати"
                disabled={!isEditable}
                onConfirm={() => handleToggleActive(row, true)}
              >
                <Button
                  key="activate-btn"
                  type="link"
                  size="small"
                  style={{ color: token.colorSuccess }}
                  icon={<CheckCircleOutlined />}
                  disabled={!isEditable}
                >
                  Активувати
                </Button>
              </Popconfirm>
            ),
          ];
        },
      },
    ],
    [filterStoreOptions, token, handleUnlock, handleToggleActive, currentUserRole, currentUserId, editForm, directionsByAdmin],
  );

  const sellerFilterStoreOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const u of sellers) {
      if (u.store_id != null && u.store_name && !seen.has(u.store_id)) {
        seen.set(u.store_id, u.store_name);
      }
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ text: name, value: id }))
      .sort((a, b) => a.text.localeCompare(b.text, "uk"));
  }, [sellers]);

  const sellerColumns: ProColumns<AdminUser>[] = useMemo(
    () => [
      {
        title: "Співробітник",
        dataIndex: "full_name",
        width: 260,
        ellipsis: true,
        sorter: (a, b) => (a.display_label ?? a.full_name).localeCompare(b.display_label ?? b.full_name, "uk"),
        filterSearch: true,
        onFilter: (value, row) => {
          const q = String(value).toLowerCase();
          return (
            row.full_name.toLowerCase().includes(q) ||
            (row.display_label ?? "").toLowerCase().includes(q) ||
            (row.store_name ?? "").toLowerCase().includes(q)
          );
        },
        render: (_, row) => (
          <div style={{ lineHeight: 1.4 }}>
            <Text strong style={{ color: row.is_active ? undefined : token.colorTextDisabled }}>
              {row.display_label ?? row.full_name}
            </Text>
            {row.display_label && row.display_label !== row.full_name && (
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {row.full_name}
                </Text>
              </div>
            )}
          </div>
        ),
      },
      {
        title: "Магазин",
        dataIndex: "store_id",
        width: 180,
        ellipsis: true,
        filters: sellerFilterStoreOptions.length > 0 ? sellerFilterStoreOptions : undefined,
        onFilter: (value, row) => row.store_id === value,
        render: (_, row) =>
          row.store_name ?? <Text type="secondary">—</Text>,
      },
      {
        title: "Стан",
        key: "state",
        width: 110,
        filters: (Object.keys(STATE_META) as RowState[]).map((k) => ({
          text: STATE_META[k].text,
          value: k,
        })),
        onFilter: (value, row) => rowState(row) === value,
        render: (_, row) => {
          const state = rowState(row);
          const color =
            state === "active" ? "green"
            : state === "locked" ? "red"
            : state === "no_pin" ? "orange"
            : "default";
          return <Tag color={color} bordered={false}>{STATE_META[state].text}</Tag>;
        },
      },
      {
        title: "Останній вхід",
        dataIndex: "last_login",
        width: 170,
        sorter: (a, b) => {
          const ta = a.last_login ? new Date(a.last_login).getTime() : 0;
          const tb = b.last_login ? new Date(b.last_login).getTime() : 0;
          return ta - tb;
        },
        render: (_, row) =>
          row.last_login ? (
            <Space direction="vertical" size={2} style={{ lineHeight: 1.2 }}>
              <Text style={{ fontSize: 12 }}>
                {new Date(row.last_login).toLocaleString("uk-UA")}
              </Text>
              <UserLastLocation row={row} />
            </Space>
          ) : (
            <Text type="secondary">жодного</Text>
          ),
      },
      {
        title: "Відгуки",
        key: "feedback_cats",
        width: 300,
        render: (_, row) => {
          const stats = sellerStats.get(row.id);
          if (!stats || stats.total === 0) {
            return <Text type="secondary">—</Text>;
          }
          const entries = Object.entries(stats.categories).sort(([, a], [, b]) => b - a);
          const MAX_TAGS = 4;
          const visible = entries.slice(0, MAX_TAGS);
          const overflow = entries.length - MAX_TAGS;

          return (
            <Space size={4} wrap>
              {visible.map(([catId, count]) => {
                const meta = categoryLookup.get(catId) ?? { emoji: "📝", title: catId };
                return (
                  <Tooltip key={catId} title={`${meta.title}: ${count}`}>
                    <Tag bordered={false} style={{ fontSize: 11, margin: 0, paddingInline: 6 }}>
                      {meta.emoji} {count}
                    </Tag>
                  </Tooltip>
                );
              })}
              {overflow > 0 && (
                <Tooltip
                  title={entries
                    .slice(MAX_TAGS)
                    .map(([catId, count]) => {
                      const meta = categoryLookup.get(catId) ?? { emoji: "📝", title: catId };
                      return `${meta.emoji} ${meta.title}: ${count}`;
                    })
                    .join("\n")}
                  overlayStyle={{ whiteSpace: "pre-line" }}
                >
                  <Tag bordered={false} style={{ fontSize: 11, margin: 0, paddingInline: 6 }}>+{overflow}</Tag>
                </Tooltip>
              )}
            </Space>
          );
        },
      },
      {
        title: "Всього",
        key: "total_feedbacks",
        width: 100,
        align: "right",
        sorter: (a, b) => (sellerStats.get(a.id)?.total ?? 0) - (sellerStats.get(b.id)?.total ?? 0),
        defaultSortOrder: "descend",
        render: (_, row) => {
          const total = sellerStats.get(row.id)?.total ?? 0;
          return (
            <Text strong style={{ fontSize: 16, color: total > 0 ? token.colorPrimary : token.colorTextDisabled }}>
              {total}
            </Text>
          );
        },
      },
      {
        title: "Дії",
        key: "seller_actions",
        valueType: "option",
        width: 160,
        render: (_, row) => {
          const isEditable =
            currentUserRole === "super_admin" ||
            (currentUserRole === "admin" && row.role === "seller");
          return [
            <Tooltip key="activity" title="Відгуки">
              <Button
                type="link"
                size="small"
                icon={<HistoryOutlined />}
                onClick={() => setActivityTarget(row)}
              />
            </Tooltip>,
            <Tooltip key="edit" title="Редагувати">
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                disabled={!isEditable}
                onClick={() => {
                  setEditTarget(row);
                  editForm.setFieldsValue({
                    full_name: row.full_name,
                    display_label: row.display_label,
                    role: row.role,
                    store_id: row.store_id,
                    is_active: row.is_active,
                  });
                }}
              />
            </Tooltip>,
            <Tooltip key="pin" title={row.has_pin ? "Змінити PIN" : "Створити PIN"}>
              <Button
                type="link"
                size="small"
                icon={row.has_pin ? <ReloadOutlined /> : <KeyOutlined />}
                disabled={!isEditable}
                onClick={() => setResetTarget(row)}
              />
            </Tooltip>,
          ];
        },
      },
    ],
    [sellerFilterStoreOptions, sellerStats, categoryLookup, token, currentUserRole, editForm],
  );

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Segmented<"sellers" | "admin">
          value={activeTab}
          onChange={setActiveTab}
          size="large"
          options={[
            { label: "Співробітники", value: "sellers" },
            { label: "Керування доступом", value: "admin" },
          ]}
        />
      </div>

      {activeTab === "sellers" ? (
        <ProTable<AdminUser>
          className="admin-sellers-table"
          rowKey="id"
          dataSource={sellers}
          columns={sellerColumns}
          search={false}
          size="small"
          tableLayout="fixed"
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
          scroll={{ x: 1110 }}
          headerTitle={
            <Space size={8}>
              <Text strong>Співробітники</Text>
              <Tag color="blue" bordered={false}>
                {sellers.length}
              </Tag>
            </Space>
          }
        />
      ) : (
        <ProTable<AdminUser>
          className="admin-users-table"
          rowKey="id"
          dataSource={list}
          columns={columns}
          search={false}
          size="small"
          tableLayout="fixed"
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
          scroll={{ x: 1584 }}
          toolBarRender={() => [
            <Button
              key="create"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateOpen(true)}
            >
              Створити користувача
            </Button>,
          ]}
          headerTitle={
            <Space size={8}>
              <Text strong>Усі користувачі</Text>
              <Tag color="magenta" bordered={false}>
                {list.length}
              </Tag>
            </Space>
          }
        />
      )}

      <CreateUserModal
        open={createOpen}
        form={createForm}
        storeOptions={storeOptions}
        currentUserRole={currentUserRole}
        onOpenChange={setCreateOpen}
        onFinish={handleCreateUser}
      />

      <EditUserModal
        target={editTarget}
        form={editForm}
        storeOptions={storeOptions}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        onClose={() => setEditTarget(null)}
        onFinish={handleEditUser}
      />

      <ResetPinModal
        target={resetTarget}
        onClose={() => setResetTarget(null)}
        onFinish={handleResetPin}
      />

      <ActivityDrawer
        target={activityTarget}
        logs={activityLogs}
        loading={loadingActivity}
        onClose={() => setActivityTarget(null)}
      />

      <DirectionsDrawer
        target={directionsTarget}
        stores={stores}
        currentUserRole={currentUserRole}
        onClose={() => setDirectionsTarget(null)}
        onChanged={() => router.refresh()}
      />
    </>
  );
}

function UserLastLocation({ row }: { row: AdminUser }) {
  const lines = formatGeoLines({
    country: row.last_login_country,
    city: row.last_login_city,
    asn: row.last_login_asn,
    isp: row.last_login_isp,
  });
  if (lines.empty) return null;
  const flag = countryFlag(row.last_login_country);
  return (
    <Tooltip title={lines.ispAsn || undefined}>
      <Space size={4} style={{ fontSize: 11 }}>
        {flag ? <span>{flag}</span> : null}
        <Text type="secondary" style={{ fontSize: 11 }}>
          {lines.cityCountry || lines.ispAsn}
        </Text>
      </Space>
    </Tooltip>
  );
}
