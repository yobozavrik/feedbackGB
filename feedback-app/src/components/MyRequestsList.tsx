"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { STATUS_META, type FeedbackStatus } from "@/lib/feedbackStatusMeta";
import { ChevronRightIcon, PackageIcon, SearchIcon } from "@/components/icons";

interface MyFeedbackRow {
  id: string;
  category: string;
  category_title: string | null;
  summary: string | null;
  status: FeedbackStatus;
  created_at: string;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? `Сьогодні, ${date.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}`
    : date.toLocaleDateString("uk-UA", { day: "numeric", month: "long" });
}

function statusClass(status: FeedbackStatus): string {
  if (status === "resolved") return "bg-green-100 text-green-700";
  if (status === "in_progress") return "bg-orange-100 text-orange-700";
  if (status === "rejected") return "bg-red-100 text-red-700";
  return "bg-[#d8e2ff] text-[#004493]";
}

export function MyRequestsList() {
  const [rows, setRows] = useState<MyFeedbackRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/my-feedback?limit=50")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { rows?: MyFeedbackRow[] }) => { setRows(data.rows ?? []); setError(false); })
      .catch(() => setError(true));
  }, []);

  const filtered = useMemo(() => (rows ?? []).filter((row) => `${row.category_title ?? ""} ${row.summary ?? ""}`.toLocaleLowerCase("uk-UA").includes(search.toLocaleLowerCase("uk-UA"))), [rows, search]);

  if (rows === null) return <div className="space-y-4 px-4 pt-4"><div className="skeleton h-12 rounded-lg" /><div className="skeleton h-32 rounded-xl" /><div className="skeleton h-32 rounded-xl" /></div>;
  if (error) return <p className="px-4 pt-6 text-center text-sm text-[#414755]">Не вдалося завантажити заявки.</p>;

  return <main className="min-h-[calc(100svh-4rem)] bg-[#f2f2f7] px-4 pb-24 pt-4"><div className="mb-4 flex items-center rounded-lg border border-[#c1c6d7]/40 bg-[#f6f3f5] px-3 py-2"><span className="mr-2 text-[#414755]"><SearchIcon size={20} /></span><label className="sr-only" htmlFor="requests-search">Пошук заявок</label><input id="requests-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Пошук заявок…" className="w-full border-0 bg-transparent p-0 text-[15px] text-[#1b1b1d] outline-none placeholder:text-[#717786]" /></div><div className="space-y-4">{filtered.map((row) => { const meta = STATUS_META[row.status] ?? STATUS_META.new; return <Link key={row.id} href={`/my-requests/${row.id}`} className="block rounded-xl border border-[#d1d1d6] bg-white p-4 shadow-sm active:scale-[0.98]"><div className="flex items-start justify-between gap-3"><div><h2 className="text-[17px] font-semibold leading-[22px] text-[#1b1b1d]">{row.category_title ?? "Заявка"}</h2><p className="mt-1 text-[13px] text-[#414755]">{formatDate(row.created_at)}</p></div><span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.02em] ${statusClass(row.status)}`}>{meta.label}</span></div>{row.summary ? <div className="mt-4 flex items-center gap-2 text-[15px] text-[#414755]"><span className="shrink-0 text-[#717786]"><PackageIcon size={16} /></span><span className="line-clamp-1">{row.summary}</span></div> : null}<div className="mt-4 flex justify-end border-t border-[#c1c6d7]/30 pt-3"><span className="inline-flex items-center gap-1 text-[13px] font-medium text-[#0058bc]">Деталі <ChevronRightIcon size={14} /></span></div></Link>; })}</div>{filtered.length === 0 ? <div className="pt-16 text-center text-[#414755]"><p className="text-[15px]">Заявок не знайдено</p></div> : null}</main>;
}
