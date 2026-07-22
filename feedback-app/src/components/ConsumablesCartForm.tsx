"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTelegram } from "./TelegramProvider";

type CatalogItem = { id: number; name: string; unit: string | null; category_name: string | null };
type CartItem = CatalogItem & { quantity: number };

export function ConsumablesCartForm() {
  const router = useRouter();
  const { initData, webApp } = useTelegram();
  const [search, setSearch] = useState("");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: "1", page_size: "50" });
        if (search.trim()) params.set("search", search.trim());
        const res = await fetch(`/api/consumables/catalog?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error("Не вдалося завантажити каталог");
        const body = await res.json() as { items?: CatalogItem[] };
        setCatalog(body.items ?? []);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не вдалося завантажити каталог");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 200);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [search]);

  const total = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  const add = (item: CatalogItem) => setCart((current) => {
    const existing = current.find((row) => row.id === item.id);
    return existing ? current.map((row) => row.id === item.id ? { ...row, quantity: row.quantity + 1 } : row) : [...current, { ...item, quantity: 1 }];
  });
  const setQuantity = (id: number, quantity: number) => setCart((current) => quantity <= 0 ? current.filter((row) => row.id !== id) : current.map((row) => row.id === id ? { ...row, quantity } : row));

  async function submit() {
    if (cart.length === 0) { setError("Додай хоча б один розхідний матеріал"); return; }
    setSubmitting(true); setError(null);
    try {
      const res = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ category: "consumables_request", fields: { comment: comment.trim() || null }, cart_items: cart.map(({ id, quantity }) => ({ product_id: id, quantity })), init_data: initData || undefined, client_submission_id: crypto.randomUUID(), client_created_at: new Date().toISOString() }) });
      if (!res.ok) { const body = await res.json().catch(() => null); throw new Error(body?.error || "Не вдалося відправити заявку"); }
      webApp?.HapticFeedback?.notificationOccurred("success");
      router.push("/thanks?cat=consumables_request");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося відправити заявку"); webApp?.HapticFeedback?.notificationOccurred("error"); }
    finally { setSubmitting(false); }
  }

  return <div className="space-y-4 pb-24">
    <section className="card space-y-3 p-4"><label className="field-label" htmlFor="consumables-search">Знайти розхідний матеріал</label><input id="consumables-search" className="field-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Наприклад: стрічка, пакети, рукавички" />
      {loading ? <p className="text-sm text-ink-500">Завантаження каталогу…</p> : <div className="max-h-64 space-y-2 overflow-y-auto">{catalog.map((item) => <button key={item.id} type="button" onClick={() => add(item)} className="flex w-full items-center justify-between rounded-lg border border-ink-300/20 p-3 text-left hover:bg-elev2"><span><span className="block font-medium text-ink-900">{item.name}</span><span className="text-xs text-ink-500">{item.unit ?? "шт"}{item.category_name ? ` · ${item.category_name}` : ""}</span></span><span className="text-brand-600">＋</span></button>)}{catalog.length === 0 ? <p className="text-sm text-ink-500">Нічого не знайдено</p> : null}</div>}</section>
    <section className="card space-y-3 p-4"><h2 className="font-display text-lg font-semibold text-ink-900">Кошик {cart.length ? `· ${total}` : ""}</h2>{cart.length === 0 ? <p className="text-sm text-ink-500">Додайте позиції з каталогу.</p> : cart.map((item) => <div key={item.id} className="flex items-center gap-3"><div className="min-w-0 flex-1"><p className="truncate font-medium text-ink-900">{item.name}</p><p className="text-xs text-ink-500">{item.unit ?? "шт"}</p></div><button type="button" className="btn-ghost px-3" onClick={() => setQuantity(item.id, item.quantity - 1)}>−</button><span className="w-7 text-center font-medium">{item.quantity}</span><button type="button" className="btn-ghost px-3" onClick={() => setQuantity(item.id, item.quantity + 1)}>＋</button></div>)}</section>
    <section className="card p-4"><label className="field-label" htmlFor="consumables-comment">Коментар (необов’язково)</label><textarea id="consumables-comment" className="field-textarea" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} placeholder="Наприклад: потрібно до понеділка" /></section>
    {error ? <p className="rounded-lg border border-brand-500/40 bg-brand-50 p-3 text-sm text-brand-600">{error}</p> : null}
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-300/20 bg-bg/90 px-4 py-3 backdrop-blur-md sm:px-6"><div className="mx-auto flex max-w-md gap-2"><button type="button" onClick={() => router.back()} className="btn-ghost px-4">Назад</button><button type="button" onClick={submit} disabled={submitting || cart.length === 0} className="btn-primary flex-1">{submitting ? "Відправляємо…" : "Відправити заявку"}</button></div></div>
  </div>;
}
