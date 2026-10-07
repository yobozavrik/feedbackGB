"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Image, Input, Modal, Select, Space, Statistic, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";

type Period = { id: string; period_start: string; period_end: string; due_at: string; status: string };
type Config = { periods: Period[]; current_period_id: string; delivery_enabled: boolean };
type Category = "electricity" | "water" | "heating" | "other";
type Row = { store_id: number; store_name: string; category: Category; status: "missing" | "submitted";
  photo_count: number; submission: { id: string; review_status: string; revision: number; submitted_at: string } | null;
  delivery: { state: string; attempts: number; last_error_code: string | null } | null };
type Detail = { submission: { id: string; store_id: number; category: Category; comment: string | null;
  revision: number; review_status: string; submitted_at: string; superseded_at: string | null;
  review_note: string | null };
  photos: Array<{ id: string; url: string | null }>;
  versions: Array<{ id: string; revision: number; review_status: string; submitted_at: string }>;
  delivery: { state: string; attempts: number; last_error_code: string | null } | null };

const categoryLabel: Record<Category, string> = {
  electricity: "Електроенергія", water: "Вода", heating: "Опалення", other: "Інші послуги",
};
const reviewLabel: Record<string, string> = {
  submitted: "Очікує перевірки", verified: "Підтверджено", needs_correction: "Повернуто на виправлення",
};
const baseTabs = [
  { key: "coverage", label: "Огляд фото" },
  { key: "submissions", label: "Подання" },
];

