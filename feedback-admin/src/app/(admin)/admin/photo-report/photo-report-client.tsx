"use client";

import { useMemo, useState } from "react";
import { Alert, Card, DatePicker, Empty, Statistic, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import {
  buildDailyPhotoReport,
  kyivDay,
  type DailyPhotoReportRow,
  type PhotoReportEntry,
  type PhotoReportStore,
} from "@/lib/photoReport";

function todayKyiv(): string {
  return kyivDay(new Date().toISOString());
}

export function PhotoReportClient({
  stores,
  entries,
  error,
}: {
  stores: PhotoReportStore[];
  entries: PhotoReportEntry[];
  error: string | null;
}) {
  const [selectedDate, setSelectedDate] = useState(todayKyiv());
  const rows = useMemo(
    () => buildDailyPhotoReport(stores, entries, selectedDate),
    [entries, selectedDate, stores],
  );

  const sentStores = rows.filter((row) => row.submitted).length;
  const totalPhotos = rows.reduce((sum, row) => sum + row.photos, 0);
  const columns: ColumnsType<DailyPhotoReportRow> = [
    { title: "Магазин", dataIndex: "store", key: "store", sorter: (a, b) => a.store.localeCompare(b.store, "uk") },
    {
      title: "Статус",
      dataIndex: "submitted",
      key: "submitted",
      render: (submitted: boolean) => submitted ? <Tag color="success">Надіслав</Tag> : <Tag color="error">Не надіслав</Tag>,
      filters: [{ text: "Надіслав", value: true }, { text: "Не надіслав", value: false }],
      onFilter: (value, row) => row.submitted === Boolean(value),
    },
    { title: "Фото", dataIndex: "photos", key: "photos", align: "right", sorter: (a, b) => a.photos - b.photos },
    { title: "Звітів", dataIndex: "reports", key: "reports", align: "right", sorter: (a, b) => a.reports - b.reports },
    { title: "Надіслав", dataIndex: "sellers", key: "sellers", render: (sellers: string[]) => sellers.length ? sellers.join(", ") : "—" },
    {
      title: "Остання відправка",
      dataIndex: "lastSubmittedAt",
      key: "lastSubmittedAt",
      render: (value: string | null) => value ? new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—",
    },
  ];

  return (
    <div className="space-y-4">
      {error ? <Alert type="error" showIcon message="Не вдалося завантажити дані" description={error} /> : null}
      <Card>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1 text-sm text-gray-500">Дата за київським часом</div>
            <DatePicker
              value={selectedDate ? dayjs(selectedDate) : null}
              onChange={(value: Dayjs | null) => setSelectedDate(value?.format("YYYY-MM-DD") ?? todayKyiv())}
              allowClear={false}
            />
          </div>
          <div className="flex gap-6">
            <Statistic title="Магазинів надіслали" value={`${sentStores}/${rows.length}`} />
            <Statistic title="Фото отримано" value={totalPhotos} />
          </div>
        </div>
        {rows.length ? <Table rowKey="key" columns={columns} dataSource={rows} pagination={{ pageSize: 25, showSizeChanger: true }} /> : <Empty description="Немає активних магазинів" />}
      </Card>
    </div>
  );
}
