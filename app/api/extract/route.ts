import { NextRequest, NextResponse } from "next/server";
import { checkAccessCode, extractAccessCode, isAccessGateEnabled } from "@/lib/access";
import { checkRateLimitShared, getClientIp, rateLimitKeyForCode } from "@/lib/rate-limit";
import { getRateLimitPerHour, visionConfig } from "@/lib/ai-client";
import { isImageMime, parseResumeBuffer } from "@/lib/extract";
import { clipJd, clipResume } from "@/lib/clip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_RESUME_FILES = 5;
const MAX_JD_FILES = 12;

export type ExtractedDoc = { name: string; text: string };

function collectFiles(form: FormData, names: string[]): File[] {
  const out: File[] = [];
  for (const n of names) {
    for (const v of form.getAll(n)) {
      if (v instanceof File && v.size > 0) out.push(v);
    }
  }
  return out;
}

async function readImageDataUrl(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function ocrImageFile(file: File): Promise<string> {
  const { apiKey, baseUrl, model } = visionConfig();
  if (!apiKey) throw new Error(`图片 ${file.name} 识别需要配置 VISION_API_KEY`);
  const { visionOcrImage } = await import("@/lib/ai-client");
  try {
    return await visionOcrImage({
      baseUrl,
      apiKey,
      model,
      imageDataUrl: await readImageDataUrl(file),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "未知错误";
    if (msg.includes("Model does not exist") || msg.includes("20012")) {
      throw new Error(
        `视觉模型「${model}」不存在或已下线。请到硅基流动模型广场选择带「视觉」标签的模型，复制其完整 ID 填入 VISION_MODEL，推荐 Qwen/Qwen2.5-VL-72B-Instruct。`,
      );
    }
    throw e;
  }
}

async function parseDocFile(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = await parseResumeBuffer(buf, file.name, file.type);
  return parsed.text;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  // FormData 请求：口令从 header / query 取（multipart body 里不混入口令）
  const code = extractAccessCode(req);
  if (isAccessGateEnabled() && !checkAccessCode(code)) {
    return NextResponse.json({ error: "访问口令不正确，请输入有效口令后重试" }, { status: 401 });
  }
  const rl = await checkRateLimitShared(
    rateLimitKeyForCode("extract", code, ip),
    getRateLimitPerHour(),
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: `请求过于频繁，请 ${rl.retryAfterSec} 秒后重试` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求体必须是 multipart/form-data" }, { status: 400 });
  }

  // 兼容旧字段：resume / jd（单文件），新字段：resumes[] / jds[]（多文件，可重复 key）
  const resumeFiles = collectFiles(form, ["resume", "resumes", "resumes[]", "resumeFiles"]);
  const jdFiles = collectFiles(form, ["jd", "jds", "jds[]", "jdFiles"]);
  const jdTextRaw = form.get("jdText");

  if (resumeFiles.length > MAX_RESUME_FILES) {
    return NextResponse.json({ error: `简历文件过多（最多${MAX_RESUME_FILES}个）` }, { status: 400 });
  }
  if (jdFiles.length > MAX_JD_FILES) {
    return NextResponse.json({ error: `JD 文件过多（最多${MAX_JD_FILES}个）` }, { status: 400 });
  }
  for (const f of [...resumeFiles, ...jdFiles]) {
    if (f.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `文件 ${f.name} 过大（上限10MB）` }, { status: 400 });
    }
  }

  const warnings: string[] = [];
  const resumes: ExtractedDoc[] = [];
  const jds: ExtractedDoc[] = [];

  for (const f of resumeFiles) {
    try {
      const text = clipResume(await parseDocFile(f));
      if (!text.trim()) warnings.push(`简历 ${f.name} 未提取到文字`);
      resumes.push({ name: f.name, text });
    } catch (e) {
      return NextResponse.json(
        { error: `简历 ${f.name} 解析失败：${e instanceof Error ? e.message : "未知错误"}` },
        { status: 400 },
      );
    }
  }

  // 串行 OCR，避免视觉模型并发限流；文档解析可并行但文件数少，直接串行更稳
  for (const f of jdFiles) {
    try {
      const raw = isImageMime(f.type, f.name) ? await ocrImageFile(f) : await parseDocFile(f);
      const text = clipJd(raw.trim());
      if (!text.trim()) warnings.push(`JD ${f.name} 未提取到文字`);
      jds.push({ name: f.name, text });
    } catch (e) {
      return NextResponse.json(
        { error: `JD ${f.name} 解析失败：${e instanceof Error ? e.message : "未知错误"}` },
        { status: 400 },
      );
    }
  }

  const pastedJd = typeof jdTextRaw === "string" ? jdTextRaw.trim() : "";
  if (pastedJd) {
    jds.push({ name: "粘贴的JD文本", text: clipJd(pastedJd) });
  }

  if (resumes.some((r) => r.text.length > 7000)) {
    warnings.push("部分简历较长，已截断送入模型");
  }

  return NextResponse.json({
    // 新格式
    resumes,
    jds,
    warnings,
    remaining: rl.remaining,
    // 兼容旧前端：首份文档
    resumeText: resumes[0]?.text || "",
    jdText: jds.map((j) => `【${j.name}】\n${j.text}`).join("\n\n") || "",
  });
}
