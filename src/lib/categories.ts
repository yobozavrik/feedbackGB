/**
 * Feedback categories shown on the home screen.
 * Each category drives the form layout: which fields to render, hints, accent color.
 *
 * Adding a category? Append a new entry; the home grid + dynamic form picks it up.
 */

export type CategoryId =
  | "missing_item"
  | "overstock"
  | "defect"
  | "supply_problem"
  | "store_idea"
  | "spotted_elsewhere"
  | "tech_issue"
  | "customer_voice"
  | "consumables_request";

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
  /** Tailwind background class for the card tint. */
  gradient: string;
  /** Tailwind text color class for accent. */
  accent: string;
  /** Short tint key (matches Tailwind cat-* color). */
  tint:
    | "missing"
    | "overstock"
    | "defect"
    | "supply"
    | "idea"
    | "spotted"
    | "tech"
    | "voice";
  /**
   * v1 priority flow: this category captures a structured product
   * reference (product_id from the POS catalog). The UI renders a
   * product picker instead of a free-text input.
   */
  requiresProduct?: boolean;
  /**
   * v1 priority flow: this category captures a numeric quantity
   * (scalar, stored on the feedback row). The UI renders a stepper.
   */
  requiresQuantity?: boolean;
  /**
   * Whether the 3 "priority" categories should be rendered as the
   * primary big cards on the home screen. Non-primary categories are
   * collapsed under "+ Інше" in the new v1 UI (PR B).
   */
  priority?: boolean;
  fields: CategoryField[];
}

export const CATEGORIES: Category[] = [
  {
    id: "missing_item",
    emoji: "📉",
    title: "Мало товару",
    short: "Питали — а немає на полиці",
    description:
      "Зафіксуй позицію з каталогу, якої не вистачає. Обери товар, вкажи скільки бракує, за бажанням додай фото полиці.",
    gradient: "bg-cat-missing/40",
    accent: "text-brand-600",
    tint: "missing",
    requiresProduct: true,
    requiresQuantity: true,
    priority: true,
    fields: [
      // item_name залишаємо opt-in на час переходу зі старої форми на нову.
      // Нова форма (PR B) заповнює product_id + quantity напряму, а це поле
      // використовується лише коли товару нема в POS-каталозі.
      {
        id: "item_name",
        label: "Якщо товару нема в каталозі — назва",
        placeholder: "Наприклад: новий сезонний напій",
        kind: "text",
      },
      {
        id: "comment",
        label: "Коментар (необов'язково)",
        placeholder: "Що клієнт казав, чим заміняли",
        kind: "textarea",
      },
      { id: "photo", label: "Фото порожньої полиці (необов'язково)", kind: "photo" },
    ],
  },
  {
    id: "overstock",
    emoji: "📈",
    title: "Багато товару",
    short: "Залежався або зайвий запас",
    description:
      "Товар довго не продається, забиває полицю, накопичився. Обери позицію з каталогу і скільки одиниць зайвих.",
    gradient: "bg-cat-overstock/40",
    accent: "text-brand-600",
    tint: "overstock",
    requiresProduct: true,
    requiresQuantity: true,
    priority: true,
    fields: [
      {
        id: "comment",
        label: "Коментар (необов'язково)",
        placeholder: "Скільки днів лежить, чи псується, що робити",
        kind: "textarea",
      },
      { id: "photo", label: "Фото полиці (необов'язково)", kind: "photo" },
    ],
  },
  {
    id: "defect",
    emoji: "💔",
    title: "Брак товару",
    short: "Пошкоджений, прострочений, битий",
    description:
      "Товар зіпсований, прострочений, пошкоджена упаковка, невідповідна якість. Обери позицію, вкажи кількість і додай фото — воно допомагає з поверненням постачальнику.",
    gradient: "bg-cat-defect/40",
    accent: "text-rose-500",
    tint: "defect",
    requiresProduct: true,
    requiresQuantity: true,
    priority: true,
    fields: [
      {
        id: "defect_type",
        label: "Що саме з ним не так?",
        placeholder: "Прострочений / битий / зіпсований / упаковка",
        kind: "text",
      },
      {
        id: "comment",
        label: "Деталі",
        placeholder: "Коли помітила, які ознаки, скільки партія",
        kind: "textarea",
        required: true,
      },
      { id: "photo", label: "Фото браку (дуже бажано)", kind: "photo" },
    ],
  },
  {
    id: "supply_problem",
    emoji: "📦",
    title: "Проблема з постачанням",
    short: "Привезли не те / зіпсоване / запізно",
    description:
      "Опиши, що не так з постачанням: кількість, якість, час, документи.",
    gradient: "bg-cat-supply/40",
    accent: "text-amber-400",
    tint: "supply",
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
    gradient: "bg-cat-idea/40",
    accent: "text-ink-900",
    tint: "idea",
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
    gradient: "bg-cat-spotted/40",
    accent: "text-ink-900",
    tint: "spotted",
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
    title: "Заявка на ремонт",
    short: "Зламалось обладнання / потрібен ремонт",
    description:
      "Не працює холодильник, тече кран, треба ремонт, ліхтар перегорів — фіксуй сюди.",
    gradient: "bg-cat-tech/40",
    accent: "text-ink-900",
    tint: "tech",
    priority: true,
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
    gradient: "bg-cat-voice/40",
    accent: "text-ink-900",
    tint: "voice",
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
  {
    id: "consumables_request",
    emoji: "📋",
    title: "Заявка на розхідні матеріали",
    short: "Чекова стрічка, пакети, хімія тощо",
    description:
      "Замовлення розхідних матеріалів для роботи магазину: стрічка для терміналів, пакети, засоби для чищення.",
    gradient: "bg-cat-supply/40",
    accent: "text-amber-500",
    tint: "supply",
    priority: true,
    fields: [
      {
        id: "materials_list",
        label: "Що саме потрібно?",
        placeholder: "Наприклад: чекова стрічка 57мм (5 шт), пакети майка (2 рулони)",
        kind: "textarea",
        required: true,
      },
      {
        id: "comment",
        label: "Коментар / примітки (необов'язково)",
        placeholder: "Коли потрібно привезти, особливі побажання",
        kind: "textarea",
      },
    ],
  },
];

export function getCategory(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

/** v1 priority categories rendered as big cards on the home screen. */
export function getPriorityCategories(): Category[] {
  return CATEGORIES.filter((c) => c.priority);
}

/** Non-priority categories — hidden under the "+ Інше" expander. */
export function getSecondaryCategories(): Category[] {
  return CATEGORIES.filter((c) => !c.priority);
}
