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
  ShopOutlined,
  TeamOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import {
  ModalForm,
  ProFormText,
  ProFormSelect,
  ProFormSwitch,
  ProTable,
  type ProColumns,
} from "@ant-design/pro-components";
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
  Drawer,
  Timeline,
  Alert,
  Spin,
  Row,
  Col,
  Card,
  Avatar,
  Badge,
  Segmented,
  Select,
  Input,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { countryFlag, formatGeoLines } from "@/lib/geoip";
import type { AdminUser, FeedbacksStat } from "./page";

const { Text } = Typography;

interface Props {
  users: AdminUser[];
  stores: Array<{ id: number; name: string }>;
  feedbacks: FeedbacksStat[];
  currentUserId: string;
  currentUserRole: "admin" | "super_admin";
}

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

export function UsersClient({ users, stores, feedbacks, currentUserId, currentUserRole }: Props) {
  const [list, setList] = useState<AdminUser[]>(users);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();

  const [activityTarget, setActivityTarget] = useState<AdminUser | null>(null);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);

  // New tab state
  const [activeTab, setActiveTab] = useState<"cards" | "admin">("cards");

  // New filter states for cards view
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStore, setSelectedStore] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<"feedbacks" | "name">("feedbacks");

  const { token } = antdTheme.useToken();
  const { message } = App.useApp();

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

  const sellers = useMemo(() => {
    return list.filter((u) => u.role === "seller");
  }, [list]);

  const filteredSellers = useMemo(() => {
    let out = sellers;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      out = out.filter((u) => u.full_name.toLowerCase().includes(q));
    }
    if (selectedStore !== null) {
      out = out.filter((u) => u.store_id === selectedStore);
    }

    out = [...out].sort((a, b) => {
      if (sortBy === "feedbacks") {
        const aCount = sellerStats.get(a.id)?.total ?? 0;
        const bCount = sellerStats.get(b.id)?.total ?? 0;
        if (aCount !== bCount) {
          return bCount - aCount; // descending
        }
      }
      return a.full_name.localeCompare(b.full_name, "uk");
    });

    return out;
  }, [sellers, searchQuery, selectedStore, sortBy, sellerStats]);

  useEffect(() => {
    if (!activityTarget) {
      setActivityLogs([]);
      return;
    }
    const targetId = activityTarget.id;
    let active = true;
    async function fetchActivity() {
      setLoadingActivity(true);
      try {
        const res = await fetch(`/api/admin/users/${targetId}/activity`);
        if (!res.ok) throw new Error("API error");
        const data = await res.json();
        if (active) {
          setActivityLogs(data.logs || []);
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
  }, [activityTarget, message]);

  const updateUser = useCallback(
    (patch: Partial<AdminUser> & { id: string }) =>
      setList((prev) =>
        prev.map((u) => (u.id === patch.id ? { ...u, ...patch } : u)),
      ),
    [],
  );

  const handleUnlock = useCallback(
    async (u: AdminUser) => {
      const res = await fetch(`/api/admin/users/${u.id}/unlock`, {
        method: "POST",
      });
      if (!res.ok) {
        message.error("Не вдалося розблокувати. Спробуй ще раз.");
        return;
      }
      updateUser({ id: u.id, failed_attempts: 0, locked_until: null });
      message.success(`${u.full_name} розблокована.`);
    },
    [message, updateUser],
  );

  const handleResetPin = useCallback(
    async (values: { pin: string; confirmPin: string }) => {
      if (!resetTarget) return false;
      if (values.pin !== values.confirmPin) {
        message.error("Підтвердження не співпадає.");
        return false;
      }
      const res = await fetch(`/api/admin/users/${resetTarget.id}/pin`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin: values.pin }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        message.error(data.error ?? "Помилка сервера");
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
    async (values: any) => {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        message.error(data.error ?? "Помилка при створенні");
        return false;
      }

      const data = await res.json();
      setList((prev) => [...prev, data.user].sort((a, b) => a.full_name.localeCompare(b.full_name, "uk")));
      message.success(`Користувача ${values.full_name} успішно створено.`);
      setCreateOpen(false);
      createForm.resetFields();
      return true;
    },
    [createForm, message],
  );

  const handleEditUser = useCallback(
    async (values: any) => {
      if (!editTarget) return false;
      const res = await fetch(`/api/admin/users/${editTarget.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        message.error(data.error ?? "Помилка при збереженні");
        return false;
      }

      const data = await res.json();
      updateUser(data.user);
      message.success(`Зміни для ${data.user.full_name} збережено.`);
      setEditTarget(null);
      editForm.resetFields();
      return true;
    },
    [editTarget, editForm, message, updateUser],
  );

  const handleToggleActive = useCallback(
    async (u: AdminUser, makeActive: boolean) => {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_active: makeActive }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        message.error(data.error ?? "Помилка при зміні статусу");
        return;
      }

      const data = await res.json();
      updateUser(data.user);
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
        render: (_, row) => (
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
          </Space>
        ),
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
    [filterStoreOptions, token, handleUnlock, handleToggleActive, currentUserRole, currentUserId, editForm],
  );

  const CATEGORY_NAMES: Record<string, { label: string; emoji: string; color: string }> = {
    missing: { label: "Нехватка", emoji: "📦", color: "orange" },
    overstock: { label: "Надлишок", emoji: "📈", color: "blue" },
    defect: { label: "Брак", emoji: "⚠️", color: "red" },
    supply: { label: "Поставка", emoji: "🚛", color: "geekblue" },
    idea: { label: "Ідея", emoji: "💡", color: "purple" },
    spotted: { label: "Знайдено", emoji: "🔍", color: "cyan" },
    tech: { label: "Технічне", emoji: "⚙️", color: "gold" },
    voice: { label: "Голос", emoji: "🗣️", color: "magenta" },
  };

  const formatLastLogin = (iso: string | null): string => {
    if (!iso) return "ніколи";
    return new Date(iso).toLocaleString("uk-UA", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const cardsView = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Filters Toolbar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          background: token.colorBgContainer,
          padding: 16,
          borderRadius: token.borderRadiusLG,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Space size={12} wrap>
          <Input
            placeholder="Пошук за ПІБ..."
            prefix={<SearchOutlined style={{ color: token.colorTextDescription }} />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: 220 }}
            allowClear
          />
          <Select
            placeholder="Всі магазини"
            style={{ width: 220 }}
            value={selectedStore ?? undefined}
            onChange={setSelectedStore}
            allowClear
            options={stores.map((s) => ({ label: s.name, value: s.id }))}
          />
        </Space>
        
        <Space size={12}>
          <Text type="secondary" style={{ fontSize: 13 }}>Сортувати:</Text>
          <Segmented<"feedbacks" | "name">
            value={sortBy}
            onChange={setSortBy}
            options={[
              { label: "За активністю", value: "feedbacks" },
              { label: "За алфавітом", value: "name" },
            ]}
          />
        </Space>
      </div>

      {filteredSellers.length === 0 ? (
        <Alert
          message="Співробітників не знайдено"
          description="Спробуйте змінити параметри пошуку або фільтрації."
          type="info"
          showIcon
          style={{ borderRadius: token.borderRadiusLG }}
        />
      ) : (
        <Row gutter={[16, 16]}>
          {filteredSellers.map((seller) => {
            const stats = sellerStats.get(seller.id) || { total: 0, categories: {} };
            const isActive = seller.is_active;
            const hasPin = seller.has_pin;
            const isLocked = seller.locked_until && new Date(seller.locked_until) > new Date();
            
            // Get initials for avatar
            const initials = seller.full_name
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();

            // Status tag
            let statusTag = <Tag color="green">Активна</Tag>;
            if (!isActive) {
              statusTag = <Tag color="default">Неактивна</Tag>;
            } else if (isLocked) {
              statusTag = <Tag color="error">Заблокована</Tag>;
            } else if (!hasPin) {
              statusTag = <Tag color="warning">Без PIN</Tag>;
            }

            return (
              <Col xs={24} sm={12} md={8} lg={6} key={seller.id}>
                <Card
                  hoverable
                  style={{
                    borderRadius: token.borderRadiusLG,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    overflow: "hidden",
                  }}
                  bodyStyle={{ padding: 16 }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                    <Avatar
                      size={48}
                      style={{
                        background: isActive ? `linear-gradient(135deg, ${token.colorPrimary}, ${token.colorPrimaryActive})` : token.colorTextDisabled,
                        color: "#fff",
                        fontWeight: 600,
                        fontSize: 16,
                      }}
                    >
                      {initials}
                    </Avatar>
                    <div style={{ overflow: "hidden", flex: 1 }}>
                      <Text strong style={{ display: "block", fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {seller.full_name}
                      </Text>
                      <div style={{ marginTop: 2 }}>{statusTag}</div>
                    </div>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <Space size={4} style={{ color: token.colorTextDescription, fontSize: 13 }}>
                      <ShopOutlined />
                      <Text style={{ fontSize: 13 }}>
                        {seller.store_name || "Не прикріплено"}
                      </Text>
                    </Space>
                  </div>

                  {/* Feedback Count Stats */}
                  <div
                    style={{
                      background: token.colorFillAlter,
                      borderRadius: token.borderRadius,
                      padding: "8px 12px",
                      marginBottom: 12,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>Надіслано відгуків:</Text>
                      <Text strong style={{ fontSize: 18, color: token.colorPrimary }}>{stats.total}</Text>
                    </div>

                    {stats.total > 0 && (
                      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {Object.entries(stats.categories).map(([catId, count]) => {
                          const catMeta = CATEGORY_NAMES[catId] || { label: catId, emoji: "📝", color: "default" };
                          return (
                            <Tooltip key={catId} title={`${catMeta.label}: ${count}`}>
                              <Tag bordered={false} color={catMeta.color} style={{ fontSize: 11, margin: 0, paddingInline: 6 }}>
                                {catMeta.emoji} {count}
                              </Tag>
                            </Tooltip>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Last Login Info */}
                  <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>Останній вхід:</Text>
                    {seller.last_login ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                        <Text style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
                          {formatLastLogin(seller.last_login)}
                        </Text>
                        <UserLastLocation row={seller} />
                      </div>
                    ) : (
                      <Text type="secondary" style={{ fontSize: 11 }}>ніколи</Text>
                    )}
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
    </div>
  );

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Segmented<"cards" | "admin">
          value={activeTab}
          onChange={setActiveTab}
          size="large"
          options={[
            { label: "Картки співробітників", value: "cards" },
            { label: "Керування доступом", value: "admin" },
          ]}
        />
      </div>

      {activeTab === "cards" ? (
        cardsView
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
          scroll={{ x: 1454 }}
          toolBarRender={() => [
            <Button
              key="create"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                createForm.resetFields();
                setCreateOpen(true);
              }}
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

      {/* CREATE MODAL */}
      <ModalForm
        form={createForm}
        open={createOpen}
        title="Створити користувача"
        onOpenChange={setCreateOpen}
        modalProps={{
          destroyOnClose: true,
          okText: "Створити",
          cancelText: "Скасувати",
          maskClosable: false,
        }}
        onFinish={handleCreateUser}
        width={480}
      >
        <ProFormText
          name="full_name"
          label="Імʼя (ФІО)"
          placeholder="Наприклад: Ковальчук Роман"
          rules={[
            { required: true, message: "Введіть ФІО" },
            { min: 2, message: "Мінімум 2 символи" },
          ]}
        />
        <ProFormText
          name="display_label"
          label="Відображуване ім'я (для логіну/адмінки)"
          placeholder="Наприклад: Магазин 18 — БУЛЬВАР"
          rules={[
            { required: true, message: "Введіть відображуване ім'я" },
            { min: 2, message: "Мінімум 2 символи" },
          ]}
        />
        <ProFormSelect
          name="role"
          label="Роль"
          initialValue="seller"
          valueEnum={
            currentUserRole === "super_admin"
              ? {
                  seller: "Продавчиня",
                  admin: "Адмін",
                  super_admin: "Супер-адмін",
                }
              : {
                  seller: "Продавчиня",
                }
          }
          rules={[{ required: true, message: "Виберіть роль" }]}
        />
        <ProFormText.Password
          name="pin"
          label="PIN-код (6 цифр)"
          placeholder="Введіть 6-значний PIN-код"
          rules={[
            { required: true, message: "Введіть PIN-код" },
            { pattern: /^\d{6}$/, message: "PIN-код має складатися рівно з 6 цифр" },
          ]}
        />
        <Form.Item noStyle shouldUpdate={(prevValues, currentValues) => prevValues.role !== currentValues.role}>
          {({ getFieldValue }) => {
            const role = getFieldValue("role");
            if (role === "seller") {
              return (
                <ProFormSelect
                  name="store_id"
                  label="Магазин"
                  options={storeOptions}
                  placeholder="Виберіть магазин для продавчині"
                  rules={[{ required: true, message: "Виберіть магазин" }]}
                />
              );
            }
            return null;
          }}
        </Form.Item>
      </ModalForm>

      {/* EDIT MODAL */}
      <ModalForm
        form={editForm}
        open={editTarget != null}
        title={`Редагувати користувача: ${editTarget?.full_name}`}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        modalProps={{
          destroyOnClose: true,
          okText: "Зберегти",
          cancelText: "Скасувати",
          maskClosable: false,
        }}
        onFinish={handleEditUser}
        width={480}
      >
        <ProFormText
          name="full_name"
          label="Імʼя (ФІО)"
          placeholder="Введіть ФІО"
          rules={[
            { required: true, message: "Введіть ФІО" },
            { min: 2, message: "Мінімум 2 символи" },
          ]}
        />
        <ProFormText
          name="display_label"
          label="Відображуване ім'я (для логіну/адмінки)"
          placeholder="Введіть відображуване ім'я"
          rules={[
            { required: true, message: "Введіть відображуване ім'я" },
            { min: 2, message: "Мінімум 2 символи" },
          ]}
        />
        <ProFormSelect
          name="role"
          label="Роль"
          valueEnum={
            currentUserRole === "super_admin"
              ? {
                  seller: "Продавчиня",
                  admin: "Адмін",
                  super_admin: "Супер-адмін",
                }
              : {
                  seller: "Продавчиня",
                }
          }
          disabled={editTarget?.id === currentUserId} // Can't change own role
          rules={[{ required: true, message: "Виберіть роль" }]}
        />
        <Form.Item noStyle shouldUpdate={(prevValues, currentValues) => prevValues.role !== currentValues.role}>
          {({ getFieldValue }) => {
            const role = getFieldValue("role");
            if (role === "seller") {
              return (
                <ProFormSelect
                  name="store_id"
                  label="Магазин"
                  options={storeOptions}
                  placeholder="Виберіть магазин"
                  rules={[{ required: true, message: "Виберіть магазин" }]}
                />
              );
            }
            return null;
          }}
        </Form.Item>
        <ProFormSwitch
          name="is_active"
          label="Активний акаунт"
          disabled={editTarget?.id === currentUserId} // Can't deactivate self
        />
      </ModalForm>

      {/* RESET PIN MODAL */}
      <ModalForm
        open={resetTarget != null}
        title={
          resetTarget?.has_pin
            ? `Перевидати PIN — ${resetTarget?.full_name}`
            : `Встановити PIN — ${resetTarget?.full_name}`
        }
        onOpenChange={(open) => {
          if (!open) setResetTarget(null);
        }}
        modalProps={{
          destroyOnHidden: true,
          okText: "Зберегти",
          cancelText: "Скасувати",
          maskClosable: false,
        }}
        onFinish={handleResetPin}
        width={420}
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
          Новий код має складатися рівно з 6 цифр. Скажи цей код користувачці особисто — він не
          зберігається в логах.
        </Text>
        <ProFormText.Password
          name="pin"
          label="Новий PIN"
          placeholder="6 цифр"
          fieldProps={{
            inputMode: "numeric",
            autoComplete: "off",
            maxLength: 6,
            visibilityToggle: true,
          }}
          rules={[
            { required: true, message: "Введи новий PIN" },
            {
              pattern: /^\d{6}$/,
              message: "PIN має бути ровно 6 цифр",
            },
          ]}
        />
        <ProFormText.Password
          name="confirmPin"
          label="Повторити PIN"
          placeholder="Ще раз"
          fieldProps={{
            inputMode: "numeric",
            autoComplete: "off",
            maxLength: 6,
            visibilityToggle: true,
          }}
          dependencies={["pin"]}
          rules={[
            { required: true, message: "Повтори PIN" },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue("pin") === value) {
                  return Promise.resolve();
                }
                return Promise.reject(
                  new Error("Підтвердження не співпадає"),
                );
              },
            }),
          ]}
        />
      </ModalForm>
      <Drawer
        title={`Активність користувача: ${activityTarget?.full_name}`}
        placement="right"
        width={480}
        onClose={() => setActivityTarget(null)}
        open={activityTarget != null}
        destroyOnClose
      >
        {loadingActivity ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <Spin size="large" />
          </div>
        ) : activityLogs.length === 0 ? (
          <Alert
            message="Активність відсутня"
            description="За цим користувачем не зафіксовано жодних дій."
            type="info"
            showIcon
          />
        ) : (
          <Timeline mode="left">
            {activityLogs.map((log: any, idx: number) => {
              const dateStr = new Date(log.occurred_at).toLocaleString("uk-UA");
              const hasMeta = log.meta && Object.keys(log.meta).length > 0;
              const hasDiff = log.diff && Object.keys(log.diff).length > 0;

              return (
                <Timeline.Item key={idx} label={dateStr}>
                  <div style={{ fontWeight: "bold" }}>{log.action_title}</div>
                  {log.ip && (
                    <div style={{ fontSize: 11, color: "#8c8c8c" }}>
                      IP: {log.ip} {log.user_agent ? `| ${log.user_agent.slice(0, 40)}...` : ""}
                    </div>
                  )}
                  {hasMeta && (
                    <div style={{ marginTop: 4, background: "#f5f5f5", padding: "4px 8px", borderRadius: 4, fontSize: 11 }}>
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(log.meta, null, 2)}
                      </pre>
                    </div>
                  )}
                  {hasDiff && (
                    <div style={{ marginTop: 4, background: "#fffbe6", padding: "4px 8px", borderRadius: 4, fontSize: 11, border: "1px solid #ffe58f" }}>
                      <div style={{ fontWeight: "bold", color: "#d4b106", marginBottom: 2 }}>Зміни:</div>
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(log.diff, null, 2)}
                      </pre>
                    </div>
                  )}
                </Timeline.Item>
              );
            })}
          </Timeline>
        )}
      </Drawer>
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
