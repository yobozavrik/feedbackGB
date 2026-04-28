import Link from "next/link";
import { Header } from "@/components/Header";
import { getCategory } from "@/lib/categories";

export default function ThanksPage({
  searchParams,
}: {
  searchParams: { cat?: string };
}) {
  const cat = searchParams.cat ? getCategory(searchParams.cat) : undefined;
  return (
    <main>
      <Header subtitle="Дякую тобі!" />
      <section className="card animate-pop relative overflow-hidden p-7 text-center">
        <div className="text-6xl">💖</div>
        <h1 className="mt-3 font-display text-xl font-bold text-ink-900">
          Записала!
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-700">
          {cat ? (
            <>
              Твій фідбек у категорії <b>{cat.title}</b> вже летить менеджменту.
            </>
          ) : (
            <>Твій фідбек уже летить менеджменту.</>
          )}
          <br />
          Кожне твоє повідомлення — це реальні зміни на полицях.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <Link href="/" className="btn-primary">
            Додати ще один фідбек
          </Link>
          <Link href="/admin" className="btn-ghost">
            Подивитись усі записи
          </Link>
        </div>
      </section>
    </main>
  );
}
