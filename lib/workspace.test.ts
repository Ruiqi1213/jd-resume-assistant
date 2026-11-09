import { describe, expect, it } from "vitest";
import { materialContext, restoreMaterials, splitJobs } from "./workspace";

describe("saved materials", () => {
  it("recovers safely from unavailable or malformed saved data", () => {
    expect(restoreMaterials("not json")).toEqual({ resumes: [], facts: [] });
    expect(restoreMaterials('{"resumes":[null,{"id":5}],"facts":{}}')).toEqual({
      resumes: [],
      facts: [],
    });
  });
  it("includes all resume versions within the model context and honors a selected version", () => {
    const data = {
      resumes: [
        { id: "a", name: "运营版", text: "运营".repeat(8000) },
        { id: "b", name: "产品版", text: "产品".repeat(8000) },
      ],
      facts: [{ id: "f", question: "做过什么", answer: "真实补充" }],
    };
    const all = materialContext(data);
    expect(all.length).toBeLessThan(8000);
    expect(all).toContain("运营版");
    expect(all).toContain("产品版");
    expect(all).toContain("真实补充");
    const selected = materialContext(data, "b");
    expect(selected).toContain("产品版");
    expect(selected).not.toContain("运营版");
  });
  it("does not split a single JD just because it contains paragraph breaks", () => {
    expect(splitJobs("工作职责\n\n负责数据分析\n\n任职要求")).toHaveLength(1);
    expect(splitJobs("岗位一\n---\n岗位二")).toHaveLength(2);
  });
});
