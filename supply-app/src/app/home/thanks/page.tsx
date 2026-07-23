import Link from "next/link";
import { requireSupplyUser } from "@/lib/currentUser";

export const dynamic = "force-dynamic";

export default async function ThanksPage() {
  await requireSupplyUser();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-20 w-20 animate-fade-up items-center justify-center rounded-full bg-brand-50 text-[40px] shadow-soft">
        ✅
      </div>
      <h1 className="font-display text-[22px] font-bold text-ink-900">Заявку надіслано</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-500">
        Менеджер побачить її та зв&apos;яжеться з тобою за потреби.
      </p>
      <Link
        href="/home"
        className="mt-6 inline-flex h-[52px] items-center rounded-lg bg-brand-500 px-6 font-medium text-white transition-all hover:bg-brand-600 active:scale-[0.97]"
      >
        На головну
      </Link>
    </main>
  );
}
