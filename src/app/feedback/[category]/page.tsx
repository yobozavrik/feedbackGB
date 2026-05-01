import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { FeedbackForm } from "@/components/FeedbackForm";
import { PriorityFeedbackForm } from "@/components/PriorityFeedbackForm";
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
      <Header
        subtitle={category.short}
        back={{ href: "/", label: "На головну" }}
      />

      <section className={`relative mb-4 overflow-hidden rounded-3xl ${category.gradient} p-5`}>
        <div className="flex items-start gap-3">
          <div className="text-[36px] leading-none">{category.emoji}</div>
          <div>
            <h1 className="font-display text-[19px] font-semibold leading-tight text-ink-900">
              {category.title}
            </h1>
            <p className="mt-1 text-[13px] leading-snug text-ink-700">
              {category.description}
            </p>
          </div>
        </div>
      </section>

      {category.requiresProduct ? (
        <PriorityFeedbackForm category={category} />
      ) : (
        <FeedbackForm category={category} />
      )}
    </main>
  );
}
