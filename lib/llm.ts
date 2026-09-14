export type JdInfo = {
  company: string;
  position: string;
  location: string;
  salary: string;
  responsibilities: string[];
  requirements: string[];
  keywords: string[];
};

export type ResumeProfile = {
  name: string;
  targetPosition: string;
  yearsExperience: string;
  skills: string[];
  experiences: Array<{ company: string; role: string; highlights: string[] }>;
  strengths: string[];
};

export type GreetingTone = "sincere" | "professional" | "lively";

const TONE_LABEL: Record<GreetingTone, string> = {
  sincere: "真诚内敛",
  professional: "专业干练",
  lively: "活泼热情",
};

function list(items: string[] | undefined, fallback: string): string {
  if (!items || items.length === 0) return fallback;
  return items.map((x) => `- ${x}`).join("\n");
}

export function composeExtractPrompt(kind: "resume" | "jdImage", content: string): string {
  if (kind === "resume") {
    return [
      "你是资深招聘顾问。请从下面的简历文本中结构化提取候选人画像。",
      "只输出 JSON，不要输出 markdown 代码块之外的解释。JSON 结构如下：",
      '{"name":"","targetPosition":"","yearsExperience":"","skills":[],"experiences":[{"company":"","role":"","highlights":[]}],"strengths":[]}',
      "要求：skills 不超过12个；experiences 最多取最近4段；highlights 保留量化成果。",
      "简历文本：",
      content,
    ].join("\n");
  }
  return [
    "你是资深招聘顾问。请从下面的 JD 文本（可能来自截图 OCR）中结构化提取职位信息。",
    "只输出 JSON，结构如下：",
    '{"company":"","position":"","location":"","salary":"","responsibilities":[],"requirements":[],"keywords":[]}',
    "要求：responsibilities/requirements 各不超过8条；keywords 提取8-15个核心技能词。",
    "JD 文本：",
    content,
  ].join("\n");
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    const cleaned = raw
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

export function parseJdJson(raw: string): JdInfo {
  return safeJsonParse<JdInfo>(raw, {
    company: "",
    position: "",
    location: "",
    salary: "",
    responsibilities: [],
    requirements: [],
    keywords: [],
  });
}

export function parseResumeJson(raw: string): ResumeProfile {
  return safeJsonParse<ResumeProfile>(raw, {
    name: "",
    targetPosition: "",
    yearsExperience: "",
    skills: [],
    experiences: [],
    strengths: [],
  });
}

export function composeGeneratePrompt(args: {
  resume: string;
  jd: JdInfo;
  supplement: string;
  tone: GreetingTone;
  extraFocus: string;
}): string {
  return composeGeneratePromptFlexible({ ...args, jdRaw: "" });
}

export function composeGeneratePromptFlexible(args: {
  resume: string;
  jd: JdInfo | null;
  jdRaw: string;
  supplement: string;
  tone: GreetingTone;
  extraFocus: string;
}): string {
  const { resume, jd, jdRaw, supplement, tone, extraFocus } = args;
  const jdSection = jd
    ? [
        "【目标 JD 结构化信息】",
        `公司：${jd.company || "未知"}`,
        `岗位：${jd.position || "未知"}`,
        `地点/薪资：${[jd.location, jd.salary].filter(Boolean).join(" · ") || "未知"}`,
        `核心职责：\n${list(jd.responsibilities, "- （未提取到）")}`,
        `任职要求：\n${list(jd.requirements, "- （未提取到）")}`,
        `关键词：${jd.keywords?.join("、") || "（无）"}`,
      ].join("\n")
    : `【目标 JD 原文（未经结构化，请直接依据原文匹配）】\n${jdRaw.slice(0, 5000)}`;
  return [
    "你是求职打招呼文案专家。请根据候选人简历与目标 JD，写一封 Boss直聘风格的打招呼私信。",
    "",
    `【求职者简历（已脱敏/截断）】\n${resume}`,
    "",
    jdSection,
    "",
    `【补充说明】\n${supplement || "（无）"}`,
    `【侧重点补充】\n${extraFocus || "（无）"}`,
    "",
    "【写作要求】",
    `1. 语气：${TONE_LABEL[tone]}，第一人称，真诚具体，不卑不亢。`,
    "2. 结构：称呼 + 2-3句匹配度论证（引用简历事实对齐 JD 关键词）+ 1句表达意愿 + 1句收尾提问或约面。",
    "3. 300-450字，口语化但专业，禁用空话套话，禁用emoji。",
    "4. 不要编造简历中没有的经历；不确定的信息用谨慎表述。",
    "5. 输出 JSON：{\"greeting\":\"...\",\"matchPoints\":[\"...\",\"...\",\"...\"],\"suggestions\":[\"...\",\"...\"]}",
    "   其中 matchPoints 为3条匹配点（每条20-40字），suggestions 为2条投递/沟通建议。",
  ].join("\n");
}

/** 将 generate 接口收到的 jd 字段归一化：结构化对象优先，否则视为原文 */
export function coerceJdInput(input: unknown): { info: JdInfo | null; raw: string } {
  if (typeof input === "string") {
    const t = input.trim();
    if (!t) return { info: null, raw: "" };
    const parsed = parseJdJson(t);
    if (
      parsed.position ||
      parsed.company ||
      (parsed.responsibilities?.length ?? 0) > 0 ||
      (parsed.requirements?.length ?? 0) > 0 ||
      (parsed.keywords?.length ?? 0) > 0
    ) {
      return { info: parsed, raw: "" };
    }
    return { info: null, raw: t };
  }
  if (input && typeof input === "object") {
    const o = input as Partial<JdInfo>;
    if (
      o.position ||
      o.company ||
      (o.responsibilities?.length ?? 0) > 0 ||
      (o.requirements?.length ?? 0) > 0 ||
      (o.keywords?.length ?? 0) > 0
    ) {
      return { info: input as JdInfo, raw: "" };
    }
  }
  return { info: null, raw: "" };
}

export function hasJdContent(input: unknown): boolean {
  const { info, raw } = coerceJdInput(input);
  if (info) return true;
  return raw.replace(/\s/g, "").length >= 10;
}

export type GenerateResult = {
  greeting: string;
  matchPoints: string[];
  suggestions: string[];
};

export function parseGenerateJson(raw: string): GenerateResult {
  return safeJsonParse<GenerateResult>(raw, {
    greeting: raw.slice(0, 2000),
    matchPoints: [],
    suggestions: [],
  });
}

export function composeFocusPrompt(args: {
  jd: JdInfo;
  resume: string;
  direction: string;
}): string {
  return composeFocusPromptFlexible({ jd: args.jd, jdRaw: "", resume: args.resume, direction: args.direction });
}

export function composeFocusPromptFlexible(args: {
  jd: JdInfo | null;
  jdRaw: string;
  resume: string;
  direction: string;
}): string {
  const jdLine = args.jd
    ? `岗位：${args.jd.position || "未知"} / 公司：${args.jd.company || "未知"}\nJD关键词：${args.jd.keywords?.join("、") || "无"}`
    : `JD原文（未经结构化）：\n${args.jdRaw.slice(0, 2500)}`;
  return [
    "你是求职策略顾问。基于 JD 与简历，生成 3 个差异化的打招呼侧重点选项。",
    `方向偏好：${args.direction || "通用"}`,
    "",
    jdLine,
    `简历摘要：\n${args.resume.slice(0, 2000)}`,
    "",
    "输出 JSON：{\"options\":[{\"id\":\"a\",\"title\":\"...\",\"angle\":\"...\",\"why\":\"...\"},{\"id\":\"b\",...},{\"id\":\"c\",...}]}",
    "要求：每个 angle 40-70字说明切入角度；why 20-40字说明为什么有效。",
  ].join("\n");
}

export type FocusOption = { id: string; title: string; angle: string; why: string };

export function parseFocusJson(raw: string): FocusOption[] {
  const parsed = safeJsonParse<{ options: FocusOption[] }>(raw, { options: [] });
  return Array.isArray(parsed.options) ? parsed.options.slice(0, 3) : [];
}
