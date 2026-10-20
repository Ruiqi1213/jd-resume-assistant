import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

afterEach(() => {
  delete process.env.ACCESS_CODE;
});

describe("POST /api/analyze access control", () => {
  it("rejects an analysis request before any model call when the access code is invalid", async () => {
    process.env.ACCESS_CODE = "private-campus-code";
    const request = new NextRequest("https://example.com/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json", "x-access-code": "wrong-code" },
      body: JSON.stringify({ resumeText: "候选人简历", jobs: [{ id: "a", jd: "岗位要求" }] }),
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("口令") });
  });
});
