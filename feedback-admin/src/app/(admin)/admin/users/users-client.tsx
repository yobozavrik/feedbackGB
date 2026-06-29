"use client";

import {
  KeyOutlined,
  ReloadOutlined,
  UnlockOutlined,
  EditOutlined,
  PlusOutlined,
  StopOutlined,
  CheckCircleOutlined,
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
} from "antd";
import { useCallback, useMemo, useState } from "react";
import { countryFlag, formatGeoLines } from "@/lib/geoip";
import type { AdminUser } from "./page";

const { Text } = Typography;

interface Props {
  users: AdminUser[];
  stores: Array<{ id: number; name: string }>;
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

export function UsersClient({ users, stores, currentUserId, currentUserRole }: Props) {
  const [list, setList] = useState<AdminUser[]>(users);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();

  const { token } = antdTheme.useToken();
  const { message } = App.useApp();

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
        width: 240,
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
        width: 240,
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
        width: 200,
        ellipsis: true,
        filters: filterStoreOptions.length > 0 ? filterStoreOptions : undefined,
        onFilter: (value, row) => row.store_name === value,
        render: (_, row) =>
          row.store_name ?? <Text type="secondary">—</Text>,
      },
      {
        title: "Стан",
        key: "state",
        width: 140,
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
        width: 100,
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
        width: 200,
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
        title: "Дії",
        key: "actions",
        valueType: "option",
        fixed: "right",
        width: 280,
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
              size="small"
              type="primary"
              disabled={!isEditable}
              icon={row.has_pin ? <ReloadOutlined /> : <KeyOutlined />}
              onClick={() => setResetTarget(row)}
            >
              {row.has_pin ? "PIN" : "+PIN"}
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
                <Button size="small" icon={<UnlockOutlined />} disabled={!isEditable}>
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
                  size="small"
                  style={{ color: token.colorSuccess, borderColor: token.colorSuccess }}
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
    [storeOptions, filterStoreOptions, token, handleUnlock, handleToggleActive, currentUserRole, currentUserId, editForm],
  );

  return (
    <>
      <ProTable<AdminUser>
        rowKey="id"
        dataSource={list}
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
        scroll={{ x: 1540 }}
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
          Новий код 6–8 цифр. Скажи цей код користувачці особисто — він не
          зберігається в логах.
        </Text>
        <ProFormText.Password
          name="pin"
          label="Новий PIN"
          placeholder="6–8 цифр"
          fieldProps={{
            inputMode: "numeric",
            autoComplete: "off",
            maxLength: 8,
            visibilityToggle: true,
          }}
          rules={[
            { required: true, message: "Введи новий PIN" },
            {
              pattern: /^\d{6,8}$/,
              message: "PIN має бути 6–8 цифр",
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
            maxLength: 8,
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
