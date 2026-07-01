"use client";

import {
  ModalForm,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
} from "@ant-design/pro-components";
import { Form, type FormInstance } from "antd";
import type { AdminUser } from "@/app/(admin)/admin/users/page";
import type { EditUserValues } from "@/lib/adminUsersApi";

interface Props {
  target: AdminUser | null;
  form: FormInstance;
  storeOptions: Array<{ label: string; value: number }>;
  currentUserId: string;
  currentUserRole: "admin" | "super_admin";
  onClose: () => void;
  onFinish: (values: EditUserValues) => Promise<boolean>;
}

export function EditUserModal({
  target,
  form,
  storeOptions,
  currentUserId,
  currentUserRole,
  onClose,
  onFinish,
}: Props) {
  return (
    <ModalForm<EditUserValues>
      form={form}
      open={target != null}
      title={`Редагувати користувача: ${target?.full_name}`}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      modalProps={{
        destroyOnHidden: true,
        okText: "Зберегти",
        cancelText: "Скасувати",
        maskClosable: false,
      }}
      onFinish={onFinish}
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
        disabled={target?.id === currentUserId} // Can't change own role
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
        disabled={target?.id === currentUserId} // Can't deactivate self
      />
    </ModalForm>
  );
}
