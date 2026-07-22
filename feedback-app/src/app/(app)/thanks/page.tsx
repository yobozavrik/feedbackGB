import { Fragment } from "react";
import Link from "next/link";
import { getCategory } from "@/lib/categories";
import { CONSUMABLES_STATUS_META, CONSUMABLES_TIMELINE } from "@/lib/consumablesStatusMeta";
import { getConsumablesOrderDetail } from "@/lib/consumablesOrder";
import { isUuid } from "@/lib/validation";
import { CheckCircleIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function ThanksPage({ searchParams }: { searchParams: { cat?: string; id?: string } }) {
  const cat = searchParams.cat ? getCategory(searchParams.cat) : undefined;
  const isConsumables = cat?.id === "consumables_request";

  // Bridge to the real warehouse pipeline: look up the just-created order's
  // stage by feedback id (the client's submission id). Orders can merge into an
  // already-in-progress CRM order, so this may already be past «Прийнята».
  // Falls back to stage 0 if the lookup isn't available yet.
  let currentStep = 0;
  if (isConsumables && searchParams.id && isUuid(searchParams.id)) {
    try {
      const detail = await getConsumablesOrderDetail(searchParams.id);
      if (detail) currentStep = CONSUMABLES_STATUS_META[detail.status].step;
    } catch {
      // CRM hiccup — keep the default «Прийнята» stage.
    }
  }

  if (isConsumables) return (
    <main className="flex min-h-[100svh] flex-col items-center bg-[#f2f2f7] px-6 pt-[14vh] text-center">
      <div className="animate-pop flex h-24 w-24 items-center justify-center rounded-full bg-[#e6f4ea] text-[#1d9d54]"><CheckCircleIcon size={56} /></div>
      <h1 className="mt-6 text-[22px] font-bold text-[#1b1b1d]">Заявка прийнята складом</h1>
      <p className="mt-3 max-w-xs text-[15px] leading-5 text-[#414755]">Ви отримаєте сповіщення про зміну статусу.</p>

      <div className="mt-10 w-full max-w-sm rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-center">
          {CONSUMABLES_TIMELINE.map((step, i) => {
            const done = i <= currentStep;
            return (
              <Fragment key={step.label}>
                {i > 0 ? <div className={`mx-1.5 h-0.5 flex-1 rounded-full ${i <= currentStep ? "bg-[#0058bc]" : "bg-[#c1c6d7]"}`} /> : null}
                <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${done ? "bg-[#0058bc] text-white" : "border-2 border-[#c1c6d7] text-[#717786]"}`}>
                  {i === currentStep ? <CheckCircleIcon size={18} /> : i + 1}
                </span>
              </Fragment>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[11px] font-medium">
          {CONSUMABLES_TIMELINE.map((step, i) => (
            <span key={step.label} className={i <= currentStep ? "text-[#0058bc]" : "text-[#717786]"}>{step.label}</span>
          ))}
        </div>
      </div>

      <div className="mt-8 flex w-full max-w-sm flex-col gap-3 pb-8">
        <Link href="/feedback/consumables_request" className="flex h-14 items-center justify-center rounded-xl bg-[#0058bc] text-[17px] font-semibold text-white active:scale-[0.98]">Створити ще одну заявку</Link>
        <Link href="/my-requests" className="flex h-14 items-center justify-center rounded-xl border border-[#0058bc] bg-transparent text-[17px] font-semibold text-[#0058bc] active:scale-[0.98]">До моїх заявок</Link>
      </div>
    </main>
  );

  return <main className="flex min-h-[100svh] flex-col items-center justify-center px-6 pb-12 pt-12 text-center"><div className="animate-pop flex h-24 w-24 items-center justify-center rounded-full bg-brand-50 text-[56px] shadow-soft">{cat?.emoji ?? "💖"}</div><h1 className="mt-6 font-display text-[28px] font-bold leading-tight text-ink-900">Записала!</h1><p className="mt-3 max-w-xs text-[14px] leading-relaxed text-ink-700">Твій фідбек уже летить менеджменту.</p><div className="mt-8 flex w-full max-w-xs flex-col gap-2"><Link href="/" className="btn-primary w-full">Додати ще один фідбек</Link><Link href="/" className="btn-ghost w-full">На головну</Link></div></main>;
}
