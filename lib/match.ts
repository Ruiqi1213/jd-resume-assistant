import type { JdInfo } from "./llm";

export type RequirementImportance = "hard" | "core" | "bonus";
export type RequirementStatus = "met" | "partial" | "unmet" | "unknown";
export type MatchDimension =
  | "eligibility"
  | "product"
  | "ai"
  | "evaluation"
  | "delivery"
  | "design_domain";
export type GapType = "none" | "resume_optimization" | "capability_gap" | "needs_verification";
export type PriorityLevel = "top" | "recommended" | "verify" | "selective" | "low";

export type SourceSegment = {
  ref: string;
  text: string;
  kind?: "requirement" | "responsibility" | "keyword" | "raw";
};

export type RequirementMatch = {
  id: string;
  jdRef: string;
  requirement: string;
  importance: RequirementImportance;
  dimension: MatchDimension;
  status: RequirementStatus;
  evidenceRefs: string[];
  evidence: SourceSegment[];
  gapType: GapType;
  action: string;
};

export type MatchWeights = Record<RequirementImportance, number>;

export type MatchScore = {
  total: number;
  categoryCoverage: Record<RequirementImportance, number | null>;
  matched: number;
  partial: number;
  unmet: number;
  unknown: number;
  hardUnmet: number;
  hardPartial: number;
  hardUnknown: number;
};

export type MatchPriority = {
  level: PriorityLevel;
  label: string;
  reason: string;
};

export type JobMatchAnalysis = {
  jobId: string;
  company: string;
  position: string;
  summary: string;
  requirements: RequirementMatch[];
  score: MatchScore;
  priority: MatchPriority;
  originalOrder: number;
  rubricVersion: "campus-match-v1";
};

export type RawRequirementMatch = {
  jdRef?: unknown;
  requirement?: unknown;
  importance?: unknown;
  dimension?: unknown;
  status?: unknown;
  evidenceRefs?: unknown;
  gapType?: unknown;
  action?: unknown;
};

export type RawJobMatch = {
  company?: unknown;
  position?: unknown;
  summary?: unknown;
  requirements?: unknown;
};

export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  hard: 50,
  core: 35,
  bonus: 15,
};

const STATUS_VALUE: Record<RequirementStatus, number> = {
  met: 1,
  partial: 0.6,
  unknown: 0.25,
  unmet: 0,
};

const IMPORTANCES = new Set<RequirementImportance>(["hard", "core", "bonus"]);
const STATUSES = new Set<RequirementStatus>(["met", "partial", "unmet", "unknown"]);
const DIMENSIONS = new Set<MatchDimension>([
  "eligibility",
  "product",
  "ai",
  "evaluation",
  "delivery",
  "design_domain",
]);
const GAP_TYPES = new Set<GapType>([
  "none",
  "resume_optimization",
  "capability_gap",
  "needs_verification",
]);

function cleanText(value: unknown, max = 500): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function splitExact(text: string, maxChars: number): string[] {
  const normalized = text.replace(/\u0000/g, "").replace(/\r/g, "");
  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const line of lines) {
    if (line.length <= maxChars) {
      chunks.push(line);
      continue;
    }
    for (let i = 0; i < line.length; i += maxChars) {
      const chunk = line.slice(i, i + maxChars).trim();
      if (chunk) chunks.push(chunk);
    }
  }
  return chunks;
}

export function buildResumeSegments(text: string): SourceSegment[] {
  return splitExact(text, 220)
    .slice(0, 80)
    .map((segment, index) => ({ ref: `R${String(index + 1).padStart(3, "0")}`, text: segment }));
}

export function buildJdSegments(jd: JdInfo | null, raw: string): SourceSegment[] {
  const segments: Array<Omit<SourceSegment, "ref">> = [];
  if (jd) {
    for (const text of jd.requirements || []) {
      if (cleanText(text)) segments.push({ text: cleanText(text), kind: "requirement" });
    }
    for (const text of jd.responsibilities || []) {
      if (cleanText(text)) segments.push({ text: cleanText(text), kind: "responsibility" });
    }
    for (const text of jd.keywords || []) {
      if (cleanText(text)) segments.push({ text: cleanText(text), kind: "keyword" });
    }
  } else {
    for (const text of splitExact(raw, 220).slice(0, 60)) {
      segments.push({ text, kind: "raw" });
    }
  }
  return segments.map((segment, index) => ({
    ...segment,
    ref: `J${String(index + 1).padStart(3, "0")}`,
  }));
}

