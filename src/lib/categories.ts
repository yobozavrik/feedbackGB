/**
 * Feedback categories shown on the home screen.
 * Each category drives the form layout: which fields to render, hints, accent color.
 *
 * Adding a category? Append a new entry; the home grid + dynamic form picks it up.
 */

export type CategoryId =
  | "missing_item"
  | "supply_problem"
  | "store_idea"
  | "spotted_elsewhere"
  | "tech_issue"
  | "customer_voice";

export type FieldKind = "text" | "textarea" | "number" | "photo";

export interface CategoryField {
  id: string;
  label: string;
  placeholder?: string;
  kind: FieldKind;
  required?: boolean;
  hint?: string;
}

export interface Category {
  id: CategoryId;
  emoji: string;
  title: string;
  short: string;
  description: string;
  /** Tailwind gradient classes for the card / header. */
  gradient: string;
  /** Tailwind text color class for accent. */
  accent: string;
  fields: CategoryField[];
}

export const CATEGORIES: Category[] = [
  {
    id: "missing_item",
    emoji: "🛒",
    title: "Не вистачає товару",
    short: "Чого не вистачило сьогодні",
    description:
      "Зафіксуй позицію, якої не було на полиці, але яку питали клієнти або яка має бути.",
    gradient: "from-blush-200 to-blush-100",
    accent: "text-blush-600",
    fields: [
      {
        id: "item_name",
        label: "Що саме не вистачає?",
        placeholder: "Наприклад: булочка з маком, молоко 2.5%",
        kind: "text",
        required: true,
      },
      {
        id: "how_often",
        label: "Скільки разів сьогодні питали?",
        placeholder: "Приблизно",
        kind: "number",
      },
      {
        id: "comment",
        label: "Коментар",
        placeholder: "Що клієнт казав, чим заміняли",
        kind: "textarea",
      },
      { id: "photo", label: "Фото порожньої полиці (необов'язково)", kind: "photo" },
    ],
  },
  {
    id: "supply_problem",
    emoji: "📦",
    title: "Проблема з постачанням",
    short: "Привезли не те / зіпсоване / запізно",
    description:
      "Опиши, що не так з постачанням: кількість, якість, час, документи.",
    gradient: "from-peach-200 to-peach-100",
    accent: "text-peach-300",
    fields: [
      {
        id: "supplier_or_item",
        label: "Постачальник або товар",
        placeholder: "Наприклад: молочка, м'ясо, хліб",
        kind: "text",
        required: true,
      },
      {
        id: "issue",
        label: "Що саме сталось?",
        placeholder: "Привезли менше, зіпсоване, не те що замовляли...",
        kind: "textarea",
        required: true,
      },
      { id: "photo", label: "Фото проблеми", kind: "photo" },
    ],
  },
  {
    id: "store_idea",
    emoji: "💡",
    title: "Ідея для магазину",
    short: "Що покращити в моєму магазині",
    description:
      "Пропозиції щодо викладки, асортименту, обладнання, обслуговування — все що підвищить продажі або зручність.",
    gradient: "from-lavender-200 to-lavender-100",
    accent: "text-lavender-400",
    fields: [
      {
        id: "title",
        label: "Коротко: суть ідеї",
        placeholder: "Наприклад: переставити каву ближче до каси",
        kind: "text",
        required: true,
      },
      {
        id: "detail",
        label: "Розкажи деталі",
        placeholder: "Чому це допоможе, як ти це бачиш",
        kind: "textarea",
        required: true,
      },
      { id: "photo", label: "Фото / ескіз", kind: "photo" },
    ],
  },
  {
    id: "spotted_elsewhere",
    emoji: "👀",
    title: "Підгледіла в іншому місці",
    short: "Класна ідея ззовні — фото + опис",
    description:
      "Бачила круту викладку, нестандартний товар чи фішку в іншому магазині? Поділись — ми порівняємо й, можливо, впровадимо.",
    gradient: "from-mint-200 to-mint-100",
    accent: "text-mint-300",
    fields: [
      {
        id: "where",
        label: "Де побачила?",
        placeholder: "Назва магазину / місто",
        kind: "text",
        required: true,
      },
      {
        id: "what",
        label: "Що саме сподобалось?",
        placeholder: "Опис ідеї або товару",
        kind: "textarea",
        required: true,
      },
      { id: "photo", label: "Фото (дуже бажано)", kind: "photo" },
    ],
  },
  {
    id: "tech_issue",
    emoji: "🔧",
    title: "Технічна проблема",
    short: "Обладнання, ремонт, чистота",
    description:
      "Не працює холодильник, тече кран, треба ремонт, ліхтар перегорів — фіксуй сюди.",
    gradient: "from-blush-100 to-lavender-100",
    accent: "text-blush-500",
    fields: [
      {
        id: "what_broken",
        label: "Що зламано/потребує уваги?",
        placeholder: "Наприклад: холодильник з молочкою",
        kind: "text",
        required: true,
      },
      {
        id: "urgency",
        label: "Наскільки терміново?",
        placeholder: "Терміново / можна почекати",
        kind: "text",
      },
      {
        id: "details",
        label: "Деталі",
        kind: "textarea",
      },
      { id: "photo", label: "Фото", kind: "photo" },
    ],
  },
  {
    id: "customer_voice",
    emoji: "🗣",
    title: "Голос клієнта",
    short: "Що часто питають, на що скаржаться",
    description:
      "Зворотний зв'язок від клієнтів: побажання, скарги, повторювані запити.",
    gradient: "from-peach-100 to-blush-100",
    accent: "text-peach-300",
    fields: [
      {
        id: "topic",
        label: "Про що клієнт казав?",
        placeholder: "Коротко",
        kind: "text",
        required: true,
      },
      {
        id: "quote",
        label: "Слова клієнта",
        placeholder: "Перекажи якомога ближче до тексту",
        kind: "textarea",
      },
      {
        id: "frequency",
        label: "Як часто таке чуєш?",
        placeholder: "Сьогодні вперше / регулярно",
        kind: "text",
      },
    ],
  },
];

export function getCategory(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}
