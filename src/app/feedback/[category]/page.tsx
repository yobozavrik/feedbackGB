import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { FeedbackForm } from "@/components/FeedbackForm";
import { CATEGORIES, getCategory } from "@/lib/categories";

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ category: c.id }));
}

export default function FeedbackCategoryPage({
  params,
}: {
  params: { category: string };
}) {
  const category = getCategory(params.category);
  if (!category) notFound();

  return (
    <main>
      <Header subtitle={category.short} />

      <section
        className={`card mb-4 overflow-hidden bg-gradient-to-br ${category.gradient} p-5`}
      >
        <div className="flex items-start gap-3">
          <div className="text-4xl">{category.emoji}</div>
          <div>
            <h1 className="font-display text-lg font-bold text-ink-900">
              {category.title}
            </h1>
            <p className="mt-1 text-sm leading-snug text-ink-700/90">
              {category.description}
            </p>
          </div>
        </div>
      </section>

      <FeedbackForm category={category} />
    </main>
  );
}