export function composeMatchPrompt(args: {
  resumeSegments: SourceSegment[];
  jdSegments: SourceSegment[];
  knownCompany?: string;
  knownPosition?: string;
}): string {
  const resume = args.resumeSegments.map((x) => `[${x.ref}] ${x.text}`).join("\n");
  const jd = args.jdSegments
    .map((x) => `[${x.ref}] [${x.kind || "raw"}] ${x.text}`)
    .join("\n");
  return [
    "你是2027届校园招聘岗位匹配分析器。请把目标岗位要求与候选人简历逐项对齐。",
    "岗位可能是 AI 产品经理、B端产品经理或相关产品岗位。统一关注：校招资格/学历专业/语言等硬条件，产品基本功，Agent/RAG/大模型等AI产品能力，评测与数据能力，跨团队落地与量化结果，以及设计研究或行业经验。",
    "只依据下方带编号的文本判断，不得补充常识或编造经历。证据只能填写真实存在的 R 编号。",
    "",
    `已知公司：${cleanText(args.knownCompany) || "未知"}`,
    `已知岗位：${cleanText(args.knownPosition) || "未知"}`,
    "",
    "【简历证据片段】",
    resume || "（无）",
    "",
    "【JD来源片段】",
    jd || "（无）",
    "",
    "【分类规则】",
    "1. importance：hard=JD明确写出的毕业时间、学历、专业、语言、资格证、地点/出勤等门槛；core=胜任岗位的核心职责能力；bonus=加分项或偏好。不得把普通职责误判为hard。",
    "2. status：met=证据直接满足；partial=相关但范围/年限/深度不足；unmet=简历证据明确不满足；unknown=简历没有足够信息，不能武断当作不满足。",
    "3. gapType：none=已满足；resume_optimization=经历可能具备但简历表达弱，可通过重写突出；capability_gap=需要补经历/技能；needs_verification=需要求职者核实或补充事实。",
    "4. dimension 只能取 eligibility/product/ai/evaluation/delivery/design_domain。",
    "5. 提取4-10项最影响投递决策的要求；JD中的全部hard要求必须列出。每项必须给jdRef。met/partial必须给至少一个evidenceRefs。",
    "6. action 给出一句可执行建议；不得建议伪造经历。summary 说明岗位最看重什么，50字以内。",
    "7. 不要输出分数、概率或投递优先级，程序会按固定规则计算。",
    "",
    "只输出合法 JSON：",
    '{"company":"","position":"","summary":"","requirements":[{"jdRef":"J001","requirement":"","importance":"hard|core|bonus","dimension":"eligibility|product|ai|evaluation|delivery|design_domain","status":"met|partial|unmet|unknown","evidenceRefs":["R001"],"gapType":"none|resume_optimization|capability_gap|needs_verification","action":""}]}'
  ].join("\n");
}

export function parseRawJobMatch(raw: string): RawJobMatch {
  try {
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as RawJobMatch;
  } catch {
    // The caller will turn malformed output into auditable unknown items.
  }
  return {};
}

