"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRightIcon } from "@/components/icons";
import { PhotoInput } from "@/components/PhotoInput";

type Category = "electricity" | "water" | "heating" | "other";
type Store = { id: number; name: string };
type Period = { id: string; due_at: string; status: string };
type Latest = { id: string; category: Category; review_status: string;
  review_note: string | null; revision: number };
type Config = { period: Period; latest: Latest[] };

const categories: Array<{ id: Category; label: string; description: string; icon: string; tint: string }> = [
  { id: "electricity", label: "Електроенергія", description: "Фото лічильника або рахунку", icon: "💡", tint: "bg-cat-supply" },
  { id: "water", label: "Вода", description: "Фото лічильника або рахунку", icon: "💧", tint: "bg-cat-missing" },
  { id: "heating", label: "Опалення", description: "Фото лічильника або рахунку", icon: "♨️", tint: "bg-cat-quality" },
  { id: "other", label: "Інші послуги", description: "Фото документа або показника", icon: "📄", tint: "bg-elev2" },
];

function toFile(dataUrl: string): File {
  const [header, encoded] = dataUrl.split(",", 2);
  const mime = /^data:(image\/(?:jpeg|png|webp));base64$/.exec(header)?.[1];
  if (!mime || !encoded) throw new Error("Неприпустиме фото");
  const raw = atob(encoded);
  return new File([Uint8Array.from(raw, (char) => char.charCodeAt(0))], "utility-photo", { type: mime });
}

