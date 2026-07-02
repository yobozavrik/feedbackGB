"use client";

import {
  Card,
  Select,
  Space,
  Statistic,
  theme as antdTheme,
} from "antd";
import { MetaText } from "@/components/admin/ui/typography";
import type { AnalyticsUserOpt } from "@/app/(admin)/admin/analytics/page";

interface Props {
  users: AnalyticsUserOpt[];
  selectedUser: string | undefined;
  selectedPage: string;
  total: number;
  onUserChange: (value: string | undefined) => void;
  onPageChange: (value: string) => void;
}

export function FiltersCard({
  users,
  selectedUser,
  selectedPage,
  total,
  onUserChange,
  onPageChange,
}: Props) {
  const { token } = antdTheme.useToken();

  return (
    <Card bordered={false} className="shadow-soft">
      <Space size={16} wrap style={{ width: "100%", justifyContent: "space-between" }}>
        <Space size={16} wrap>
          <div>
            <div style={{ marginBottom: 6 }}>
              <MetaText>Користувач для аналізу</MetaText>
            </div>
            <Select
              showSearch
              allowClear
              placeholder="Усі користувачі"
              style={{ width: 280 }}
              value={selectedUser}
              onChange={onUserChange}
              optionFilterProp="children"
              filterOption={(input, option) =>
                String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())
              }
              options={[
                { label: "Усі користувачі", value: "" },
                ...users.map((u) => ({
                  label: u.display_label ? `${u.display_label} (${u.full_name})` : u.full_name,
                  value: u.id,
                })),
              ]}
            />
          </div>

          <div>
            <div style={{ marginBottom: 6 }}>
              <MetaText>Екран Mini App</MetaText>
            </div>
            <Select
              style={{ width: 240 }}
              value={selectedPage}
              onChange={onPageChange}
              options={[
                { label: "Екран входу (PIN-код)", value: "/login" },
                { label: "Головна (Форма відгуку)", value: "/" },
              ]}
            />
          </div>
        </Space>

        <Statistic
          title="Кліків завантажено"
          value={total}
          valueStyle={{ color: token.colorPrimary, fontWeight: "bold" }}
        />
      </Space>
    </Card>
  );
}
