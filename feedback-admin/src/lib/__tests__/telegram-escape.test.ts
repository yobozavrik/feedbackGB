import { describe, expect, it } from "vitest";
import { escapeHtml } from "../telegram";

describe("telegram escapeHtml", () => {
  it("should escape special characters to safe HTML entities", () => {
    expect(escapeHtml("<b>hello</b>")).toBe("&lt;b&gt;hello&lt;/b&gt;");
    expect(escapeHtml("Hello & Welcome")).toBe("Hello &amp; Welcome");
    expect(escapeHtml("1 < 2 && 4 > 3")).toBe("1 &lt; 2 &amp;&amp; 4 &gt; 3");
  });
});
