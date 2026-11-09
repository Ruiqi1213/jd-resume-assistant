// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import Workspace from "./workspace";
import { MATERIALS_KEY } from "@/lib/workspace";

const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
let generationCount = 0;
const reply = (data: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
beforeEach(() => {
  localStorage.clear();
  requests.length = 0;
  generationCount = 0;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, options: RequestInit) => {
      const body =
        typeof options?.body === "string" ? JSON.parse(options.body) : {};
      requests.push({ url, body });
      if (url === "/api/verify") return reply({ ok: true, gate: false });
      if (url === "/api/parse")
        return reply({
          resumeProfile: {
            name: "测试用户",
            targetPosition: "运营",
            yearsExperience: "",
            skills: [],
            experiences: [],
            strengths: [],
          },
        });
      if (url === "/api/extract") {
        if ((options.body as FormData).has("resumes"))
          return reply({
            resumes: [{ name: "resume.txt", text: "做过运营与活动策划。" }],
            failures: [],
            warnings: [],
          });
        return reply({ error: "截图暂时不可读" }, 400);
      }
      if (url === "/api/generate") {
        generationCount++;
        return reply({
          result: {
            greeting: `第${generationCount}版：你好，我想了解这个岗位。`,
            matchPoints: [],
            suggestions: [],
            questions:
              generationCount === 1
                ? [
                    {
                      question: "做过社群拉新吗？",
                      reason: "岗位要求有拉新经验，简历尚未明确。",
                    },
                  ]
                : [],
          },
        });
      }
      return reply({ error: "Unexpected request" }, 500);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openWorkspace() {
  render(<Workspace />);
  return await screen.findByRole("textbox", { name: "岗位描述（JD）" });
}

describe("single-page work flow", () => {
  it("shows an inline missing-JD hint without opening preferences or the materials drawer", async () => {
    await openWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "生成打招呼语" }));
    expect(screen.getByRole("alert").textContent).toContain("请先粘贴岗位描述");
    expect(document.querySelector(".preferences")?.hasAttribute("open")).toBe(
      false,
    );
    expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(false);
    expect(
      requests.filter((request) => request.url === "/api/generate"),
    ).toHaveLength(0);
  });

  it("generates from pasted JD directly, with no resume, parsing, or focus prerequisite", async () => {
    const input = await openWorkspace();
    fireEvent.change(input, {
      target: { value: "用户增长运营，负责社群拉新、活动策划与数据分析。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成打招呼语" }));
    const greeting = await screen.findByRole("textbox", {
      name: "编辑打招呼语",
    });
    expect((greeting as HTMLTextAreaElement).value).toContain("第1版");
    expect(
      requests.find((request) => request.url === "/api/generate")?.body,
    ).toMatchObject({ mode: "greeting", resumeText: "" });
    expect(
      requests.some(
        (request) =>
          request.body.mode === "focus" || request.url === "/api/parse",
      ),
    ).toBe(false);
    expect(document.querySelector(".follow-up")?.hasAttribute("open")).toBe(
      false,
    );
  });

  it("saves several resume versions and restores them without a mandatory profile form", async () => {
    await openWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /我的资料/ }));
    expect(screen.getByRole("dialog").hasAttribute("open")).toBe(true);
    for (const [name, text] of [
      ["运营版", "我做过社群运营、活动策划。"],
      ["产品版", "我做过需求分析、用户调研。"],
    ]) {
      fireEvent.change(screen.getByLabelText("名称（可选）"), {
        target: { value: name },
      });
      fireEvent.change(
        screen.getByLabelText("简历原文", { selector: "textarea#resume-text" }),
        { target: { value: text } },
      );
      fireEvent.click(screen.getByRole("button", { name: "保存简历" }));
    }
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem(MATERIALS_KEY)!).resumes,
      ).toHaveLength(2),
    );
    cleanup();
    await openWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /我的资料/ }));
    expect(
      screen.getByText("运营版", { selector: ".saved-resume span" }),
    ).toBeTruthy();
    expect(
      screen.getByText("产品版", { selector: ".saved-resume span" }),
    ).toBeTruthy();
  });

  it("keeps optional answers out of saved facts until the user saves, then uses them to regenerate", async () => {
    const input = await openWorkspace();
    fireEvent.change(input, {
      target: { value: "用户增长运营，负责社群拉新、活动策划与数据分析。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成打招呼语" }));
    await screen.findByRole("textbox", { name: "编辑打招呼语" });
    fireEvent.click(screen.getByText("补充一点经历，让表达更具体"));
    fireEvent.change(screen.getByLabelText("做过社群拉新吗？"), {
      target: { value: "负责社群活动报名流程。" },
    });
    expect(JSON.parse(localStorage.getItem(MATERIALS_KEY)!).facts).toHaveLength(
      0,
    );
    fireEvent.click(screen.getByRole("button", { name: "保存并更新文案" }));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("textbox", {
            name: "编辑打招呼语",
          }) as HTMLTextAreaElement
        ).value,
      ).toContain("第2版"),
    );
    expect(
      JSON.parse(localStorage.getItem(MATERIALS_KEY)!).facts[0].answer,
    ).toBe("负责社群活动报名流程。");
    expect(
      requests.filter((request) => request.url === "/api/generate").at(-1)?.body
        .resumeText,
    ).toContain("负责社群活动报名流程。");
  });

  it("can skip a question without claiming the user has no experience", async () => {
    const input = await openWorkspace();
    fireEvent.change(input, {
      target: { value: "用户增长运营，负责社群拉新、活动策划与数据分析。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成打招呼语" }));
    await screen.findByRole("textbox", { name: "编辑打招呼语" });
    fireEvent.click(screen.getByText("补充一点经历，让表达更具体"));
    fireEvent.click(screen.getByRole("button", { name: "暂时跳过" }));
    expect(document.querySelector(".follow-up")).toBeNull();
    expect(JSON.parse(localStorage.getItem(MATERIALS_KEY)!).facts).toHaveLength(
      0,
    );
    expect(generationCount).toBe(1);
  });

  it("automatically reads uploaded resumes without requiring a separate parse action", async () => {
    await openWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /我的资料/ }));
    fireEvent.change(
      document.querySelector('input[accept=".pdf,.docx,.txt,.md"]')!,
      {
        target: {
          files: [new File(["resume"], "resume.txt", { type: "text/plain" })],
        },
      },
    );
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem(MATERIALS_KEY)!).resumes,
      ).toHaveLength(1),
    );
    expect(screen.queryByRole("button", { name: "读取 1 份简历" })).toBeNull();
  });

  it("keeps a failed attachment available while generating a usable pasted JD", async () => {
    const input = await openWorkspace();
    fireEvent.change(input, {
      target: { value: "用户增长运营，负责社群拉新、活动策划与数据分析。" },
    });
    fireEvent.change(document.querySelector('input[accept*=".png"]')!, {
      target: {
        files: [new File(["image"], "job.png", { type: "image/png" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成打招呼语" }));
    await screen.findByRole("textbox", { name: "编辑打招呼语" });
    expect(screen.getByRole("button", { name: "移除 job.png" })).toBeTruthy();
    expect(screen.getAllByRole("status")[0].textContent).toContain(
      "将继续处理已有文字岗位",
    );
  });
});

it("opens directly, keeps optional settings before generate, and attaches JD without a drawer", async () => {
  await openWorkspace();
  expect(requests.some(r => r.url === "/api/verify")).toBe(false);
  expect(screen.queryByLabelText("访问口令")).toBeNull();
  const generate = screen.getByRole("button", { name: "生成打招呼语" });
  expect(document.querySelector(".preferences")!.compareDocumentPosition(generate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const fileInput = document.querySelector<HTMLInputElement>('input[accept*=".png"]')!;
  const picker = vi.spyOn(fileInput, "click");
  fireEvent.click(screen.getByRole("button", { name: "添加岗位截图 / 文件" }));
  expect(picker).toHaveBeenCalledOnce();
  expect(document.querySelector("dialog")!.open).toBe(false);
  fireEvent.click(screen.getByText("粘贴简历文字（可选）"));
  fireEvent.change(screen.getByLabelText("简历文字"), {target:{value:"负责产品运营及社群活动。"}});
  fireEvent.click(screen.getByRole("button", {name:"保存简历文字"}));
  expect(document.querySelector("dialog")!.open).toBe(false);
  expect(JSON.parse(localStorage.getItem(MATERIALS_KEY)!).resumes[0].text).toContain("产品运营");
});

