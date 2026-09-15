"use client";

import { useMemo, useState } from "react";
import { Alert, Card, DatePicker, Empty, Statistic, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";

export interface PhotoReportStore {
  id: number;
  name: string;
  is_active: boolean;
}

export interface PhotoReportEntry {
  created_at: string;
  store_id: number | null;
  store_name: string | null;
  user_full_name: string | null;
  photo_url: string | null;
  photo_urls: unknown;
}

interface DailyStoreRow {
  key: number;
  store: string;
  submitted: boolean;
  reports: number;
  photos: number;
  sellers: string[];
  lastSubmittedAt: string | null;
}

function kyivDate(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function todayKyiv(): string {
  return kyivDate(new Date().toISOString());
}

function photoCount(entry: PhotoReportEntry): number {
  if (Array.isArray(entry.photo_urls)) return entry.photo_urls.length;
  return entry.photo_url ? 1 : 0;
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
  const rows = useMemo<DailyStoreRow[]>(() => {
    const byStore = new Map<number, DailyStoreRow>();
    for (const store of stores) {
      byStore.set(store.id, {
        key: store.id,
        store: store.name,
        submitted: false,
        reports: 0,
        photos: 0,
        sellers: [],
        lastSubmittedAt: null,
      });
    }
    for (const entry of entries) {
      if (entry.store_id == null || kyivDate(entry.created_at) !== selectedDate) continue;
      const row = byStore.get(entry.store_id);
      if (!row) continue;
      row.submitted = true;
      row.reports += 1;
      row.photos += photoCount(entry);
      if (entry.user_full_name && !row.sellers.includes(entry.user_full_name)) {
        row.sellers.push(entry.user_full_name);
      }
      if (!row.lastSubmittedAt || entry.created_at > row.lastSubmittedAt) {
        row.lastSubmittedAt = entry.created_at;
      }
    }
    return Array.from(byStore.values()).sort((a, b) => Number(a.submitted) - Number(b.submitted) || a.store.localeCompare(b.store, "uk"));
  }, [entries, selectedDate, stores]);

  const sentStores = rows.filter((row) => row.submitted).length;
  const totalPhotos = rows.reduce((sum, row) => sum + row.photos, 0);
  const columns: ColumnsType<DailyStoreRow> = [
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
