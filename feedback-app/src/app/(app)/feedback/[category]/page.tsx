import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { FeedbackForm } from "@/components/FeedbackForm";
import { ConsumablesCartForm } from "@/components/ConsumablesCartForm";
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

      {category.id !== "consumables_request" ? (
        <section className="relative mb-4 overflow-hidden rounded-xl border border-ink-300/20 bg-elev p-5 shadow-soft">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-[28px] leading-none text-brand-500">
              {category.emoji}
            </div>
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
      ) : null}

      {category.requiresProduct ? (
        <PriorityFeedbackForm category={category} />
      ) : (
        category.id === "consumables_request" ? <ConsumablesCartForm /> : <FeedbackForm category={category} />
      )}
    </main>
  );
}
