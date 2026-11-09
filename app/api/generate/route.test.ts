import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { chat } = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock("@/lib/access", () => ({
  extractAccessCode: () => "",
  isAccessGateEnabled: () => false,
  checkAccessCode: () => true,
}));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "test",
  rateLimitKeyForCode: () => "test",
  checkRateLimitShared: async () => ({ ok: true, remaining: 19 }),
}));
vi.mock("@/lib/ai-client", () => ({
  getRateLimitPerHour: () => 20,
  deepseekConfig: () => ({
    apiKey: "test",
    baseUrl: "https://example.invalid",
    model: "test",
  }),
  chatCompletions: chat,
}));
import { POST } from "./route";
const generate = (body: object) =>
  POST(
    new NextRequest("http://localhost/api/generate", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );
beforeEach(() => {
  chat.mockReset();
  chat.mockResolvedValue(
    JSON.stringify({
      greeting: "您好，想了解岗位。",
      matchPoints: [],
      suggestions: [],
      questions: [],
    }),
  );
});

describe("optional personal materials", () => {
  it("allows a JD-only greeting and explicitly forbids invented personal claims", async () => {
    const response = await generate({
      jd: "用户增长运营，负责用户拉新及活动策划。",
    });
    expect(response.status).toBe(200);
    expect(chat.mock.calls[0][0].userPrompt).toContain("尚未提供个人经历");
    expect(chat.mock.calls[0][0].userPrompt).toContain(
      "不包含个人技能、学历、年限或业绩断言",
    );
  });
  it("still requires a real JD", async () => {
    expect((await generate({ resumeText: "真实简历" })).status).toBe(400);
    expect(chat).not.toHaveBeenCalled();
  });
  it("does not invent focus strategies without personal material", async () => {
    expect(
      (
        await generate({
          mode: "focus",
          jd: "用户增长运营，负责用户拉新及活动策划。",
        })
      ).status,
    ).toBe(400);
    expect(chat).not.toHaveBeenCalled();
  });
});