function normalizeRequirement(
  raw: RawRequirementMatch,
  index: number,
  resumeByRef: Map<string, SourceSegment>,
  jdByRef: Map<string, SourceSegment>,
): RequirementMatch | null {
  const jdRef = cleanText(raw.jdRef, 12).toUpperCase();
  const source = jdByRef.get(jdRef);
  const requirement = source?.text || cleanText(raw.requirement);
  if (!requirement) return null;

  const importance = IMPORTANCES.has(raw.importance as RequirementImportance)
    ? (raw.importance as RequirementImportance)
    : "core";
  const dimension = DIMENSIONS.has(raw.dimension as MatchDimension)
    ? (raw.dimension as MatchDimension)
    : "product";
  let status = STATUSES.has(raw.status as RequirementStatus)
    ? (raw.status as RequirementStatus)
    : "unknown";
  const refs = Array.isArray(raw.evidenceRefs)
    ? raw.evidenceRefs
        .map((x) => cleanText(x, 12).toUpperCase())
        .filter((x, i, all) => resumeByRef.has(x) && all.indexOf(x) === i)
        .slice(0, 4)
    : [];
  const evidence = refs.map((ref) => resumeByRef.get(ref)).filter(Boolean) as SourceSegment[];

  let gapType = GAP_TYPES.has(raw.gapType as GapType) ? (raw.gapType as GapType) : "needs_verification";
  if ((status === "met" || status === "partial") && evidence.length === 0) {
    status = "unknown";
    gapType = "needs_verification";
  } else if (status === "met") {
    gapType = "none";
  } else if (status === "partial" && gapType === "none") {
    gapType = "resume_optimization";
  } else if (status === "unmet" && gapType === "none") {
    gapType = "capability_gap";
  } else if (status === "unknown") {
    gapType = "needs_verification";
  }

  return {
    id: `${jdRef || "REQ"}-${index + 1}`,
    jdRef,
    requirement,
    importance,
    dimension,
    status,
    evidenceRefs: refs,
    evidence,
    gapType,
    action: cleanText(raw.action) || "补充可核对的简历证据后重新分析。",
  };
}

