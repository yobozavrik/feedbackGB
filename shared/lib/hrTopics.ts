/**
 * HR menu topics shown on `/hr-menu`. UI-only for now — not yet wired to a
 * feedback category or form (that comes once the form/data shape is decided).
 */
export interface HrTopic {
  id: string;
  emoji: string;
  title: string;
  short: string;
}

export const HR_TOPICS: HrTopic[] = [
  {
    id: "vacation",
    emoji: "🏖️",
    title: "Хочу у відпустку",
    short: "Планова відпустка або кілька днів",
  },
  {
    id: "day-off",
    emoji: "🛋️",
    title: "Хочу пару вихідних",
    short: "Один-два додаткові вихідні дні",
  },
  {
    id: "sick-leave",
    emoji: "🤒",
    title: "Треба лікарняний",
    short: "Хвороба, довідка, лікарняний період",
  },
  {
    id: "resignation",
    emoji: "🚪",
    title: "Хочу звільнитися",
    short: "Заява або розмова про звільнення",
  },
  {
    id: "transfer",
    emoji: "🔁",
    title: "Хочу перевестися в інший магазин/цех",
    short: "Переведення на іншу точку або дільницю",
  },
];

export function getHrTopic(id: string): HrTopic | undefined {
  return HR_TOPICS.find((t) => t.id === id);
}
