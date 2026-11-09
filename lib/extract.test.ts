import { describe, expect, it, vi } from "vitest";

vi.mock("pdf-parse", () => { throw new Error("DOMMatrix is not defined"); });

import { isImageMime, parseResumeBuffer } from "./extract";

describe("PDF dependency isolation", () => {
  it("keeps text extraction and image detection available when PDF loading is broken", async () => {
    expect(await parseResumeBuffer(Buffer.from("resume content"), "resume.txt", "text/plain"))
      .toEqual({ text: "resume content", kind: "txt" });
    expect(isImageMime("image/png", "job.png")).toBe(true);
  });

  it("rejects only the PDF operation when its dependency cannot initialize", async () => {
    await expect(parseResumeBuffer(Buffer.from("test"), "resume.pdf", "application/pdf")).rejects.toThrow();
    expect(await parseResumeBuffer(Buffer.from("another resume"), "resume.txt", "text/plain"))
      .toEqual({ text: "another resume", kind: "txt" });
  });
});
