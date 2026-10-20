import { describe, expect, it } from "vitest";
import {
  buildJdSegments,
  buildResumeSegments,
  getMatchPriority,
  normalizeJobMatch,
  recalculateJobMatch,
  scoreRequirementMatches,
  sortJobMatchesStable,
  type JobMatchAnalysis,
  type RequirementMatch,
} from "./match";

function requirement(
  importance: RequirementMatch["importance"],
  status: RequirementMatch["status"],
  id: string,
): RequirementMatch {
  return {
    id,
    jdRef: id,
    requirement: id,
    importance,
    dimension: "product",
    status,
    evidenceRefs: status === "met" || status === "partial" ? ["R001"] : [],
    evidence: status === "met" || status === "partial" ? [{ ref: "R001", text: "产品经历" }] : [],
    gapType: status === "met" ? "none" : "capability_gap",
    action: "补充证据",
  };
}

describe("campus match scoring", () => {
  it("uses the published category weights deterministically", () => {
    const items = [
      requirement("hard", "met", "J001"),
      requirement("core", "partial", "J002"),
      requirement("bonus", "unmet", "J003"),
    ];
    expect(scoreRequirementMatches(items).total).toBe(71);
    expect(scoreRequirementMatches(items, { hard: 80, core: 20, bonus: 0 }).total).toBe(92);
    expect(scoreRequirementMatches(items)).toEqual(scoreRequirementMatches(items));
  });

  it("keeps hard gates separate from the coverage score", () => {
    const items = [
      requirement("hard", "unknown", "J001"),
      requirement("core", "met", "J002"),
    ];
    const score = scoreRequirementMatches(items);
    expect(score.total).toBe(56);
    expect(getMatchPriority(items, score.total).label).toBe("核实后投递");
  });

  it("accepts only evidence references that exist in the resume", () => {
    const resumeSegments = buildResumeSegments("2024-2027 北京理工大学 设计学硕士\n负责Agent与RAG产品设计");
    const jdSegments = buildJdSegments(null, "2027届硕士毕业生\n熟悉Agent和RAG");
    const analysis = normalizeJobMatch({
      raw: {
        company: "示例公司",
        position: "AI产品经理",
        requirements: [
          {
            jdRef: "J001",
            importance: "hard",
            dimension: "eligibility",
            status: "met",
            evidenceRefs: ["R999"],
            gapType: "none",
            action: "补充毕业时间",
          },
          {
            jdRef: "J002",
            importance: "core",
            dimension: "ai",
            status: "met",
            evidenceRefs: ["R002"],
            gapType: "none",
            action: "突出Agent项目",
          },
        ],
      },
      jobId: "job-a",
      originalOrder: 0,
      resumeSegments,
      jdSegments,
    });
    expect(analysis.requirements[0].status).toBe("unknown");
    expect(analysis.requirements[0].evidence).toEqual([]);
    expect(analysis.requirements[1].status).toBe("met");
    expect(analysis.requirements[1].evidence[0].text).toContain("Agent");
  });

  it("sorts by priority and score without mutating the input order", () => {
    const make = (id: string, score: number, order: number): JobMatchAnalysis => {
      const requirements = [requirement("core", score >= 80 ? "met" : "partial", `J-${id}`)];
      const base: JobMatchAnalysis = {
        jobId: id,
        company: id,
        position: "产品经理",
        summary: "",
        requirements,
        score: scoreRequirementMatches(requirements),
        priority: getMatchPriority(requirements, score),
        originalOrder: order,
        rubricVersion: "campus-match-v1",
      };
      return { ...base, score: { ...base.score, total: score } };
    };
    const input = [make("b", 70, 1), make("a", 85, 0), make("c", 70, 2)];
    expect(sortJobMatchesStable(input).map((x) => x.jobId)).toEqual(["a", "b", "c"]);
    expect(input.map((x) => x.jobId)).toEqual(["b", "a", "c"]);
    expect(sortJobMatchesStable(input).map((x) => x.jobId)).toEqual(["a", "b", "c"]);
  });

  it("recalculates scores when weights change while preserving evidence", () => {
    const resumeSegments = buildResumeSegments("Agent RAG 产品评测");
    const jdSegments = buildJdSegments(null, "熟悉AI产品\n有产品经验");
    const analysis = normalizeJobMatch({
      raw: {
        requirements: [
          { jdRef: "J001", importance: "hard", dimension: "ai", status: "met", evidenceRefs: ["R001"] },
          { jdRef: "J002", importance: "core", dimension: "product", status: "partial", evidenceRefs: ["R001"] },
        ],
      },
      jobId: "job-a",
      originalOrder: 0,
      resumeSegments,
      jdSegments,
    });
    const updated = recalculateJobMatch(analysis, { hard: 90, core: 10, bonus: 0 });
    expect(updated.score.total).toBeGreaterThan(analysis.score.total);
    expect(updated.requirements[0].evidence).toEqual(analysis.requirements[0].evidence);
  });
});
