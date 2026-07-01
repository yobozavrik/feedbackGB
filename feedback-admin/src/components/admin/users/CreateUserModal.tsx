"use client";

import {
  ModalForm,
  ProFormSelect,
  ProFormText,
} from "@ant-design/pro-components";
import { Form, type FormInstance } from "antd";
import type { CreateUserValues } from "@/lib/adminUsersApi";

interface Props {
  open: boolean;
  form: FormInstance;
  storeOptions: Array<{ label: string; value: number }>;
  currentUserRole: "admin" | "super_admin";
  onOpenChange: (open: boolean) => void;
  onFinish: (values: CreateUserValues) => Promise<boolean>;
}

export function CreateUserModal({
  open,
  form,
  storeOptions,
  currentUserRole,
  onOpenChange,
  onFinish,
}: Props) {
  return (
    <ModalForm<CreateUserValues>
      form={form}
      open={open}
      title="Створити користувача"
      onOpenChange={onOpenChange}
      modalProps={{
        destroyOnHidden: true,
        okText: "Створити",
        cancelText: "Скасувати",
        maskClosable: false,
      }}
      onFinish={onFinish}
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
  );
}
