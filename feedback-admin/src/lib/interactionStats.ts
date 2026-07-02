// Types and pure aggregation for the click-analytics page.

export interface Interaction {
  id: string;
  page_path: string;
  element_tag: string | null;
  element_id: string | null;
  element_text: string | null;
  x_ratio: number;
  y_ratio: number;
  viewport_w: number | null;
  viewport_h: number | null;
  created_at: string;
  user_id: string | null;
  users: {
    full_name: string;
    display_label: string | null;
  } | null;
}

export interface ElementClickStat {
  tag: string;
  text: string;
  count: number;
}

export interface InteractionStats {
  total: number;
  topElements: ElementClickStat[];
}

const TOP_ELEMENTS_LIMIT = 8;

export function aggregateElementClicks(
  interactions: Interaction[],
): InteractionStats {
  const total = interactions.length;
  const elementClicks = new Map<string, ElementClickStat>();

  interactions.forEach((item) => {
    const key = `${item.element_tag || "DIV"}:${item.element_id || ""}:${item.element_text || ""}`;
    const existing = elementClicks.get(key) || {
      tag: item.element_tag || "HTML",
      text: item.element_text || (item.element_id ? `#${item.element_id}` : "Клік на порожнечу"),
      count: 0,
    };
    existing.count += 1;
    elementClicks.set(key, existing);
  });

  const topElements = Array.from(elementClicks.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_ELEMENTS_LIMIT);

  return { total, topElements };
}
