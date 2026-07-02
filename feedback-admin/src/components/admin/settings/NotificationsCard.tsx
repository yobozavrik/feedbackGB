"use client";

import { NotificationOutlined } from "@ant-design/icons";
import {
  Card,
  Space,
  Switch,
  Typography,
  theme as antdTheme,
} from "antd";

const { Text } = Typography;

interface Props {
  soundEnabled: boolean;
  pushEnabled: boolean;
  onToggleSound: (value: boolean) => void;
  onTogglePush: (value: boolean) => void;
}

export function NotificationsCard({
  soundEnabled,
  pushEnabled,
  onToggleSound,
  onTogglePush,
}: Props) {
  const { token } = antdTheme.useToken();

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <NotificationOutlined style={{ color: token.colorPrimary }} />
          <Text strong>Звукові та Push-сповіщення (Realtime)</Text>
        </Space>
      }
    >
      <Space direction="vertical" size={12} style={{ width: "100%", paddingBlock: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <Text strong style={{ fontSize: 13 }}>Звукові сигнали</Text>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Програвати звуковий сигнал при надходженні нового браку
              </Text>
            </div>
          </div>
          <Switch checked={soundEnabled} onChange={onToggleSound} />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <Text strong style={{ fontSize: 13 }}>Браузерні сповіщення</Text>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Показувати спливаючі повідомлення на робочому столі
              </Text>
            </div>
          </div>
          <Switch checked={pushEnabled} onChange={onTogglePush} />
        </div>
      </Space>
    </Card>
  );
}
