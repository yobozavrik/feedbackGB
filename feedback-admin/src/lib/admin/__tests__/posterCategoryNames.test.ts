import { describe, expect, it } from "vitest";
import { parseCurrentPosterCategoryNames } from "../posterCategoryNames";

describe("Poster category names parser", () => {
  it("accepts the current Poster category contract", () => {
    expect([...parseCurrentPosterCategoryNames([
      { category_id: "7", category_name: " Напівфабрикати " },
      { category_id: 8, category_name: "Піца" },
    ])]).toEqual([[7, "Напівфабрикати"], [8, "Піца"]]);
  });

  it.each<unknown>([
    [],
    [{ category_id: "x", category_name: "Піца" }],
    [{ category_id: 7, category_name: "" }],
    [{ category_id: 7, category_name: "A" }, { category_id: 7, category_name: "B" }],
  ])("rejects an untrustworthy catalog", (value) => {
    expect(() => parseCurrentPosterCategoryNames(value)).toThrow("poster_categories_invalid_response");
  });
});
