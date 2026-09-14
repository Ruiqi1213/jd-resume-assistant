import { describe, expect, it } from "vitest";
import { clipText, MAX_RESUME_CHARS, clipResume } from "./clip";

describe("clipText", () => {
  it("returns trimmed text when under limit", () => {
    expect(clipText("  hello  ", 10)).toBe("hello");
  });

  it("truncates and marks overflow", () => {
    const out = clipText("abcdefghij", 5);
    expect(out.startsWith("abcde")).toBe(true);
    expect(out).toContain("已截断");
  });

  it("caps resume at MAX_RESUME_CHARS", () => {
    const long = "人".repeat(MAX_RESUME_CHARS + 50);
    const out = clipResume(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain("已截断");
  });
});
