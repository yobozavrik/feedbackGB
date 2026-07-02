import { describe, expect, it } from "vitest";
import {
  aggregateElementClicks,
  type Interaction,
} from "../interactionStats";

function click(overrides: Partial<Interaction>): Interaction {
  return {
    id: `i-${Math.random()}`,
    page_path: "/login",
    element_tag: "BUTTON",
    element_id: null,
    element_text: "OK",
    x_ratio: 0.5,
    y_ratio: 0.5,
    viewport_w: 375,
    viewport_h: 812,
    created_at: new Date().toISOString(),
    user_id: null,
    users: null,
    ...overrides,
  };
}

describe("aggregateElementClicks", () => {
  it("groups clicks by tag+id+text and sorts by count desc", () => {
    const stats = aggregateElementClicks([
      click({ element_text: "OK" }),
      click({ element_text: "OK" }),
      click({ element_text: "1" }),
    ]);
    expect(stats.total).toBe(3);
    expect(stats.topElements[0]).toEqual({ tag: "BUTTON", text: "OK", count: 2 });
    expect(stats.topElements[1]).toEqual({ tag: "BUTTON", text: "1", count: 1 });
  });

  it("labels clicks without text via #id or the empty-space fallback", () => {
    const stats = aggregateElementClicks([
      click({ element_text: null, element_id: "pin-pad" }),
      click({ element_text: null, element_id: null, element_tag: null }),
    ]);
    const texts = stats.topElements.map((e) => e.text);
    expect(texts).toContain("#pin-pad");
    expect(texts).toContain("Клік на порожнечу");
    // null tag falls back to HTML for display
    expect(stats.topElements.find((e) => e.text === "Клік на порожнечу")?.tag).toBe("HTML");
  });

  it("caps the top list at 8 elements", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      click({ element_text: `btn-${i}` }),
    );
    expect(aggregateElementClicks(many).topElements).toHaveLength(8);
  });

  it("returns empty stats for no interactions", () => {
    expect(aggregateElementClicks([])).toEqual({ total: 0, topElements: [] });
  });
});
