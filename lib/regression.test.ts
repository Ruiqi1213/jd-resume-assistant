import { afterEach, describe, expect, it } from "vitest";
import { checkAccessCode, extractAccessCode, isAccessGateEnabled } from "./access";
import { detectKind } from "./extract";
import { coerceJdInput, parseGenerateJson } from "./llm";

afterEach(() => {
  delete process.env.ACCESS_CODE;
});

describe("existing workflow regressions", () => {
  it("keeps the access gate behavior and header precedence", () => {
    process.env.ACCESS_CODE = "campus-2027";
    expect(isAccessGateEnabled()).toBe(true);
    expect(checkAccessCode("campus-2027")).toBe(true);
    expect(checkAccessCode("wrong")).toBe(false);
    const request = new Request("https://example.com/api/generate?code=query-code", {
      headers: { authorization: "Bearer header-code", "x-access-code": "secondary-code" },
    });
    expect(extractAccessCode(request, { accessCode: "body-code" })).toBe("header-code");
  });

  it("continues to recognize supported resume and JD file formats", () => {
    expect(detectKind("resume.pdf", "")).toBe("pdf");
    expect(detectKind("resume.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("docx");
    expect(detectKind("jd.md", "text/markdown")).toBe("txt");
    expect(detectKind("legacy.doc", "application/msword")).toBe("unknown");
  });

  it("keeps raw and structured JD inputs compatible with batch greeting generation", () => {
    const raw = coerceJdInput("负责企业知识库与RAG产品落地，要求三年以上产品经验");
    expect(raw.info).toBeNull();
    expect(raw.raw).toContain("RAG");
    const structured = coerceJdInput({
      company: "示例公司",
      position: "AI产品经理",
      location: "北京",
      salary: "",
      responsibilities: ["负责Agent产品"],
      requirements: ["熟悉RAG"],
      keywords: ["Agent", "RAG"],
    });
    expect(structured.info?.position).toBe("AI产品经理");
    const generated = parseGenerateJson('{"greeting":"你好","matchPoints":["RAG"],"suggestions":["突出项目"]}');
    expect(generated.greeting).toBe("你好");
  });
});
