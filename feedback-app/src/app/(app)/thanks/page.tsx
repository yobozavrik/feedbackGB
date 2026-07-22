import Link from "next/link";
import { getCategory } from "@/lib/categories";
import { CheckCircleIcon } from "@/components/icons";

export default function ThanksPage({ searchParams }: { searchParams: { cat?: string } }) {
  const cat = searchParams.cat ? getCategory(searchParams.cat) : undefined;
  const isConsumables = cat?.id === "consumables_request";

  if (isConsumables) return <main className="flex min-h-[100svh] flex-col items-center bg-[#f2f2f7] px-6 pt-[18vh] text-center"><div className="animate-pop flex h-24 w-24 items-center justify-center rounded-full bg-[#e6f4ea] text-[#1d9d54]"><CheckCircleIcon size={56} /></div><h1 className="mt-6 text-[22px] font-bold text-[#1b1b1d]">Заявка прийнята складом</h1><p className="mt-3 max-w-xs text-[15px] leading-5 text-[#414755]">Ви отримаєте сповіщення про зміну статусу.</p><div className="mt-10 flex w-full max-w-sm flex-col gap-3"><Link href="/feedback/consumables_request" className="flex h-14 items-center justify-center rounded-xl bg-[#0058bc] text-[17px] font-semibold text-white active:scale-[0.98]">Створити ще одну заявку</Link><Link href="/my-requests" className="flex h-14 items-center justify-center rounded-xl border border-[#0058bc] bg-transparent text-[17px] font-semibold text-[#0058bc] active:scale-[0.98]">До моїх заявок</Link></div></main>;

  return <main className="flex min-h-[100svh] flex-col items-center justify-center px-6 pb-12 pt-12 text-center"><div className="animate-pop flex h-24 w-24 items-center justify-center rounded-full bg-brand-50 text-[56px] shadow-soft">{cat?.emoji ?? "💖"}</div><h1 className="mt-6 font-display text-[28px] font-bold leading-tight text-ink-900">Записала!</h1><p className="mt-3 max-w-xs text-[14px] leading-relaxed text-ink-700">Твій фідбек уже летить менеджменту.</p><div className="mt-8 flex w-full max-w-xs flex-col gap-2"><Link href="/" className="btn-primary w-full">Додати ще один фідбек</Link><Link href="/" className="btn-ghost w-full">На головну</Link></div></main>;
}
