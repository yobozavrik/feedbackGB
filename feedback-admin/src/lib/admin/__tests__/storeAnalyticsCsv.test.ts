import { describe, expect, it } from "vitest";
import { buildCsv, safeCsvCell } from "../storeAnalyticsCsv";

describe("store analytics CSV", () => {
  it("quotes separators, quotes and line breaks", () => {
    expect(safeCsvCell('a;"b"\nc')).toBe('"a;""b""\nc"');
  });

  it.each(["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\t=1+1", "  =1+1"])(
    "neutralizes spreadsheet formula input %s", (value) => {
      expect(safeCsvCell(value)).toBe(`"'${value}"`);
    });

  it("keeps numbers exact and writes UTF-8 BOM with CRLF", () => {
    expect(buildCsv(["amount_minor"], [["900719925474099312345"]]))
      .toBe('\uFEFF"amount_minor"\r\n"900719925474099312345"\r\n');
  });
});
