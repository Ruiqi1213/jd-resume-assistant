import { NextRequest, NextResponse } from "next/server";
import { checkAccessCode, extractAccessCode, isAccessGateEnabled } from "@/lib/access";
import { checkRateLimitShared, getClientIp, rateLimitKeyForCode } from "@/lib/rate-limit";
import { chatCompletions, deepseekConfig, getRateLimitPerHour } from "@/lib/ai-client";
import {
  coerceJdInput,
  composeFocusPromptFlexible,
  composeGeneratePromptFlexible,
  hasJdContent,
  parseFocusJson,
  parseGenerateJson,
  type GreetingTone,
} from "@/lib/llm";
import { clipResume, clipSupplement } from "@/lib/clip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TONES = new Set<GreetingTone>(["sincere", "professional", "lively"]);

function pickTone(v: unknown): GreetingTone {
  return TONES.has(v as GreetingTone) ? (v as GreetingTone) : "sincere";
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rawBody = (await req.json().catch(() => null)) as {
    mode?: string;
    resumeText?: string;
    jd?: unknown;
    supplement?: string;
    tone?: string;
    extraFocus?: string;
    direction?: string;
    accessCode?: string;
  } | null;

  const code = extractAccessCode(req, rawBody);
  if (isAccessGateEnabled() && !checkAccessCode(code)) {
    return NextResponse.json({ error: "访问口令不正确，请输入有效口令后重试" }, { status: 401 });
  }
  const rl = await checkRateLimitShared(
    rateLimitKeyForCode("generate", code, ip),
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
  if (!resumeText) {
    return NextResponse.json({ error: "缺少简历文本，请先上传或粘贴简历" }, { status: 400 });
  }

  // jd 可以是结构化对象、JSON 字符串、或 JD 原文（截图 OCR 文本）
  const { info: jd, raw: jdRaw } = coerceJdInput(body.jd);
  if (!jd && !jdRaw) {
    return NextResponse.json({ error: "缺少 JD 信息，请先上传/粘贴 JD" }, { status: 400 });
  }
  if (!hasJdContent(body.jd)) {
    return NextResponse.json({ error: "JD 内容过短或无效" }, { status: 400 });
  }

  const { apiKey, baseUrl, model } = deepseekConfig();
  if (!apiKey) {
    return NextResponse.json({ error: "服务端未配置 DEEPSEEK_API_KEY" }, { status: 500 });
  }

  const mode = body.mode === "focus" ? "focus" : "greeting";

  try {
    if (mode === "focus") {
      const raw = await chatCompletions({
        baseUrl,
        apiKey,
        model,
        systemPrompt: "你是求职策略顾问，只输出合法 JSON。",
        userPrompt: composeFocusPromptFlexible({
          jd,
          jdRaw,
          resume: resumeText,
          direction: String(body.direction || ""),
        }),
        maxTokens: 1000,
        temperature: 0.7,
      });
      return NextResponse.json({ mode, options: parseFocusJson(raw), remaining: rl.remaining });
    }

    const raw = await chatCompletions({
      baseUrl,
      apiKey,
      model,
      systemPrompt: "你是打招呼文案专家，只输出合法 JSON。",
      userPrompt: composeGeneratePromptFlexible({
        resume: resumeText,
        jd,
        jdRaw,
        supplement: clipSupplement(String(body.supplement || "")),
        tone: pickTone(body.tone),
        extraFocus: String(body.extraFocus || ""),
      }),
      maxTokens: 1400,
      temperature: 0.6,
    });
    return NextResponse.json({
      mode: "greeting",
      result: parseGenerateJson(raw),
      remaining: rl.remaining,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "生成失败" },
      { status: 500 },
    );
  }
}
