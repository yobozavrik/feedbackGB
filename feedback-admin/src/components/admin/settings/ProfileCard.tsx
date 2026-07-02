"use client";

import { KeyOutlined, ShopOutlined, UserOutlined } from "@ant-design/icons";
import { ProDescriptions } from "@ant-design/pro-components";
import {
  Button,
  Card,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme as antdTheme,
} from "antd";
import Link from "next/link";
import { CardFootnote } from "@/components/admin/ui/typography";
import { fmtAbs, fmtRel } from "@/lib/timeFormat";
import type { SettingsData } from "@/app/(admin)/admin/settings/page";

const { Text } = Typography;

interface Props {
  profile: SettingsData["profile"];
  hasPin: boolean;
  onChangePin: () => void;
}

export function ProfileCard({ profile, hasPin, onChangePin }: Props) {
  const { token } = antdTheme.useToken();

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <UserOutlined style={{ color: token.colorPrimary }} />
          <Text strong>Профіль</Text>
        </Space>
      }
    >
      <ProDescriptions<SettingsData["profile"]>
        column={1}
        size="small"
        colon
        dataSource={profile}
        columns={[
          {
            title: "Імʼя",
            dataIndex: "full_name",
            render: (_, row) => row.full_name,
          },
          {
            title: "Роль",
            dataIndex: "role",
            render: (_, row) => {
              const color =
                row.role === "super_admin"
                  ? "red"
                  : row.role === "admin"
                    ? "magenta"
                    : "default";
              const label =
                row.role === "super_admin"
                  ? "Супер-адмін"
                  : row.role === "admin"
                    ? "Адмін"
                    : "Продавчиня";
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
            render: (_, row) => {
              if (row.store_id == null)
                return <Text type="secondary">не привʼязано</Text>;
              return (
                <Space size={6}>
                  <ShopOutlined
                    style={{ color: token.colorTextTertiary }}
                  />
                  <Text>{row.store_name ?? `#${row.store_id}`}</Text>
                </Space>
              );
            },
          },
          {
            title: "PIN-код",
            dataIndex: "has_pin",
            render: () =>
              hasPin ? (
                <Tag color="green" bordered={false}>
                  встановлено
                </Tag>
              ) : (
                <Tag color="orange" bordered={false}>
                  не встановлено
                </Tag>
              ),
          },
          {
            title: "Останній вхід",
            dataIndex: "last_login",
            render: (_, row) =>
              row.last_login ? (
                <Tooltip title={fmtAbs(row.last_login)}>
                  <Text type="secondary">{fmtRel(row.last_login)}</Text>
                </Tooltip>
              ) : (
                <Text type="secondary">—</Text>
              ),
          },
        ]}
      />
      <div style={{ marginTop: 12 }}>
        <Button type="primary" icon={<KeyOutlined />} onClick={onChangePin}>
          {hasPin ? "Змінити PIN" : "Встановити PIN"}
        </Button>
      </div>
      <CardFootnote>
        PIN — 6 цифр. При зміні автоматично скидається лічильник
        невдалих спроб і знімається lock. Подія потрапляє в{" "}
        <Link href="/admin/audit">Журнал</Link>.
      </CardFootnote>
    </Card>
  );
}
