"use client";

import {
  KeyOutlined,
  ReloadOutlined,
  UnlockOutlined,
} from "@ant-design/icons";
import {
  ModalForm,
  ProFormText,
  ProTable,
  type ProColumns,
} from "@ant-design/pro-components";
import {
  App,
  Button,
  Popconfirm,
  Space,
  Tag,
  Typography,
  theme as antdTheme,
} from "antd";
import { useCallback, useMemo, useState } from "react";
import type { AdminUser } from "./page";

const { Text } = Typography;

interface Props {
  users: AdminUser[];
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

export function UsersClient({ users }: Props) {
  const [list, setList] = useState<AdminUser[]>(users);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
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

  const storeOptions = useMemo(() => {
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
        title: "Імʼя",
        dataIndex: "full_name",
        fixed: "left",
        ellipsis: true,
        sorter: (a, b) => a.full_name.localeCompare(b.full_name, "uk"),
        render: (_, row) => (
          <Space size={6} wrap>
            <Text strong>{row.full_name}</Text>
            {!row.has_pin ? (
              <Tag color="orange" bordered={false}>
                без PIN
              </Tag>
            ) : null}
          </Space>
        ),
      },
      {
        title: "Роль",
        dataIndex: "role",
        width: 130,
        valueEnum: {
          admin: { text: "Адмін" },
          seller: { text: "Продавчиня" },
        },
        filters: [
          { text: "Адмін", value: "admin" },
          { text: "Продавчиня", value: "seller" },
        ],
        onFilter: (value, row) => row.role === value,
        render: (_, row) => (
          <Tag
            color={row.role === "admin" ? "magenta" : "default"}
            bordered={false}
          >
            {row.role === "admin" ? "адмін" : "продавчиня"}
          </Tag>
        ),
      },
      {
        title: "Магазин",
        dataIndex: "store_name",
        ellipsis: true,
        filters: storeOptions.length > 0 ? storeOptions : undefined,
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
            new Date(row.last_login).toLocaleString("uk-UA")
          ) : (
            <Text type="secondary">жодного</Text>
          ),
      },
      {
        title: "Дії",
        key: "actions",
        valueType: "option",
        fixed: "right",
        width: 220,
        render: (_, row) => {
          const isLocked =
            row.locked_until != null &&
            new Date(row.locked_until) > new Date();
          return [
            <Button
              key="reset"
              size="small"
              type="primary"
              icon={row.has_pin ? <ReloadOutlined /> : <KeyOutlined />}
              onClick={() => setResetTarget(row)}
            >
              {row.has_pin ? "Перевидати PIN" : "Встановити PIN"}
            </Button>,
            isLocked ? (
              <Popconfirm
                key="unlock"
                title="Розблокувати акаунт?"
                description={`Скинути лічильник помилок для ${row.full_name}.`}
                okText="Так"
                cancelText="Скасувати"
                onConfirm={() => handleUnlock(row)}
              >
                <Button size="small" icon={<UnlockOutlined />}>
                  Розблокувати
                </Button>
              </Popconfirm>
            ) : null,
          ];
        },
      },
    ],
    [storeOptions, token, handleUnlock],
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
        scroll={{ x: 900 }}
        toolBarRender={() => [
          <Text key="hint" type="secondary" style={{ fontSize: 12 }}>
            Перевидати PIN — 6–8 цифр. Розблокування скидає лічильник
            невдалих спроб.
          </Text>,
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
