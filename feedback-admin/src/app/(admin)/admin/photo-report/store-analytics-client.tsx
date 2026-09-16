"use client";

import { useEffect, useMemo, useState } from "react";
import { Column, Heatmap } from "@ant-design/plots";
import { Alert, Button, Card, Empty, Image, Modal, Select, Spin, Statistic, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  buildStorePhotoReportDays,
  buildPhotoReportHeatmap,
  buildDailySubmissionCounts,
  recentCalendarDates,
  type DailyPhotoReportSnapshot,
  type StorePhotoReportDay,
} from "@/lib/photoReportAnalytics";
import { kyivDay, type DailyPhotoReportRow, type PhotoReportStore } from "@/lib/photoReport";

const DAYS_TO_SHOW = 7;

interface GalleryReport {
  id: string;
  created_at: string;
  seller: string;
  photos: string[];
}

function todayKyiv(): string {
  return kyivDay(new Date().toISOString());
}

export function StoreAnalyticsClient({ stores }: { stores: PhotoReportStore[] }) {
  const [storeId, setStoreId] = useState<number | undefined>(stores[0]?.id);
  const [snapshots, setSnapshots] = useState<DailyPhotoReportSnapshot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [galleryDay, setGalleryDay] = useState<StorePhotoReportDay | null>(null);
  const [galleryReports, setGalleryReports] = useState<GalleryReport[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const dates = useMemo(() => recentCalendarDates(todayKyiv(), DAYS_TO_SHOW), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSnapshots(null);

    void Promise.all(dates.map(async (date): Promise<DailyPhotoReportSnapshot> => {
      const response = await fetch(`/api/admin/photo-report?date=${date}`, { signal: controller.signal });
      const data = await response.json() as { rows?: DailyPhotoReportRow[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? `Не вдалося завантажити ${date}`);
      return { date, rows: data.rows ?? [] };
    }))
      .then(setSnapshots)
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error ? requestError.message : "Не вдалося завантажити дані за період");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [dates]);

  const days = useMemo(
    () => snapshots && storeId != null ? buildStorePhotoReportDays(snapshots, storeId) : [],
    [snapshots, storeId],
  );
  const heatmap = useMemo(
    () => snapshots ? buildPhotoReportHeatmap(stores, snapshots) : [],
    [snapshots, stores],
  );
  const dailySubmissionCounts = useMemo(
    () => snapshots ? buildDailySubmissionCounts(snapshots) : [],
    [snapshots],
  );
  const reports = days.reduce((total, day) => total + day.reports, 0);
  const photos = days.reduce((total, day) => total + day.photos, 0);
  const submittedDays = days.filter((day) => day.submitted).length;
  const selectedStore = stores.find((store) => store.id === storeId);
  const openGallery = async (day: StorePhotoReportDay) => {
    if (storeId == null) return;
    setGalleryDay(day);
    setGalleryReports([]);
    setGalleryError(null);
    setGalleryLoading(true);
    try {
      const response = await fetch(`/api/admin/photo-report/gallery?store_id=${storeId}&date=${day.date}`);
      const data = await response.json() as { reports?: GalleryReport[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Не вдалося завантажити фото");
      setGalleryReports(data.reports ?? []);
    } catch (requestError: unknown) {
      setGalleryError(requestError instanceof Error ? requestError.message : "Не вдалося завантажити фото");
    } finally {
      setGalleryLoading(false);
    }
  };
  const columns: ColumnsType<StorePhotoReportDay> = [
    { title: "Дата (Київ)", dataIndex: "date", key: "date" },
    { title: "Статус", dataIndex: "submitted", key: "submitted", render: (submitted: boolean) => submitted ? "Надіслав" : "Не надіслав" },
    { title: "Звітів", dataIndex: "reports", key: "reports", align: "right" },
    { title: "Фото", dataIndex: "photos", key: "photos", align: "right" },
    {
      title: "Галерея",
      key: "gallery",
      render: (_, day) => day.submitted ? <Button type="link" onClick={() => void openGallery(day)}>Відкрити фото</Button> : "—",
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1 text-sm text-gray-500">Магазин</div>
            <Select
              className="min-w-64"
              value={storeId}
              onChange={setStoreId}
              options={stores.map((store) => ({ value: store.id, label: store.name }))}
              disabled={!stores.length}
            />
          </div>
          <div className="flex flex-wrap gap-6">
            <Statistic title="Днів зі звітом" value={`${submittedDays}/${DAYS_TO_SHOW}`} />
            <Statistic title="Звітів" value={reports} />
            <Statistic title="Фото" value={photos} />
            <Statistic title="Фото / звіт" value={reports ? (photos / reports).toFixed(1) : "—"} />
          </div>
        </div>
        <Alert
          type="info"
          showIcon
          message="Фактичні дані за останні 7 календарних днів"
          description="Джерело — чинний щоденний API «Фото звіт». Відсутній звіт у вже завантажений день показано як «Не надіслав»; при помилці завантаження період не підміняється нулями."
        />
      </Card>

      {error ? <Alert type="error" showIcon message="Аналітика за період недоступна" description={error} /> : null}
      {loading ? <Card><div className="py-12 text-center"><Spin /></div></Card> : null}
      {!loading && !error && !stores.length ? <Card><Empty description="Немає активних магазинів" /></Card> : null}
      {!loading && !error && storeId != null ? (
        <>
          <Card title="Магазинів, що надіслали звіт за днями">
            <Column
              data={dailySubmissionCounts}
              xField="date"
              yField="submittedStores"
              colorField="level"
              scale={{
                color: {
                  domain: ["red", "yellow", "green"],
                  range: ["#ff4d4f", "#faad14", "#52c41a"],
                },
              }}
              legend={false}
              height={260}
              tooltip={{
                title: "date",
                formatter: (datum: { submittedStores: number }) => ({
                  name: "Магазинів надіслали звіт",
                  value: String(datum.submittedStores),
                }),
              }}
              axis={{ y: { title: "Магазинів" } }}
            />
          </Card>
          <Card title="Деталізація за днями">
            <Table rowKey="date" columns={columns} dataSource={days} pagination={false} size="middle" />
          </Card>
          <Card title="Теплова карта надсилань усіх магазинів">
            <Heatmap
              data={heatmap}
              mark="cell"
              xField="date"
              yField="store"
              colorField="level"
              scale={{
                color: {
                  domain: ["none", "one", "two_or_more"],
                  range: ["#ff4d4f", "#faad14", "#52c41a"],
                },
              }}
              style={{ inset: 1 }}
              height={Math.min(Math.max(stores.length * 24, 280), 720)}
              tooltip={{
                title: "store",
                items: [
                  { field: "date", name: "Дата" },
                  { field: "reports", name: "Звітів" },
                  { field: "photos", name: "Фото" },
                  { field: "sellers_label", name: "Надіслали звіт" },
                ],
              }}
              meta={{ date: { type: "cat" }, store: { type: "cat" } }}
            />
          </Card>
        </>
      ) : null}
      <Modal
        open={galleryDay !== null}
        title={galleryDay && selectedStore ? `${selectedStore.name} — фото за ${galleryDay.date}` : "Фото звіт"}
        onCancel={() => setGalleryDay(null)}
        footer={null}
        width={980}
        destroyOnClose
      >
        {galleryDay ? <div className="mb-3 flex justify-end"><Button onClick={() => void openGallery(galleryDay)} loading={galleryLoading}>Оновити посилання на фото</Button></div> : null}
        {galleryLoading ? <div className="py-12 text-center"><Spin /></div> : null}
        {galleryError ? <Alert type="error" showIcon message="Не вдалося відкрити фото" description={galleryError} /> : null}
        {!galleryLoading && !galleryError && !galleryReports.length ? <Empty description="У звітах немає доступних фото" /> : null}
        {!galleryLoading && !galleryError ? (
          <Image.PreviewGroup>
            <div className="space-y-5">
              {galleryReports.map((report, reportIndex) => (
                <section key={report.id} className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
                    <strong className="text-gray-800">Звіт {galleryReports.length - reportIndex}</strong>
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
