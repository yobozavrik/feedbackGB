"use client";

import { useEffect, useMemo, useState } from "react";
import { Column, Heatmap } from "@ant-design/plots";
import { Alert, Button, Card, DatePicker, Empty, Image, Modal, Segmented, Select, Spin, Statistic, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import {
  buildDailySubmissionCounts,
  buildPhotoReportHeatmap,
  buildStorePhotoReportPeriodSummaries,
  calendarDatesBetween,
  recentCalendarDates,
  type DailyPhotoReportSnapshot,
  type StorePhotoReportPeriodSummary,
} from "@/lib/photoReportAnalytics";
import { kyivDay, type DailyPhotoReportRow, type PhotoReportStore } from "@/lib/photoReport";
import { useAdminChartTheme } from "@/lib/admin/useAdminChartTheme";

const DEFAULT_PERIOD_DAYS = 7;
const MAX_PERIOD_DAYS = 31;
const PERIOD_PRESET_DAYS = [7, 14, 30] as const;

interface GalleryReport { id: string; created_at: string; seller: string; photos: string[]; }
interface GalleryTarget { storeId: number; storeName: string; date: string; }

function todayKyiv(): string { return kyivDay(new Date().toISOString()); }
function defaultRange(days = DEFAULT_PERIOD_DAYS): [string, string] {
  const dates = recentCalendarDates(todayKyiv(), days);
  return [dates[0]!, dates.at(-1)!];
}

export function StoreAnalyticsClient({ stores }: { stores: PhotoReportStore[] }) {
  const chartTheme = useAdminChartTheme();
  const [storeId, setStoreId] = useState<number | "all">("all");
  const [range, setRange] = useState<[string, string]>(() => defaultRange());
  const [presetDays, setPresetDays] = useState<number | undefined>(DEFAULT_PERIOD_DAYS);
  const [snapshots, setSnapshots] = useState<DailyPhotoReportSnapshot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [galleryTarget, setGalleryTarget] = useState<GalleryTarget | null>(null);
  const [galleryReports, setGalleryReports] = useState<GalleryReport[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const dates = useMemo(() => calendarDatesBetween(range[0], range[1]), [range]);
  const rangeIsTooLong = dates.length > MAX_PERIOD_DAYS;

  useEffect(() => {
    if (!dates.length || rangeIsTooLong) {
      setSnapshots(null); setLoading(false);
      setError(rangeIsTooLong ? `Можна обрати не більше ${MAX_PERIOD_DAYS} календарних днів` : "Некоректний період");
      return;
    }
    const controller = new AbortController();
    setLoading(true); setError(null); setSnapshots(null);
    void Promise.all(dates.map(async (date): Promise<DailyPhotoReportSnapshot> => {
      const response = await fetch(`/api/admin/photo-report?date=${date}`, { signal: controller.signal });
      const data = await response.json() as { rows?: DailyPhotoReportRow[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? `Не вдалося завантажити ${date}`);
      return { date, rows: data.rows ?? [] };
    })).then(setSnapshots).catch((requestError: unknown) => {
      if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : "Не вдалося завантажити дані за період");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [dates, rangeIsTooLong]);

  const scopedStores = useMemo(() => storeId === "all" ? stores : stores.filter((store) => store.id === storeId), [storeId, stores]);
  const scopedSnapshots = useMemo(() => snapshots?.map(({ date, rows }) => ({ date, rows: storeId === "all" ? rows : rows.filter((row) => row.key === storeId) })) ?? [], [snapshots, storeId]);
  const heatmap = useMemo(() => buildPhotoReportHeatmap(scopedStores, scopedSnapshots), [scopedStores, scopedSnapshots]);
  const dailySubmissionCounts = useMemo(() => buildDailySubmissionCounts(scopedSnapshots), [scopedSnapshots]);
  const storeSummaries = useMemo(() => buildStorePhotoReportPeriodSummaries(scopedStores, scopedSnapshots), [scopedStores, scopedSnapshots]);
  const totalReports = storeSummaries.reduce((total, store) => total + store.reports, 0);
  const totalPhotos = storeSummaries.reduce((total, store) => total + store.photos, 0);
  const latestDay = dailySubmissionCounts.at(-1)?.submittedStores ?? 0;

  const choosePreset = (days: number) => { setPresetDays(days); setRange(defaultRange(days)); };
  const changeRange = (values: [Dayjs | null, Dayjs | null] | null) => {
    if (!values?.[0] || !values[1]) return;
    setPresetDays(undefined); setRange([values[0].format("YYYY-MM-DD"), values[1].format("YYYY-MM-DD")]);
  };
  const openGallery = async (target: GalleryTarget) => {
    setGalleryTarget(target); setGalleryReports([]); setGalleryError(null); setGalleryLoading(true);
    try {
      const response = await fetch(`/api/admin/photo-report/gallery?store_id=${target.storeId}&date=${target.date}`);
      const data = await response.json() as { reports?: GalleryReport[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Не вдалося завантажити фото");
      setGalleryReports(data.reports ?? []);
    } catch (requestError: unknown) {
      setGalleryError(requestError instanceof Error ? requestError.message : "Не вдалося завантажити фото");
    } finally { setGalleryLoading(false); }
  };
  const columns: ColumnsType<StorePhotoReportPeriodSummary> = [
    { title: "Магазин", dataIndex: "store", key: "store", sorter: (a, b) => a.store.localeCompare(b.store, "uk") },
    { title: "Днів зі звітом", dataIndex: "submittedDays", key: "submittedDays", render: (value: number) => `${value}/${dates.length}`, sorter: (a, b) => a.submittedDays - b.submittedDays },
    { title: "Звітів", dataIndex: "reports", key: "reports", align: "right", sorter: (a, b) => a.reports - b.reports },
    { title: "Фото", dataIndex: "photos", key: "photos", align: "right", sorter: (a, b) => a.photos - b.photos },
    { title: "Продавці", dataIndex: "sellers", key: "sellers", render: (sellers: string[]) => sellers.length ? sellers.join(", ") : "—" },
    { title: "Галерея", key: "gallery", render: (_, store) => store.lastSubmittedDate ? <Button type="link" onClick={() => void openGallery({ storeId: store.key, storeName: store.store, date: store.lastSubmittedDate! })}>Останній звіт</Button> : "—" },
  ];

  return <div className="space-y-4">
    <Card><div className="flex flex-wrap items-end gap-4">
      <div><div className="mb-1 text-sm text-ink-500">Період</div><Segmented value={presetDays} onChange={(value) => choosePreset(Number(value))} options={PERIOD_PRESET_DAYS.map((days) => ({ label: `${days} днів`, value: days }))} /></div>
      <div><div className="mb-1 text-sm text-ink-500">Свій період</div><DatePicker.RangePicker value={[dayjs(range[0]), dayjs(range[1])]} onChange={changeRange} allowClear={false} format="DD.MM.YYYY" /></div>
      <div><div className="mb-1 text-sm text-ink-500">Магазин</div><Select className="min-w-64" value={storeId} onChange={setStoreId} options={[{ value: "all", label: "Усі магазини" }, ...stores.map((store) => ({ value: store.id, label: store.name }))]} disabled={!stores.length} /></div>
    </div></Card>
    {error ? <Alert type="error" showIcon message="Аналітика за період недоступна" description={error} /> : null}
    {loading ? <Card><div className="py-12 text-center"><Spin /></div></Card> : null}
    {!loading && !error && !stores.length ? <Card><Empty description="Немає активних магазинів" /></Card> : null}
    {!loading && !error && scopedStores.length ? <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card><Statistic title="Надіслали за останній день" value={`${latestDay}/${scopedStores.length}`} /></Card>
        <Card><Statistic title="Не надіслали за останній день" value={scopedStores.length - latestDay} /></Card>
        <Card><Statistic title="Звітів за період" value={totalReports} /></Card>
        <Card><Statistic title="Фото за період" value={totalPhotos} /></Card>
      </div>
      <Alert type="info" showIcon message={`Фактичні дані за ${dates.length} календарних днів`} description="Відсутній звіт у завантажений день показано як «Не надіслав». При помилці завантаження період не підміняється нулями." />
      <Card title={storeId === "all" ? "Магазинів, що надіслали звіт за днями" : "Звіти магазину за днями"}><Column data={dailySubmissionCounts} xField="date" yField="submittedStores" {...(storeId === "all" ? { colorField: "level", scale: { color: { domain: ["red", "yellow", "green"], range: ["#ff4d4f", "#faad14", "#52c41a"] } }, legend: false } : { color: "#eb4d83", legend: false })} height={260} tooltip={{ title: "date", items: [{ field: "submittedStores", name: storeId === "all" ? "Магазинів надіслали звіт" : "Звітів" }] }} axis={{ y: { title: storeId === "all" ? "Магазинів" : "Звітів" } }} theme={chartTheme} /></Card>
      <Card title={storeId === "all" ? "Теплова карта надсилань усіх магазинів" : "Теплова карта надсилань магазину"}><Heatmap data={heatmap} mark="cell" xField="date" yField="store" colorField="level" scale={{ color: { domain: ["none", "one", "two_or_more"], range: ["#ff4d4f", "#faad14", "#52c41a"] } }} style={{ inset: 1 }} height={Math.min(Math.max(scopedStores.length * 24, 280), 720)} tooltip={{ title: "store", items: [{ field: "date", name: "Дата" }, { field: "reports", name: "Звітів" }, { field: "photos", name: "Фото" }, { field: "sellers_label", name: "Надіслали звіт" }] }} meta={{ date: { type: "cat" }, store: { type: "cat" } }} theme={chartTheme} /></Card>
      <Card title="Підсумок по магазинах"><Table rowKey="key" columns={columns} dataSource={storeSummaries} pagination={{ pageSize: 26, hideOnSinglePage: true }} /></Card>
    </> : null}
    <Modal open={galleryTarget !== null} title={galleryTarget ? `${galleryTarget.storeName} — фото за ${galleryTarget.date}` : "Фото звіт"} onCancel={() => setGalleryTarget(null)} footer={null} width={980} destroyOnClose>
      {galleryTarget ? <div className="mb-3 flex justify-end"><Button onClick={() => void openGallery(galleryTarget)} loading={galleryLoading}>Оновити посилання на фото</Button></div> : null}
      {galleryLoading ? <div className="py-12 text-center"><Spin /></div> : null}
      {galleryError ? <Alert type="error" showIcon message="Не вдалося відкрити фото" description={galleryError} /> : null}
      {!galleryLoading && !galleryError && !galleryReports.length ? <Empty description="У звітах немає доступних фото" /> : null}
      {!galleryLoading && !galleryError ? <Image.PreviewGroup><div className="space-y-5">{galleryReports.map((report, reportIndex) => <section key={report.id} className="rounded-lg border border-[rgb(var(--border-2))] p-3"><div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-700"><strong className="text-ink-900">Звіт {galleryReports.length - reportIndex}</strong><span>{report.seller} · {new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" }).format(new Date(report.created_at))} · {report.photos.length} фото</span></div><div className="flex flex-wrap gap-3">{report.photos.map((url, index) => <Image key={url} src={url} alt={`Фото звіту ${index + 1}`} width={148} height={111} style={{ objectFit: "cover" }} />)}</div></section>)}</div></Image.PreviewGroup> : null}
    </Modal>
  </div>;
}
