import { NextRequest, NextResponse } from "next/server";
import { checkAccessCode, extractAccessCode, isAccessGateEnabled } from "@/lib/access";
import { chatCompletions, deepseekConfig, getRateLimitPerHour } from "@/lib/ai-client";
import { clipJd, clipResume } from "@/lib/clip";
import { coerceJdInput } from "@/lib/llm";
import {
  DEFAULT_MATCH_WEIGHTS,
  buildJdSegments,
  buildResumeSegments,
  composeMatchPrompt,
  normalizeJobMatch,
  parseRawJobMatch,
  sortJobMatchesStable,
} from "@/lib/match";
import { checkRateLimitShared, getClientIp, rateLimitKeyForCode } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ANALYZE_BATCH = 12;

type AnalyzeJob = { id?: unknown; jd?: unknown };

async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rawBody = (await req.json().catch(() => null)) as {
    resumeText?: unknown;
    jobs?: unknown;
    accessCode?: string;
  } | null;

  const code = extractAccessCode(req, rawBody);
  if (isAccessGateEnabled() && !checkAccessCode(code)) {
    return NextResponse.json({ error: "访问口令不正确，请输入有效口令后重试" }, { status: 401 });
  }
  const rl = await checkRateLimitShared(
    rateLimitKeyForCode("analyze", code, ip),
    getRateLimitPerHour(),
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: `请求过于频繁，请 ${rl.retryAfterSec} 秒后重试` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  if (!rawBody) return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  const resumeText = clipResume(String(rawBody.resumeText || ""));
  const jobs = Array.isArray(rawBody.jobs) ? (rawBody.jobs as AnalyzeJob[]) : [];
  if (!resumeText) return NextResponse.json({ error: "缺少简历文本" }, { status: 400 });
  if (!jobs.length) return NextResponse.json({ error: "请至少选择 1 个岗位" }, { status: 400 });
  if (jobs.length > MAX_ANALYZE_BATCH) {
    return NextResponse.json({ error: `岗位数量过多（最多${MAX_ANALYZE_BATCH}个）` }, { status: 400 });
  }

  const normalizedJobs = jobs.map((job, index) => ({
    id: typeof job.id === "string" && job.id.trim() ? job.id.trim().slice(0, 100) : `job-${index + 1}`,
    input: job.jd,
  }));
  if (new Set(normalizedJobs.map((job) => job.id)).size !== normalizedJobs.length) {
    return NextResponse.json({ error: "岗位 ID 不能重复" }, { status: 400 });
  }

  const { apiKey, baseUrl, model } = deepseekConfig();
  if (!apiKey) {
    return NextResponse.json({ error: "服务端未配置 DEEPSEEK_API_KEY" }, { status: 500 });
  }

  const resumeSegments = buildResumeSegments(resumeText);
  try {
    const outputs = await withConcurrency(normalizedJobs, 3, async (job, index) => {
      const { info, raw } = coerceJdInput(job.input);
      const jdRaw = info ? "" : clipJd(raw);
      const jdSegments = buildJdSegments(info, jdRaw);
      if (!jdSegments.length) {
        return {
          analysis: normalizeJobMatch({
            raw: {},
            jobId: job.id,
            originalOrder: index,
            resumeSegments,
            jdSegments: [],
            fallbackCompany: info?.company,
            fallbackPosition: info?.position,
          }),
          error: "JD 内容为空或无法识别",
        };
      }

      try {
        const rawResult = await chatCompletions({
          baseUrl,
          apiKey,
          model,
          systemPrompt: "你是严谨的校园招聘匹配分析器，只输出合法 JSON。不得输出录用概率。",
          userPrompt: composeMatchPrompt({
            resumeSegments,
            jdSegments,
            knownCompany: info?.company,
            knownPosition: info?.position,
          }),
          maxTokens: 2200,
          temperature: 0,
        });
        return {
          analysis: normalizeJobMatch({
            raw: parseRawJobMatch(rawResult),
            jobId: job.id,
            originalOrder: index,
            resumeSegments,
            jdSegments,
            fallbackCompany: info?.company,
            fallbackPosition: info?.position,
          }),
          error: "",
        };
      } catch (error) {
        return {
          analysis: normalizeJobMatch({
            raw: {},
            jobId: job.id,
            originalOrder: index,
            resumeSegments,
            jdSegments,
            fallbackCompany: info?.company,
            fallbackPosition: info?.position,
          }),
          error: error instanceof Error ? error.message : "分析失败",
        };
      }
    });

    const analyses = sortJobMatchesStable(outputs.map((item) => item.analysis));
    const errors = Object.fromEntries(
      outputs.filter((item) => item.error).map((item) => [item.analysis.jobId, item.error]),
    );
    return NextResponse.json({
      analyses,
      errors,
      weights: DEFAULT_MATCH_WEIGHTS,
      rubricVersion: "campus-match-v1",
      scoreLabel: "岗位要求覆盖分",
      disclaimer: "分数用于比较当前简历对JD要求的证据覆盖程度，不代表录用概率。",
      remaining: rl.remaining,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "岗位匹配分析失败" },
      { status: 500 },
    );
  }
}
