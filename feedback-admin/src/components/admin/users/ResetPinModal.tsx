"use client";

import { ModalForm, ProFormText } from "@ant-design/pro-components";
import { Typography } from "antd";
import type { AdminUser } from "@/app/(admin)/admin/users/page";

const { Text } = Typography;

export interface ResetPinValues {
  pin: string;
  confirmPin: string;
}

interface Props {
  target: AdminUser | null;
  onClose: () => void;
  onFinish: (values: ResetPinValues) => Promise<boolean>;
}

export function ResetPinModal({ target, onClose, onFinish }: Props) {
  return (
    <ModalForm<ResetPinValues>
      open={target != null}
      title={
        target?.has_pin
          ? `Перевидати PIN — ${target?.full_name}`
          : `Встановити PIN — ${target?.full_name}`
      }
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
  );
}
