"use client";

import { ModalForm, ProFormText } from "@ant-design/pro-components";
import { Alert } from "antd";

const PIN_RE = /^\d{6}$/;

export interface PinModalValues {
  pin: string;
  confirm: string;
}

interface Props {
  open: boolean;
  hasPin: boolean;
  onOpenChange: (open: boolean) => void;
  onFinish: (values: PinModalValues) => Promise<boolean>;
}

export function PinModal({ open, hasPin, onOpenChange, onFinish }: Props) {
  return (
    <ModalForm<PinModalValues>
      title={hasPin ? "Змінити PIN" : "Встановити PIN"}
      open={open}
      onOpenChange={onOpenChange}
      modalProps={{
        destroyOnClose: true,
        okText: "Зберегти",
        cancelText: "Скасувати",
      }}
      onFinish={onFinish}
      layout="vertical"
      width={420}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="PIN — 6 цифр. Він автоматично хешується bcrypt-ом і ніколи не зберігається у відкритому вигляді."
      />
      <ProFormText.Password
        name="pin"
        label="Новий PIN"
        placeholder="6 цифр"
        fieldProps={{ inputMode: "numeric", maxLength: 6 }}
        rules={[
          { required: true, message: "Введіть PIN" },
          {
            pattern: PIN_RE,
            message: "PIN має бути 6 цифр",
          },
        ]}
      />
      <ProFormText.Password
        name="confirm"
        label="Підтвердити PIN"
        placeholder="Повторіть"
        fieldProps={{ inputMode: "numeric", maxLength: 6 }}
        rules={[
          { required: true, message: "Підтвердіть PIN" },
          {
            pattern: PIN_RE,
            message: "PIN має бути 6 цифр",
          },
        ]}
      />
    </ModalForm>
  );
}
