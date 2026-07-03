import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import Link from "next/link";
import { getHrTopic } from "@/lib/hrTopics";

export const dynamic = "force-dynamic";

export default function HrTopicPage({ params }: { params: { topic: string } }) {
  const topic = getHrTopic(params.topic);
  if (!topic) notFound();

  return (
    <main className="relative">
      <Header subtitle="Питання по HR" back={{ href: "/hr-menu", label: "Назад" }} />

      <div className="flex flex-col items-center rounded-xl border border-ink-300/20 bg-elev p-6 text-center shadow-soft">
        <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-brand-50 text-[32px] leading-none">
          {topic.emoji}
        </div>
        <h2 className="mt-3 font-display text-[19px] font-semibold text-ink-900">
          {topic.title}
        </h2>
        <p className="mt-2 text-[13px] leading-snug text-ink-500">
          Форма для цього запиту з&apos;явиться найближчим часом.
        </p>
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
