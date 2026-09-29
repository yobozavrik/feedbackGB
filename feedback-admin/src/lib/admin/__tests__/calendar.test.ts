import { describe, expect, it } from "vitest";
import { calendarInput, calendarRange } from "../calendar";
const valid = { title: " Перевірити магазин ", description: "Опис", due_at: "2026-09-29T12:00:00+03:00", remind_at: "2026-09-29T08:00:00Z", status: "planned" };
describe("personal calendar validation", () => {
  it("trims title and normalizes timezone", () => expect(calendarInput(valid)?.due_at).toBe("2026-09-29T09:00:00.000Z"));
  it("accepts no reminder", () => expect(calendarInput({ ...valid, remind_at: null })).not.toBeNull());
  it("accepts done", () => expect(calendarInput({ ...valid, status: "done" })?.status).toBe("done"));
  it.each([null, [], {}, { ...valid, title: " " }, { ...valid, title: "x".repeat(201) }, { ...valid, description: "x".repeat(2001) },
    { ...valid, owner_id: "other" }, { ...valid, status: "cancelled" }, { ...valid, due_at: "2026-02-30T12:00:00Z" },
    { ...valid, due_at: "2026-09-29T24:00:00Z" }, { ...valid, due_at: "2026-09-29T12:00" },
    { ...valid, remind_at: "2026-09-29T10:00:00Z" }, { ...valid, remind_at: "bad" }, { ...valid, description: {} }])("rejects invalid input %#", value => expect(calendarInput(value)).toBeNull());
  it("accepts bounded range", () => expect(calendarRange("2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z")).not.toBeNull());
  it("rejects reversed range", () => expect(calendarRange(valid.due_at, valid.remind_at)).toBeNull());
  it("rejects unbounded range", () => expect(calendarRange("2026-01-01T00:00:00Z", "2026-10-01T00:00:00Z")).toBeNull());
});
