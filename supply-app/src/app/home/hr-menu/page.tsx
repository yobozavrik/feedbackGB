import Link from "next/link";
import { requireSupplyUser } from "@/lib/currentUser";
import { SupplyHeader } from "@/components/SupplyHeader";
import { HR_TOPICS } from "@/lib/hrTopics";

export const dynamic = "force-dynamic";

export default async function HrMenuPage() {
  await requireSupplyUser();

  return (
    <main className="relative">
      <SupplyHeader subtitle="Питання по HR" back={{ href: "/home", label: "Назад" }} />

      <h2 className="mb-4 px-1 font-display text-[15px] font-semibold text-ink-900">
        Обери, що тебе цікавить
      </h2>

      <div className="space-y-3">
        {HR_TOPICS.map((topic, idx) => (
          <Link
            key={topic.id}
            href={`/home/hr-menu/${topic.id}`}
            className="group relative flex min-h-[100px] animate-fade-up items-center overflow-hidden rounded-xl border border-ink-300/20 bg-elev p-4 shadow-soft transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] active:bg-elev2"
            style={{ animationDelay: `${idx * 60}ms` }}
          >
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-[26px] leading-none">
              {topic.emoji}
            </div>
            <div className="ml-4 min-w-0 flex-1">
              <h3 className="font-display text-[17px] font-semibold leading-tight text-ink-900">{topic.title}</h3>
              <p className="mt-1 text-[13px] leading-snug text-ink-500">{topic.short}</p>
            </div>
            <span aria-hidden className="text-[22px] text-brand-500">→</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
