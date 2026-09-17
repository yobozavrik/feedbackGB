import { Header } from "@/components/Header";
import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import { HR_TOPICS } from "@/lib/hrTopics";

export const dynamic = "force-dynamic";

export default function HrMenuPage() {
  return (
    <main className="relative">
      <Header subtitle="Питання по HR" back={{ href: "/", label: "Назад" }} />

      <h2 className="mb-4 px-1 font-display text-[15px] font-semibold text-ink-900">
        Обери, що тебе цікавить
      </h2>

      <div className="space-y-3">
        {HR_TOPICS.map((topic, idx) => (
          <Link
            key={topic.id}
            href={`/hr-menu/${topic.id}`}
            className="group relative flex min-h-[80px] animate-fade-up items-center rounded-card border border-ink-300/20 bg-elev p-4 shadow-soft transition-all duration-200 active:scale-[0.985] active:bg-elev2 [@media(hover:hover)]:hover:-translate-y-0.5"
            style={{ animationDelay: `${idx * 40}ms` }}
          >
            <div className="relative flex w-full items-center gap-4">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px] bg-cat-hr text-[24px] leading-none">
                {topic.emoji}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-[17px] font-bold leading-tight text-ink-900">
                  {topic.title}
                </h3>
                <p className="mt-0.5 text-body leading-snug text-ink-700">
                  {topic.short}
                </p>
              </div>
              <ChevronRightIcon size={20} className="flex-shrink-0 text-ink-500" />
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-8 flex items-center justify-between px-1 text-[12px] text-ink-500">
        <span>v1 • Галя Балувана</span>
        <Link
          href="/"
          className="rounded-full bg-elev px-3 py-1 font-medium text-ink-700 shadow-soft transition-all hover:bg-elev2 active:scale-95"
        >
          Головна
        </Link>
      </div>
    </main>
  );
}