export function UtilityReadingsForm() {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const clientId = useRef(crypto.randomUUID());
  const uploaded = useRef<Map<string, string>>(new Map());
  const submittingRef = useRef(false);

  useEffect(() => {
    void fetch("/api/utility-readings/stores")
      .then(async (res) => { if (!res.ok) throw new Error("Не вдалося завантажити магазини"); return res.json(); })
      .then((data: { stores: Store[] }) => { setStores(data.stores); setStoreId(data.stores[0]?.id ?? null); })
      .catch((cause: Error) => setError(cause.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!storeId) return;
    let active = true;
    setLoading(true); setError(null); setSuccess(null); setConfig(null); setCategory(null); setPhotos([]);
    clientId.current = crypto.randomUUID(); uploaded.current.clear();
    void fetch(`/api/utility-readings?store_id=${storeId}`)
      .then(async (res) => { if (!res.ok) throw new Error("Не вдалося завантажити дані"); return res.json(); })
      .then((data: Config) => { if (active) setConfig(data); })
      .catch((cause: Error) => { if (active) setError(cause.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [storeId]);

  function choose(next: Category) {
    setCategory(next); setPhotos([]); setComment(""); setError(null); setSuccess(null);
    clientId.current = crypto.randomUUID(); uploaded.current.clear();
  }

  async function submit() {
    if (submittingRef.current || photoBusy || !storeId || !config?.period || !category) return;
    if (photos.length < 1) { setError("Додайте хоча б одне фото"); return; }
    submittingRef.current = true;
    setSending(true); setError(null);
    try {
      const uploadIds: string[] = [];
      for (const [index, photo] of photos.entries()) {
        const key = `${storeId}:${config.period.id}:${category}:${index}:${photo}`;
        let uploadId = uploaded.current.get(key);
        if (!uploadId) {
          const form = new FormData();
          form.set("store_id", String(storeId));
          form.set("period_id", config.period.id);
          form.set("category", category);
          form.set("client_submission_id", clientId.current);
          form.set("photo", toFile(photo));
          const response = await fetch("/api/utility-readings/uploads", { method: "POST", body: form });
          if (!response.ok) throw new Error("Не вдалося зберегти фото. Спробуйте ще раз.");
          uploadId = (await response.json() as { upload_id: string }).upload_id;
          uploaded.current.set(key, uploadId);
        }
        uploadIds.push(uploadId);
      }
      const response = await fetch("/api/utility-readings/submissions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ store_id: storeId, period_id: config.period.id,
          category, comment: comment.trim() || null, client_submission_id: clientId.current, upload_ids: uploadIds }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error === "conflict"
          ? "Термін минув або подання вже перевірено. Оновіть сторінку."
          : "Не вдалося надіслати фото. Спробуйте ще раз.");
      }
      const result = await response.json() as { submission_id: string };
      setSuccess(`Фото збережено. Номер подання: ${result.submission_id}.`);
      setConfig((current) => current ? { ...current, latest: [
        ...current.latest.filter((item) => item.category !== category),
        { id: result.submission_id, category, review_status: "submitted", review_note: null,
          revision: (current.latest.find((item) => item.category === category)?.revision ?? 0) + 1 },
      ] } : current);
      clientId.current = crypto.randomUUID(); uploaded.current.clear();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Помилка подання");
    } finally { submittingRef.current = false; setSending(false); }
  }

  const selectedStore = stores.find((store) => store.id === storeId);
  const chosen = categories.find((item) => item.id === category);
  const canSubmit = !!config?.period && config.period.status === "open"
    && new Date(config.period.due_at).getTime() >= Date.now();

  return <div className="space-y-4 pb-28">
    <div className="px-1"><h1 className="font-display text-display text-ink-900">Надати показники</h1>
      <p className="mt-1 text-body text-ink-700">Оберіть послугу, зробіть фото та надішліть.</p></div>
    {stores.length > 1 ? <div className="card p-4"><label htmlFor="utility-store" className="field-label">Магазин</label>
      <select id="utility-store" className="field-input field-select" value={storeId ?? ""} disabled={sending}
        onChange={(event) => setStoreId(Number(event.target.value))}>
        {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
      </select></div> : null}
    {selectedStore ? <section className="rounded-2xl bg-brand-600 p-4 text-white shadow-soft">
      <p className="text-meta uppercase tracking-wide text-white/80">Магазин</p>
      <h2 className="mt-1 font-display text-title">{selectedStore.name}</h2></section> : null}
    {loading ? <div className="card p-5">Завантажуємо…</div> : null}
    {!loading && !selectedStore ? <div className="callout callout-warning">Для вас не призначено магазин. Зверніться до адміністратора.</div> : null}
    {config?.period ? <p className="px-1 text-meta text-ink-500">Подати до {new Intl.DateTimeFormat("uk-UA",
      { timeZone: "Europe/Kyiv", dateStyle: "medium", timeStyle: "short" }).format(new Date(config.period.due_at))} за Києвом</p> : null}
    {config?.period && !canSubmit ? <div className="callout callout-warning">Термін подання минув або прийом закрито.</div> : null}
    {!category && !loading && config ? <div className="space-y-3">
      {categories.map((item) => {
        const latest = config.latest.find((entry) => entry.category === item.id);
        return <button key={item.id} type="button" onClick={() => choose(item.id)}
          disabled={latest?.review_status === "verified"}
          className="group flex min-h-[80px] w-full items-center rounded-card border border-ink-300/20 bg-elev p-4 text-left shadow-soft transition-all active:scale-[0.985] disabled:opacity-70">
          <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px] text-[26px] ${item.tint}`}>{item.icon}</span>
          <span className="ml-4 min-w-0 flex-1"><span className="block font-display text-[17px] font-bold text-ink-900">{item.label}</span>
            <span className="block text-body text-ink-700">{latest?.review_status === "verified"
              ? "Перевірено · зміни через адміністратора"
              : latest?.review_status === "needs_correction"
                ? `Потрібне виправлення${latest.review_note ? `: ${latest.review_note}` : ""}`
              : latest ? `Подано · версія №${latest.revision}` : item.description}</span></span>
          <ChevronRightIcon size={20} className="flex-shrink-0 text-ink-500" />
        </button>;
      })}
    </div> : null}
    {category && chosen ? <section className="card space-y-4 p-5">
      <div><h2 className="font-display text-title">{chosen.icon} {chosen.label}</h2>
        <p className="mt-1 text-body text-ink-700">Сфотографуйте лічильник, квитанцію або інший документ для цієї послуги.</p></div>
      <PhotoInput key={category} label="Фото" maxPhotos={15} maxOutputBytes={650 * 1024}
        maxDimension={1600} disabled={sending} onBusyChange={setPhotoBusy} onChange={setPhotos} />
      <div><label htmlFor="utility-comment" className="field-label">Коментар (необов’язково)</label>
        <textarea id="utility-comment" className="field-textarea" maxLength={1000}
          value={comment} onChange={(event) => setComment(event.target.value)} /></div>
    </section> : null}
    {error ? <div className="callout callout-danger">{error}</div> : null}
    {success ? <div className="callout callout-success">{success}</div> : null}
    <div className="bottom-action-bar"><div className="mx-auto flex w-full max-w-md gap-2">
      <button type="button" className="btn-back" disabled={sending} onClick={() => {
        if (category) { setCategory(null); setPhotos([]); setError(null); setSuccess(null); }
        else history.back();
      }}>Назад</button>
      {category ? <button type="button" className="btn-primary flex-1"
        disabled={sending || photoBusy || !canSubmit || !photos.length || !!success}
        onClick={() => void submit()}>{sending ? "Надсилаємо…" : "Надіслати фото"}</button> : null}
    </div></div>
  </div>;
}