export function normalizeJobMatch(args: {
  raw: RawJobMatch;
  jobId: string;
  originalOrder: number;
  resumeSegments: SourceSegment[];
  jdSegments: SourceSegment[];
  fallbackCompany?: string;
  fallbackPosition?: string;
  weights?: MatchWeights;
}): JobMatchAnalysis {
  const resumeByRef = new Map(args.resumeSegments.map((x) => [x.ref, x]));
  const jdByRef = new Map(args.jdSegments.map((x) => [x.ref, x]));
  const rawRequirements = Array.isArray(args.raw.requirements)
    ? (args.raw.requirements as RawRequirementMatch[])
    : [];
  const seen = new Set<string>();
  const requirements = rawRequirements
    .slice(0, 12)
    .map((item, index) => normalizeRequirement(item, index, resumeByRef, jdByRef))
    .filter((item): item is RequirementMatch => {
      if (!item) return false;
      const key = item.jdRef || item.requirement;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (requirements.length === 0) {
    for (const [index, segment] of args.jdSegments.slice(0, 6).entries()) {
      requirements.push({
        id: `${segment.ref}-${index + 1}`,
        jdRef: segment.ref,
        requirement: segment.text,
        importance: segment.kind === "requirement" ? "core" : "bonus",
        dimension: "product",
        status: "unknown",
        evidenceRefs: [],
        evidence: [],
        gapType: "needs_verification",
        action: "模型未返回可验证的匹配结论，请核实或重新分析。",
      });
    }
  }

  const score = scoreRequirementMatches(requirements, args.weights);
  return {
    jobId: args.jobId,
    company: cleanText(args.raw.company) || cleanText(args.fallbackCompany) || "未知公司",
    position: cleanText(args.raw.position) || cleanText(args.fallbackPosition) || "未知岗位",
    summary: cleanText(args.raw.summary) || "根据岗位要求与简历中的可核对证据进行逐项匹配。",
    requirements,
    score,
    priority: getMatchPriority(requirements, score.total),
    originalOrder: args.originalOrder,
    rubricVersion: "campus-match-v1",
  };
}

export function normalizeWeights(weights?: Partial<MatchWeights>): MatchWeights {
  const normalized = { ...DEFAULT_MATCH_WEIGHTS };
  for (const key of Object.keys(normalized) as RequirementImportance[]) {
    const value = Number(weights?.[key]);
    if (Number.isFinite(value) && value >= 0) normalized[key] = Math.min(100, Math.round(value));
  }
  if (normalized.hard + normalized.core + normalized.bonus === 0) return { ...DEFAULT_MATCH_WEIGHTS };
  return normalized;
}

export function scoreRequirementMatches(
  requirements: RequirementMatch[],
  inputWeights?: Partial<MatchWeights>,
): MatchScore {
  const weights = normalizeWeights(inputWeights);
  const categoryCoverage: MatchScore["categoryCoverage"] = { hard: null, core: null, bonus: null };
  let weightedTotal = 0;
  let activeWeight = 0;

  for (const importance of ["hard", "core", "bonus"] as RequirementImportance[]) {
    const items = requirements.filter((item) => item.importance === importance);
    if (!items.length) continue;
    const coverage = items.reduce((sum, item) => sum + STATUS_VALUE[item.status], 0) / items.length;
    categoryCoverage[importance] = Math.round(coverage * 100);
    weightedTotal += coverage * weights[importance];
    activeWeight += weights[importance];
  }

  const count = (status: RequirementStatus) => requirements.filter((x) => x.status === status).length;
  return {
    total: activeWeight ? Math.round((weightedTotal / activeWeight) * 100) : 0,
    categoryCoverage,
    matched: count("met"),
    partial: count("partial"),
    unmet: count("unmet"),
    unknown: count("unknown"),
    hardUnmet: requirements.filter((x) => x.importance === "hard" && x.status === "unmet").length,
    hardPartial: requirements.filter((x) => x.importance === "hard" && x.status === "partial").length,
    hardUnknown: requirements.filter((x) => x.importance === "hard" && x.status === "unknown").length,
  };
}

export function getMatchPriority(requirements: RequirementMatch[], score: number): MatchPriority {
  const hardUnmet = requirements.filter((x) => x.importance === "hard" && x.status === "unmet").length;
  const hardPartial = requirements.filter((x) => x.importance === "hard" && x.status === "partial").length;
  const hardUnknown = requirements.filter((x) => x.importance === "hard" && x.status === "unknown").length;
  if (hardUnmet > 0) {
    return { level: "low", label: "低优先", reason: `存在 ${hardUnmet} 项明确硬性缺口，建议先确认是否有替代条件。` };
  }
  if (hardUnknown > 0) {
    return { level: "verify", label: "核实后投递", reason: `有 ${hardUnknown} 项硬性条件在简历中没有足够证据。` };
  }
  if (hardPartial > 0) {
    return { level: "selective", label: "谨慎投递", reason: `有 ${hardPartial} 项硬性条件仅部分满足。` };
  }
  if (score >= 80) return { level: "top", label: "优先投递", reason: "核心要求覆盖较完整，且未发现硬性门槛缺口。" };
  if (score >= 65) return { level: "recommended", label: "建议投递", reason: "主要要求具备可核对证据，仍有少量表达或能力缺口。" };
  if (score >= 50) return { level: "selective", label: "选择性投递", reason: "岗位有一定相关性，建议先补强关键证据再投递。" };
  return { level: "low", label: "低优先", reason: "当前简历对核心要求的证据覆盖有限。" };
}

const PRIORITY_RANK: Record<PriorityLevel, number> = {
  top: 0,
  recommended: 1,
  verify: 2,
  selective: 3,
  low: 4,
};

export function recalculateJobMatch(
  analysis: JobMatchAnalysis,
  weights?: Partial<MatchWeights>,
): JobMatchAnalysis {
  const score = scoreRequirementMatches(analysis.requirements, weights);
  return { ...analysis, score, priority: getMatchPriority(analysis.requirements, score.total) };
}

export function sortJobMatchesStable(analyses: JobMatchAnalysis[]): JobMatchAnalysis[] {
  return analyses
    .map((analysis, stableIndex) => ({ analysis, stableIndex }))
    .sort((a, b) => {
      const priority = PRIORITY_RANK[a.analysis.priority.level] - PRIORITY_RANK[b.analysis.priority.level];
      if (priority !== 0) return priority;
      if (b.analysis.score.total !== a.analysis.score.total) return b.analysis.score.total - a.analysis.score.total;
      if (a.analysis.originalOrder !== b.analysis.originalOrder) return a.analysis.originalOrder - b.analysis.originalOrder;
      return a.stableIndex - b.stableIndex;
    })
    .map(({ analysis }) => analysis);
}
