import Link from "next/link";
import { getCategory } from "@/lib/categories";
import { CheckIcon } from "@/components/icons";

export default function ThanksPage({
  searchParams,
}: {
  searchParams: { cat?: string };
}) {
  const cat = searchParams.cat ? getCategory(searchParams.cat) : undefined;
  return (
    <main className="flex min-h-[var(--app-h)] flex-col items-center justify-center px-[clamp(16px,6vw,24px)] pb-12 pt-12 text-center">
      {/* N6: a small success badge on the category circle instead of a
          plain brand-tinted circle — reads as "done", not just decorative. */}
      <div className="relative">
        <div className="animate-pop flex h-24 w-24 items-center justify-center rounded-full bg-brand-50 text-[56px] shadow-soft">
          {cat?.emoji ?? "💖"}
        </div>
        <span className="absolute -bottom-0.5 -right-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-success text-white ring-[3px] ring-bg">
          <CheckIcon size={18} className="stroke-[2.6]" />
        </span>
      </div>
      <h1 className="mt-6 font-display text-[28px] font-bold leading-tight text-ink-900">
        Записала!
      </h1>
      <p className="mt-3 max-w-xs text-[14px] leading-relaxed text-ink-700">
        {cat ? (
          <>
            Твій фідбек у категорії{" "}
            <span className="font-semibold text-ink-900">{cat.title}</span>{" "}
            вже летить менеджменту.
          </>
        ) : (
          <>Твій фідбек уже летить менеджменту.</>
        )}
        <br />
        Кожне твоє повідомлення — це реальні зміни на полицях.
      </p>

      <div className="mt-8 flex w-full max-w-xs flex-col gap-2">
        <Link href="/" className="btn-primary w-full">
          Надіслати ще
        </Link>
        <Link href="/" className="btn-ghost w-full">
          На головну
        </Link>
      </div>
    </main>
  );
}
