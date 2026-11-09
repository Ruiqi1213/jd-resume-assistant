import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/access", () => ({
  extractAccessCode: () => "", isAccessGateEnabled: () => false, checkAccessCode: () => true,
}));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "test", rateLimitKeyForCode: () => "test",
  checkRateLimitShared: async () => ({ ok: true, remaining: 19 }),
}));
vi.mock("@/lib/ai-client", () => ({
  getRateLimitPerHour: () => 20,
  visionConfig: () => ({ apiKey: "", baseUrl: "", model: "" }),
}));
vi.mock("@/lib/extract", () => ({
  isImageMime: (mime: string) => mime.startsWith("image/"),
  parseResumeBuffer: async (buffer: Buffer, name: string) => {
    if (name === "broken.pdf") throw new Error("Invalid PDF");
    return { text: buffer.toString("utf8") };
  },
}));

import { POST } from "./route";

async function upload(files: Array<[string, string, string, string]>) {
  const body = new FormData();
  for (const [slot, name, text, type] of files) body.append(slot, new Blob([text], { type }), name);
  const response = await POST(new NextRequest("http://localhost/api/extract", { method: "POST", body }));
  return { status: response.status, body: await response.json() };
}

describe("batch extraction failure isolation", () => {
  it("preserves a valid resume when JD OCR is unavailable", async () => {
    const result = await upload([
      ["resumes", "resume.txt", "Real resume experience", "text/plain"],
      ["jds", "job.png", "fixture", "image/png"],
    ]);
    expect(result.status).toBe(200);
    expect(result.body.resumes[0].text).toBe("Real resume experience");
    expect(result.body.jds).toEqual([]);
    expect(result.body.failures[0]).toMatchObject({ slot: "jd", index: 0, name: "job.png" });
    expect(result.body.warnings[0]).toContain("VISION_API_KEY");
  });

  it("continues after a broken resume and identifies failures by index even with duplicate names", async () => {
    const result = await upload([
      ["resumes", "broken.pdf", "bad", "application/pdf"],
      ["resumes", "resume.txt", "Valid resume", "text/plain"],
      ["jds", "job.txt", "", "text/plain"],
      ["jds", "job.txt", "Valid job", "text/plain"],
    ]);
    expect(result.status).toBe(200);
    expect(result.body.resumes).toHaveLength(1);
    expect(result.body.jds).toEqual([{ name: "job.txt", text: "Valid job" }]);
    expect(result.body.failures.map((f: { slot: string; index: number }) => [f.slot, f.index])).toEqual([["resume", 0], ["jd", 0]]);
  });

  it("does not claim success when every file failed", async () => {
    const result = await upload([["jds", "job.png", "fixture", "image/png"]]);
    expect(result.status).toBe(400);
    expect(result.body.error).toContain("粘贴 JD 原文");
  });

  it("does not add an empty document as a usable resume", async () => {
    const result = await upload([["resumes", "blank.txt", "   ", "text/plain"]]);
    expect(result.status).toBe(400);
    expect(result.body.error).toContain("未提取到文字");
  });
});
