"use client";

import {
  ModalForm,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
} from "@ant-design/pro-components";
import { App, Form, type FormInstance } from "antd";
import { useEffect } from "react";
import type { AdminUser } from "@/app/(admin)/admin/users/page";
import { fetchReplacementStores, type EditUserValues } from "@/lib/adminUsersApi";

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
  const { message } = App.useApp();

  useEffect(() => {
    if (!target || target.role !== "seller") return;
    form.setFieldValue("replacement_store_ids", undefined);
    void fetchReplacementStores(target.id).then((result) => {
      if (!result.ok) {
        message.error(result.error ?? "Не вдалося завантажити магазини для заміни");
        return;
      }
      form.setFieldValue(
        "replacement_store_ids",
        result.permissions
          .filter((permission) => permission.revoked_at == null)
          .map((permission) => permission.store_id),
      );
    });
  }, [form, message, target]);

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
              <>
                <ProFormSelect
                  name="store_id"
                  label="Основний магазин"
                  options={storeOptions}
                  placeholder="Виберіть магазин"
                />
                <ProFormSelect
                  name="replacement_store_ids"
                  label="Магазини для заміни"
                  options={storeOptions}
                  placeholder="Оберіть магазини, де продавчиня може робити фото звіт"
                  fieldProps={{ mode: "multiple" }}
                  extra="Дає право на «Фото звіт» у цих магазинах, але не підтверджує зміну."
                />
              </>
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
