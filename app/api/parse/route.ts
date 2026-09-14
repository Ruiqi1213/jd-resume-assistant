import { NextRequest, NextResponse } from "next/server";
import { checkAccessCode, extractAccessCode, isAccessGateEnabled } from "@/lib/access";
import { checkRateLimitShared, getClientIp, rateLimitKeyForCode } from "@/lib/rate-limit";
import { chatCompletions, deepseekConfig, getRateLimitPerHour } from "@/lib/ai-client";
import {
  composeExtractPrompt,
  parseJdJson,
  parseResumeJson,
} from "@/lib/llm";
import { clipJd, clipResume } from "@/lib/clip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_JD_BATCH = 12;

async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rawBody = (await req.json().catch(() => null)) as {
    resumeText?: string;
    jdText?: string;
    jdTexts?: unknown;
    accessCode?: string;
  } | null;

  const code = extractAccessCode(req, rawBody);
  if (isAccessGateEnabled() && !checkAccessCode(code)) {
    return NextResponse.json({ error: "访问口令不正确，请输入有效口令后重试" }, { status: 401 });
  }
  const rl = await checkRateLimitShared(
    rateLimitKeyForCode("parse", code, ip),
    getRateLimitPerHour(),
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: `请求过于频繁，请 ${rl.retryAfterSec} 秒后重试` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const body = rawBody;
  if (!body) return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });

  const resumeText = clipResume(String(body.resumeText || ""));
  const singleJd = clipJd(String(body.jdText || ""));
  const jdTexts: string[] = Array.isArray(body.jdTexts)
    ? (body.jdTexts as unknown[]).map((t) => clipJd(String(t || ""))).filter((t) => t.trim())
    : singleJd
      ? [singleJd]
      : [];

  if (!resumeText && jdTexts.length === 0) {
    return NextResponse.json({ error: "简历与 JD 均为空" }, { status: 400 });
  }
  if (jdTexts.length > MAX_JD_BATCH) {
    return NextResponse.json({ error: `JD 数量过多（最多${MAX_JD_BATCH}个）` }, { status: 400 });
  }

  const { apiKey, baseUrl, model } = deepseekConfig();
  if (!apiKey) {
    return NextResponse.json({ error: "服务端未配置 DEEPSEEK_API_KEY" }, { status: 500 });
  }

  try {
    const resumePromise = resumeText
      ? chatCompletions({
          baseUrl,
          apiKey,
          model,
          systemPrompt: "你是严谨的简历解析器，只输出合法 JSON。",
          userPrompt: composeExtractPrompt("resume", resumeText),
          maxTokens: 1200,
        }).then(parseResumeJson)
      : Promise.resolve(null);

    const jdPromise = withConcurrency(jdTexts, 3, (jdText) =>
      chatCompletions({
        baseUrl,
        apiKey,
        model,
        systemPrompt: "你是严谨的 JD 解析器，只输出合法 JSON。",
        userPrompt: composeExtractPrompt("jdImage", jdText),
        maxTokens: 1200,
      }).then(parseJdJson),
    );

    const [resumeProfile, jdInfos] = await Promise.all([resumePromise, jdPromise]);

    return NextResponse.json({
      resumeProfile,
      // 兼容旧前端
      jdInfo: jdInfos[0] || null,
      // 新批量格式
      jdInfos,
      remaining: rl.remaining,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "结构化解析失败" },
      { status: 500 },
    );
  }
}