export function UtilityReadingsWorkspace() {
  const [tab, setTab] = useState("coverage");
  const [config, setConfig] = useState<Config | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const selectedPeriodIdRef = useRef<string | null>(null);
  const coverageRequestSeq = useRef(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [coverageReady, setCoverageReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function loadCoverage(periodId: string) {
    const requestSeq = ++coverageRequestSeq.current;
    setLoading(true); setCoverageReady(false); setError(null);
    try {
      const response = await fetch(`/api/admin/utility-readings/coverage?period_id=${periodId}`);
      if (!response.ok) throw new Error("Не вдалося завантажити подання");
      const payload = await response.json() as { rows: Row[] };
      if (requestSeq !== coverageRequestSeq.current) return;
      setRows(payload.rows);
      setCoverageReady(true);
      setSelectedPeriodId(periodId);
      selectedPeriodIdRef.current = periodId;
      setDetail(null);
    } catch (cause) {
      if (requestSeq === coverageRequestSeq.current) setError(cause instanceof Error ? cause.message : "Помилка завантаження");
    } finally {
      if (requestSeq === coverageRequestSeq.current) setLoading(false);
    }
  }

  const load = useCallback(async () => {
    const requestSeq = ++coverageRequestSeq.current;
    setLoading(true); setCoverageReady(false); setError(null);
    try {
      const response = await fetch("/api/admin/utility-readings/config");
      if (!response.ok) throw new Error("Не вдалося завантажити поточний місяць");
      const next = await response.json() as Config;
      const periodId = selectedPeriodIdRef.current
        && next.periods.some((item) => item.id === selectedPeriodIdRef.current)
        ? selectedPeriodIdRef.current : next.current_period_id;
      const coverage = await fetch(`/api/admin/utility-readings/coverage?period_id=${periodId}`);
      if (!coverage.ok) throw new Error("Не вдалося завантажити подання");
      const payload = await coverage.json() as { rows: Row[] };
      if (requestSeq !== coverageRequestSeq.current) return;
      setConfig(next);
      setRows(payload.rows);
      setCoverageReady(true);
      setSelectedPeriodId(periodId);
      selectedPeriodIdRef.current = periodId;
    } catch (cause) {
      if (requestSeq === coverageRequestSeq.current) setError(cause instanceof Error ? cause.message : "Помилка завантаження");
    } finally {
      if (requestSeq === coverageRequestSeq.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function openDetail(id: string) {
    setError(null); setDetail(null);
    const response = await fetch(`/api/admin/utility-readings/submissions?id=${id}`);
    if (!response.ok) { setError("Не вдалося відкрити подання"); return; }
    setDetail(await response.json() as Detail);
    setNote("");
  }

  async function review(status: "verified" | "needs_correction") {
    if (!detail) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/admin/utility-readings/submissions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: detail.submission.id, status, note }),
      });
      if (!response.ok) throw new Error(status === "needs_correction"
        ? "Вкажіть причину повернення та перевірте стан подання."
        : "Не вдалося підтвердити подання.");
      setDetail(null);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка перевірки"); }
    finally { setBusy(false); }
  }

  const columns: ColumnsType<Row> = [
    { title: "Магазин", dataIndex: "store_name", key: "store_name" },
    { title: "Послуга", dataIndex: "category", key: "category",
      render: (category: Category) => categoryLabel[category] },
    { title: "Фото", dataIndex: "photo_count", key: "photo_count" },
    { title: "Стан", dataIndex: "status", key: "status",
      render: (status: Row["status"]) => <Tag color={status === "submitted" ? "success" : "default"}>
        {status === "submitted" ? "Подано" : "Немає фото"}
      </Tag> },
    { title: "Перевірка", key: "review", render: (_, row) => row.submission
      ? reviewLabel[row.submission.review_status] ?? row.submission.review_status : "—" },
    ...(config?.delivery_enabled
      ? [{ title: "Telegram", key: "delivery", render: (_: unknown, row: Row) => row.delivery?.state ?? "—" }]
      : []),
    { title: "Деталі", key: "detail", render: (_, row) => row.submission
      ? <Button type="link" onClick={() => void openDetail(row.submission!.id)}>Відкрити</Button> : "—" },
  ];
  const selectedPeriod = config?.periods.find((period) => period.id === selectedPeriodId);
  const submitted = rows.filter((row) => row.status === "submitted").length;
  const missing = rows.filter((row) => row.status === "missing").length;
  const reviewPending = rows.filter((row) => row.submission?.review_status === "submitted").length;

  return <AdminPageContainer title="Показники комунальних послуг"
    subTitle="Фото за чотирма категоріями по магазинах"
    tabs={{ activeKey: tab, onChange: setTab, items: config?.delivery_enabled
      ? [...baseTabs, { key: "delivery", label: "Доставка в Telegram" }] : baseTabs }}>
    <div className="space-y-4">
      {error ? <Alert type="error" showIcon message={error} /> : null}
      {config && !config.delivery_enabled ? <Alert type="info" showIcon
        message="Фото зберігаються в системі. Пересилання в Telegram ще не налаштоване." /> : null}
      <Card><Space wrap><span>Місяць:</span>
        <Select value={selectedPeriodId ?? undefined} className="min-w-[220px]"
          options={(config?.periods ?? []).map((period) => ({
            value: period.id, label: `${period.period_start} — ${period.period_end}`,
          }))}
          onChange={(periodId) => void loadCoverage(periodId)} />
        <Button onClick={() => void load()}>Оновити</Button></Space>
        {selectedPeriod ? <p className="mt-2 text-sm text-ink-500">Термін першого подання: {new Intl.DateTimeFormat("uk-UA",
          { timeZone: "Europe/Kyiv", dateStyle: "medium", timeStyle: "short" }).format(new Date(selectedPeriod.due_at))} за Києвом</p> : null}
      </Card>
      {coverageReady && (tab === "coverage" || tab === "submissions") ? <>
        <div className="grid gap-3 md:grid-cols-3">
          <Card><Statistic title="Категорій з фото" value={submitted} /></Card>
          <Card><Statistic title="Без фото" value={missing} /></Card>
          <Card><Statistic title="Очікують перевірки" value={reviewPending} /></Card>
        </div>
        <Card title={tab === "coverage" ? "Магазини й категорії" : "Подання"}>
          <Table rowKey={(row) => `${row.store_id}:${row.category}`} loading={loading}
            columns={columns} dataSource={tab === "submissions"
              ? rows.filter((row) => !!row.submission) : rows} pagination={{ pageSize: 25 }} />
        </Card>
        <p className="text-sm text-ink-500">«Немає фото» означає лише відсутність подання в категорії; не кожна послуга є в кожному магазині.</p>
      </> : null}
      {tab === "delivery" ? <Card title="Доставка в Telegram">
        <Table rowKey={(row) => `${row.store_id}:${row.category}`}
          columns={columns.filter((column) => ["store_name", "category", "delivery", "detail"].includes(String(column.key)))}
          dataSource={rows.filter((row) => !!row.delivery)} pagination={{ pageSize: 25 }} />
        <p className="mt-3 text-sm text-ink-500">Статус доставки не означає перевірку бухгалтером. Невизначений стан потребує ручної звірки чату.</p>
      </Card> : null}
      <Modal open={!!detail} title={detail
        ? `${categoryLabel[detail.submission.category]} · подання №${detail.submission.revision}` : "Подання"}
        onCancel={() => setDetail(null)} footer={null} width={900} destroyOnClose>
        {detail ? <div className="space-y-4">
          <p>Подано: {new Intl.DateTimeFormat("uk-UA",
            { timeZone: "Europe/Kyiv", dateStyle: "medium", timeStyle: "short" }).format(new Date(detail.submission.submitted_at))}
            {" · "}стан: {reviewLabel[detail.submission.review_status] ?? detail.submission.review_status}</p>
          {detail.submission.comment ? <Card size="small" title="Коментар">{detail.submission.comment}</Card> : null}
          {detail.submission.review_note ? <Card size="small" title="Примітка до перевірки">
            {detail.submission.review_note}</Card> : null}
          <Card size="small" title={`Фото · ${detail.photos.length}`}>
            <Image.PreviewGroup><Space wrap>{detail.photos.map((photo) => photo.url
              ? <Image key={photo.id} src={photo.url} width={150} alt="Фото послуги" />
              : <span key={photo.id}>Фото недоступне</span>)}</Space></Image.PreviewGroup>
          </Card>
          <Card size="small" title="Історія версій"><Space wrap>{detail.versions.map((version) =>
            <Button key={version.id} type={version.id === detail.submission.id ? "primary" : "default"}
              onClick={() => void openDetail(version.id)}>№{version.revision} · {reviewLabel[version.review_status] ?? version.review_status}</Button>)}</Space></Card>
          {detail.submission.superseded_at ? <Alert type="info" showIcon
            message="Це попередня версія. Перевіряти можна лише поточну." /> : null}
          {!detail.submission.superseded_at && detail.submission.review_status === "submitted" ? <Space direction="vertical" className="w-full">
            <Input.TextArea value={note} onChange={(event) => setNote(event.target.value)}
              maxLength={1000} placeholder="Причина повернення або примітка" />
            <Space><Button type="primary" loading={busy} onClick={() => void review("verified")}>Підтвердити</Button>
              <Button danger loading={busy} onClick={() => void review("needs_correction")}>Повернути на виправлення</Button></Space>
          </Space> : null}
        </div> : null}
      </Modal>
    </div>
  </AdminPageContainer>;
}
