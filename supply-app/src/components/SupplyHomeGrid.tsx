import Link from "next/link";

type Card = { title: string; short: string; emoji: string; href: string };
type SoonCard = { title: string; short: string; emoji: string };

// Only routes that actually exist are linked. HR and consumables arrive with
// the bridge (docs/supply-app/HR_CONSUMABLES_BRIDGE_PLAN.md) and are shown as
// non-interactive "coming soon" cards until their pages land — never as dead
// links to a 404.
const ACTIVE: Card[] = [
  {
    title: "Заявка на розхідні матеріали",
    short: "Чекова стрічка, пакети, хімія тощо",
    emoji: "📋",
    href: "/home/feedback/consumables_request",
  },
  {
    title: "Сировина для цеху",
    short: "Замовлення сировини, брак, накладні, постачання",
    emoji: "🧺",
    href: "/home/supply",
  },
  {
    title: "Питання по HR",
    short: "Відпустка, вихідні, лікарняний, звільнення",
    emoji: "🧑‍💼",
    href: "/home/hr-menu",
  },
];

const SOON: SoonCard[] = [
  { title: "Заявка на ремонт", short: "Зламалось обладнання / потрібен ремонт", emoji: "🔧" },
];

const cardBase =
  "group relative flex h-[118px] items-center overflow-hidden rounded-xl border border-ink-300/20 bg-elev p-4 shadow-soft";

export function SupplyHomeGrid() {
  return (
    <div className="space-y-3">
      {ACTIVE.map((card, index) => (
        <Link
          key={card.href}
          href={card.href}
          className={`${cardBase} animate-fade-up transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] active:bg-elev2`}
          style={{ animationDelay: `${index * 60}ms` }}
        >
          <div className="flex w-full items-center gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-[30px] leading-none">
              {card.emoji}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-[19px] font-semibold leading-tight text-ink-900">{card.title}</h3>
              <p className="mt-1 text-[13px] leading-snug text-ink-500">{card.short}</p>
            </div>
            <span aria-hidden className="text-[22px] text-brand-500">→</span>
          </div>
        </Link>
      ))}

      {SOON.map((card) => (
        <div
          key={card.title}
          aria-disabled="true"
          className={`${cardBase} cursor-not-allowed opacity-60`}
        >
          <div className="flex w-full items-center gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-elev2 text-[30px] leading-none grayscale">
              {card.emoji}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-[19px] font-semibold leading-tight text-ink-900">{card.title}</h3>
              <p className="mt-1 text-[13px] leading-snug text-ink-500">{card.short}</p>
            </div>
            <span className="rounded-full bg-elev2 px-2 py-0.5 text-[11px] font-medium text-ink-500">скоро</span>
          </div>
        </div>
      ))}
    </div>
  );
}
