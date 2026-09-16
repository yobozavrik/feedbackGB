"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, DatePicker, Empty, Image, Modal, Spin, Statistic, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import {
  buildDailyPhotoReport,
  kyivDay,
  type DailyPhotoReportRow,
  type PhotoReportStore,
} from "@/lib/photoReport";

function todayKyiv(): string {
  return kyivDay(new Date().toISOString());
}

interface GalleryReport {
  id: string;
  created_at: string;
  seller: string;
  photos: string[];
}

export function PhotoReportClient({
  stores,
  error,
}: {
  stores: PhotoReportStore[];
  error: string | null;
}) {
  const [selectedDate, setSelectedDate] = useState(todayKyiv());
  const [remoteRows, setRemoteRows] = useState<DailyPhotoReportRow[] | null>(null);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [galleryStore, setGalleryStore] = useState<DailyPhotoReportRow | null>(null);
  const [galleryReports, setGalleryReports] = useState<GalleryReport[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const initialRows = useMemo(() => buildDailyPhotoReport(stores, [], selectedDate), [selectedDate, stores]);
  const rows = remoteRows ?? initialRows;

  useEffect(() => {
    const controller = new AbortController();
    setDailyLoading(true);
    setDailyError(null);
    void fetch(`/api/admin/photo-report?date=${selectedDate}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { rows?: DailyPhotoReportRow[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Не вдалося завантажити звіт");
        setRemoteRows(data.rows ?? []);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setRemoteRows(null);
        setDailyError(requestError instanceof Error ? requestError.message : "Не вдалося завантажити звіт");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDailyLoading(false);
      });
    return () => controller.abort();
  }, [selectedDate]);

  const sentStores = rows.filter((row) => row.submitted).length;
  const totalPhotos = rows.reduce((sum, row) => sum + row.photos, 0);
  const openGallery = async (row: DailyPhotoReportRow) => {
    setGalleryStore(row);
    setGalleryReports([]);
    setGalleryError(null);
    setGalleryLoading(true);
    try {
      const response = await fetch(`/api/admin/photo-report/gallery?store_id=${row.key}&date=${selectedDate}`);
      const data = await response.json() as { reports?: GalleryReport[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Не вдалося завантажити фото");
      setGalleryReports(data.reports ?? []);
    } catch (galleryRequestError) {
      setGalleryError(galleryRequestError instanceof Error ? galleryRequestError.message : "Не вдалося завантажити фото");
    } finally {
      setGalleryLoading(false);
    }
  };
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
    {
      title: "Перегляд",
      key: "gallery",
      render: (_, row) => row.submitted ? <Button type="link" onClick={() => void openGallery(row)}>Відкрити фото</Button> : "—",
    },
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
      {error || dailyError ? <Alert type="error" showIcon message="Не вдалося завантажити дані" description={dailyError ?? error} /> : null}
      <Card>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1 text-sm text-ink-500">Дата за київським часом</div>
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
        {dailyLoading ? <div className="py-12 text-center"><Spin /></div> : rows.length ? <Table rowKey="key" columns={columns} dataSource={rows} pagination={{ pageSize: 25, showSizeChanger: true }} /> : <Empty description="Немає активних магазинів" />}
      </Card>
      <Modal
        open={galleryStore !== null}
        title={galleryStore ? `${galleryStore.store} — фото за ${selectedDate}` : "Фото звіт"}
        onCancel={() => setGalleryStore(null)}
        footer={null}
        width={980}
        destroyOnClose
      >
        {galleryStore ? <div className="mb-3 flex justify-end"><Button onClick={() => void openGallery(galleryStore)} loading={galleryLoading}>Оновити посилання на фото</Button></div> : null}
        {galleryLoading ? <div className="py-12 text-center"><Spin /></div> : null}
        {galleryError ? <Alert type="error" showIcon message="Не вдалося відкрити фото" description={galleryError} /> : null}
        {!galleryLoading && !galleryError && !galleryReports.length ? <Empty description="У звітах немає доступних фото" /> : null}
        {!galleryLoading && !galleryError ? (
          <Image.PreviewGroup>
            <div className="space-y-5">
              {galleryReports.map((report, reportIndex) => (
                <section key={report.id} className="rounded-lg border border-[rgb(var(--border-2))] p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-700">
                    <strong className="text-ink-900">Звіт {galleryReports.length - reportIndex}</strong>
                    <span>{report.seller} · {new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" }).format(new Date(report.created_at))} · {report.photos.length} фото</span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {report.photos.map((url, index) => (
                      <Image key={url} src={url} alt={`Фото звіту ${index + 1}`} width={148} height={111} style={{ objectFit: "cover" }} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </Image.PreviewGroup>
        ) : null}
      </Modal>
    </div>
  );
}
