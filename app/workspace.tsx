"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  FocusOption,
  GenerateResult,
  GreetingTone,
  ResumeProfile,
} from "@/lib/llm";
import { parseResumeJson } from "@/lib/llm";
import {
  jobTitle,
  materialContext,
  MATERIALS_KEY,
  restoreMaterials,
  splitJobs,
  type DocumentItem,
  type Materials,
} from "@/lib/workspace";

type Job = DocumentItem & {
  selected: boolean;
  result?: GenerateResult;
  error?: string;
  skipped: string[];
};
type Notice = { kind: "ok" | "warn" | "error"; text: string };
type ProfileState = { source: string; data: ResumeProfile };
const CODE_KEY = "jd-assistant-access-code";
const uid = () => crypto.randomUUID();
const tones: Array<[GreetingTone, string]> = [
  ["sincere", "真诚自然"],
  ["professional", "专业直接"],
  ["lively", "轻松热情"],
];

function Icon({
  name,
  size = 20,
}: {
  name: "plus" | "clip" | "arrow" | "copy" | "close" | "folder" | "spark";
  size?: number;
}) {
  const paths = {
    plus: "M12 5v14M5 12h14",
    clip: "m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7L13 2",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    copy: "M9 9h11v11H9zM15 5V2H2v13h3",
    close: "m6 6 12 12M6 18 18 6",
    folder: "M3 7V4h6l3 3h9v13H3z",
    spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export default function Workspace() {
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);
  const [accessCode, setAccessCode] = useState("");
  const [codeDraft, setCodeDraft] = useState("");
  const [gateError, setGateError] = useState("");
  const [materials, setMaterials] = useState<Materials>({
    resumes: [],
    facts: [],
  });
  const [restored, setRestored] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [profileStatus, setProfileStatus] = useState("");
  const [profileRetry, setProfileRetry] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [resumeDraft, setResumeDraft] = useState("");
  const [resumeName, setResumeName] = useState("");
  const [resumeFiles, setResumeFiles] = useState<File[]>([]);
  const [jdDraft, setJdDraft] = useState("");
  const [jdFiles, setJdFiles] = useState<File[]>([]);
  const [jdError, setJdError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tone, setTone] = useState<GreetingTone>("sincere");
  const [selectedResume, setSelectedResume] = useState("");
  const [supplement, setSupplement] = useState("");
  const [extraFocus, setExtraFocus] = useState("");
  const [focusOptions, setFocusOptions] = useState<FocusOption[]>([]);
  const [focusSource, setFocusSource] = useState("");
  const [selectedFocus, setSelectedFocus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [copied, setCopied] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revisions, setRevisions] = useState<Record<string, string>>({});
  const dialogRef = useRef<HTMLDialogElement>(null);
  const jdRef = useRef<HTMLTextAreaElement>(null);
  const jdFileRef = useRef<HTMLInputElement>(null);
  const resumeFileRef = useRef<HTMLInputElement>(null);
  const profileSource = useMemo(() => materialContext(materials), [materials]);
  const generatingContext = useMemo(
    () => materialContext(materials, selectedResume),
    [materials, selectedResume],
  );
  const currentProfile =
    profile?.source === profileSource ? profile.data : null;
  const resultCount = jobs.filter((job) => job.result).length;
  const selectedCount = jobs.filter((job) => job.selected).length;
  const isBusy = busy !== null;

  useEffect(() => {
    let saved = "";
    try {
      saved = localStorage.getItem(CODE_KEY) || "";
    } catch {
      /* private browsing */
    }
    const abort = new AbortController();
    fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessCode: saved }),
      signal: abort.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok && data.ok) {
          setAccessCode(saved);
          setUnlocked(true);
        }
      })
      .catch((error) => {
        if (error.name !== "AbortError")
          setGateError("暂时无法连接服务，请输入口令重试。");
      })
      .finally(() => {
        if (!abort.signal.aborted) setChecking(false);
      });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    try {
      setMaterials(restoreMaterials(localStorage.getItem(MATERIALS_KEY)));
      const saved = JSON.parse(
        localStorage.getItem(`${MATERIALS_KEY}-profile`) || "null",
      );
      if (saved && typeof saved.source === "string" && saved.data)
        setProfile({
          source: saved.source,
          data: parseResumeJson(JSON.stringify(saved.data)),
        });
    } catch {
      setStorageError("浏览器存储不可用，本次资料仅在当前页面保留。");
    }
    setRestored(true);
  }, [unlocked]);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(MATERIALS_KEY, JSON.stringify(materials));
      if (profile?.source === profileSource)
        localStorage.setItem(
          `${MATERIALS_KEY}-profile`,
          JSON.stringify(profile),
        );
      else localStorage.removeItem(`${MATERIALS_KEY}-profile`);
      setStorageError("");
    } catch {
      setStorageError(
        "资料未能保存到浏览器，请保留原始简历。当前页面仍可使用。",
      );
    }
  }, [materials, profile, profileSource, restored]);

  useEffect(() => {
    if (
      !restored ||
      !unlocked ||
      !profileSource ||
      profile?.source === profileSource
    )
      return;
    const abort = new AbortController();
    setProfileStatus("正在自动整理资料…");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/parse", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-access-code": accessCode,
          },
          body: JSON.stringify({ resumeText: profileSource }),
          signal: abort.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "整理失败");
        if (abort.signal.aborted) return;
        if (!data.resumeProfile) throw new Error("未返回档案内容");
        setProfile({ source: profileSource, data: data.resumeProfile });
        setProfileStatus("");
        if (typeof data.remaining === "number") setRemaining(data.remaining);
      } catch (error) {
        if (!abort.signal.aborted)
          setProfileStatus(
            `自动整理暂不可用，仍会参考简历原文。${error instanceof Error ? error.message : "请稍后重试"}`,
          );
      }
    }, 1000);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [
    restored,
    unlocked,
    accessCode,
    profileSource,
    profile?.source,
    profileRetry,
  ]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (drawerOpen && !dialog.open) dialog.showModal();
    if (!drawerOpen && dialog.open) dialog.close();
  }, [drawerOpen]);

  useEffect(() => {
    setSelectedFocus("");
    setFocusOptions([]);
    setFocusSource("");
  }, [generatingContext, jdDraft]);

  async function request(
    path: string,
    body: FormData | Record<string, unknown>,
  ) {
    const form = body instanceof FormData;
    const res = await fetch(path, {
      method: "POST",
      headers: {
        "x-access-code": accessCode,
        ...(!form ? { "Content-Type": "application/json" } : {}),
      },
      body: form ? body : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (typeof data.remaining === "number") setRemaining(data.remaining);
    if (!res.ok)
      throw new Error(data.error || `请求失败（${res.status}），请稍后重试。`);
    return data;
  }

  async function unlock() {
    setChecking(true);
    setGateError("");
    try {
      const data = await request("/api/verify", {
        accessCode: codeDraft.trim(),
      });
      if (!data.ok) throw new Error("口令不正确");
      setAccessCode(codeDraft.trim());
      setUnlocked(true);
      try {
        localStorage.setItem(CODE_KEY, codeDraft.trim());
      } catch {
        /* session still works */
      }
    } catch (error) {
      setGateError(error instanceof Error ? error.message : "无法进入");
    } finally {
      setChecking(false);
    }
  }

  function addFiles(slot: "jd" | "resume", files: File[]) {
    if (isBusy) return;
    const existing = slot === "jd" ? jdFiles : resumeFiles;
    const max = slot === "jd" ? 12 : 5;
    const extension =
      slot === "jd"
        ? /\.(pdf|docx|txt|md|png|jpe?g|webp)$/i
        : /\.(pdf|docx|txt|md)$/i;
    const accepted = files.filter(
      (file) =>
        extension.test(file.name) &&
        file.size > 0 &&
        file.size <= 10 * 1024 * 1024,
    );
    const merged = [...existing];
    for (const file of accepted)
      if (
        !merged.some(
          (x) =>
            x.name === file.name &&
            x.size === file.size &&
            x.lastModified === file.lastModified,
        )
      )
        merged.push(file);
    if (accepted.length < files.length || merged.length > max)
      setNotice({
        kind: "warn",
        text: `部分文件未添加：请使用支持的格式、单文件不超过 10MB，每批最多 ${max} 个。`,
      });
    if (slot === "jd") {
      setJdFiles(merged.slice(0, max));
      setJdError("");
    } else {
      const batch = merged.slice(0, max);
      setResumeFiles(batch);
      if (batch.length) void importResumes(batch);
    }
  }

  async function extract(
    slot: "jd" | "resume",
    files = slot === "jd" ? jdFiles : resumeFiles,
  ): Promise<DocumentItem[]> {
    if (!files.length) return [];
    const body = new FormData();
    files.forEach((file) =>
      body.append(slot === "jd" ? "jds" : "resumes", file),
    );
    const data = await request("/api/extract", body);
    const failed = new Set<number>(
      (data.failures || [])
        .filter((f: { slot: string }) => f.slot === slot)
        .map((f: { index: number }) => f.index),
    );
    const imported = new Set(files.filter((_, index) => !failed.has(index)));
    if (slot === "jd")
      setJdFiles((prev) => prev.filter((file) => !imported.has(file)));
    else setResumeFiles((prev) => prev.filter((file) => !imported.has(file)));
    if (data.warnings?.length)
      setNotice({ kind: "warn", text: data.warnings.join("；") });
    return (slot === "jd" ? data.jds : data.resumes)
      .filter((doc: { text: string }) => doc.text?.trim())
      .map((doc: { name: string; text: string }) => ({ ...doc, id: uid() }));
  }

  function saveResumes(docs: DocumentItem[]) {
    if (materials.resumes.length + docs.length > 20)
      setNotice({
        kind: "warn",
        text: "简历库最多保存 20 份，超出部分未保存，请先删除不需要的版本。",
      });
    setMaterials((prev) => ({
      ...prev,
      resumes: [
        ...prev.resumes,
        ...docs.filter(
          (doc) => !prev.resumes.some((x) => x.text.trim() === doc.text.trim()),
        ),
      ].slice(0, 20),
    }));
  }

  async function importResumes(files = resumeFiles) {
    setBusy("resume");
    setNotice(null);
    try {
      saveResumes(await extract("resume", files));
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "简历导入失败",
      });
    } finally {
      setBusy(null);
    }
  }

  function saveResumeText() {
    if (!resumeDraft.trim()) return;
    saveResumes([
      {
        id: uid(),
        name: resumeName.trim() || `文字简历 ${materials.resumes.length + 1}`,
        text: resumeDraft.trim(),
      },
    ]);
    setResumeDraft("");
    setResumeName("");
  }

  async function generateOne(
    job: Job,
    instruction = "",
    context = generatingContext,
  ) {
    setJobs((prev) =>
      prev.map((x) => (x.id === job.id ? { ...x, error: undefined } : x)),
    );
    const chosen =
      focusSource === job.text
        ? focusOptions.find((x) => x.id === selectedFocus)
        : undefined;
    try {
      const data = await request("/api/generate", {
        mode: "greeting",
        resumeText: context,
        jd: job.text,
        tone,
        supplement,
        extraFocus: [
          extraFocus,
          chosen && `可选侧重点：${chosen.title} ${chosen.angle}`,
          instruction,
          job.skipped.length &&
            `这些问题已跳过，不再追问，也不要据此认定没有经验：${job.skipped.join("；")}`,
        ]
          .filter(Boolean)
          .join("\n"),
      });
      setJobs((prev) =>
        prev.map((x) =>
          x.id === job.id ? { ...x, result: data.result, error: undefined } : x,
        ),
      );
    } catch (error) {
      setJobs((prev) =>
        prev.map((x) =>
          x.id === job.id
            ? {
                ...x,
                error:
                  error instanceof Error ? error.message : "生成失败，请重试",
              }
            : x,
        ),
      );
    }
  }

  async function generate() {
    if (!jdDraft.trim() && !jdFiles.length && !selectedCount) {
      setJdError(
        jobs.length
          ? "请勾选一个岗位，或添加新的 JD。"
          : "请先粘贴岗位描述，或添加岗位截图。",
      );
      jdRef.current?.focus();
      return;
    }
    const texts = splitJobs(jdDraft);
    if (texts.some((text) => text.replace(/\s/g, "").length < 10)) {
      setJdError("岗位描述有点短，请补充职责或任职要求。");
      jdRef.current?.focus();
      return;
    }
    setJdError("");
    setNotice(null);
    setBusy("generate");
    try {
      let imported: DocumentItem[] = [];
      try {
        imported = await extract("jd");
      } catch (error) {
        if (!texts.length && !selectedCount) throw error;
        setNotice({
          kind: "warn",
          text: `${error instanceof Error ? error.message : "附件读取失败"}。将继续处理已有文字岗位。`,
        });
      }
      const added: Job[] = [
        ...imported,
        ...texts.map((text) => ({ id: uid(), name: jobTitle(text), text })),
      ].map((doc) => ({ ...doc, selected: true, skipped: [] }));
      const all = [...jobs, ...added];
      setJobs(all);
      setJdDraft("");
      // New submissions generate only new jobs. With no new input, regenerate
      // selected jobs; unrelated results remain intact.
      const targets = added.length ? added : all.filter((job) => job.selected);
      for (let i = 0; i < targets.length; i++) {
        setBusy(`生成 ${i + 1}/${targets.length}`);
        await generateOne(targets[i]);
      }
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "读取失败，请重试",
      });
    } finally {
      setBusy(null);
    }
  }

  async function rewrite(job: Job, instruction: string) {
    setBusy(job.id);
    await generateOne(job, instruction);
    setBusy(null);
  }

  async function saveAnswer(job: Job, question: string, answer: string) {
    if (!answer.trim()) return;
    const next: Materials = {
      ...materials,
      facts: [
        ...materials.facts.filter((fact) => fact.question !== question),
        { id: uid(), question, answer: answer.trim() },
      ].slice(-60),
    };
    setMaterials(next);
    setAnswers((prev) => ({ ...prev, [`${job.id}:${question}`]: "" }));
    setBusy(job.id);
    await generateOne(
      job,
      "根据新增的已确认经历调整，仍保持简短。",
      materialContext(next, selectedResume),
    );
    setBusy(null);
  }

  async function suggestFocus() {
    const target = jdDraft.trim() || jobs.find((job) => job.selected)?.text;
    if (!target || !generatingContext) {
      setNotice({
        kind: "warn",
        text: "侧重点建议需要简历和 JD；你也可以直接生成打招呼语。",
      });
      return;
    }
    setBusy("focus");
    try {
      const data = await request("/api/generate", {
        mode: "focus",
        resumeText: generatingContext,
        jd: target,
        direction: extraFocus,
      });
      setFocusOptions(data.options || []);
      setFocusSource(target);
      setSelectedFocus("");
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "暂时无法生成建议",
      });
    } finally {
      setBusy(null);
    }
  }

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((value) => (value === id ? "" : value)), 1800);
    } catch {
      setNotice({
        kind: "warn",
        text: "浏览器未允许复制，请直接选中文字复制。",
      });
    }
  }

  function fileChips(files: File[], slot: "jd" | "resume") {
    return (
      files.length > 0 && (
        <ul
          className="file-chips"
          aria-label={slot === "jd" ? "待读取岗位附件" : "待读取简历附件"}
        >
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <Icon name="clip" size={15} />
              <span title={file.name}>{file.name}</span>
              <button
                type="button"
                className="icon-button"
                disabled={isBusy}
                aria-label={`移除 ${file.name}`}
                onClick={() =>
                  slot === "jd"
                    ? setJdFiles((prev) => prev.filter((_, i) => i !== index))
                    : setResumeFiles((prev) =>
                        prev.filter((_, i) => i !== index),
                      )
                }
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )
    );
  }

  if (!unlocked)
    return (
      <div className="gate-shell">
        <div className="brand">
          <span className="brand-mark">招</span>
          <strong>JD × 简历</strong>
        </div>
        <section className="gate-card">
          <h1>打招呼助手</h1>
          <p>把你的经历，写成一句合适的开场白。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
          >
            <label htmlFor="access-code">访问口令</label>
            <input
              id="access-code"
              type="password"
              value={codeDraft}
              onChange={(e) => setCodeDraft(e.target.value)}
              autoComplete="current-password"
              placeholder="输入原访问口令"
            />
            <button className="primary-button" disabled={checking}>
              {checking ? "正在连接…" : "进入工作区"}
              <Icon name="arrow" />
            </button>
          </form>
          {gateError && (
            <p role="alert" className="error-text">
              {gateError}
            </p>
          )}
        </section>
      </div>
    );

  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          <a className="brand" href="/" aria-label="打招呼助手首页">
            <span className="brand-mark">招</span>
            <strong>
              JD × 简历<span className="brand-description">打招呼助手</span>
            </strong>
          </a>
          <button
            className="materials-button"
            onClick={() => setDrawerOpen(true)}
          >
            <Icon name="folder" />
            <span>我的资料</span>
            <span className="count-badge">{materials.resumes.length}</span>
          </button>
        </div>
      </header>
      <main className="workspace">
        <div className="intro">
          <span className="eyebrow">从一个感兴趣的岗位开始</span>
          <h1>你想投递什么岗位？</h1>
          <p>把 JD 放进来，让开场白更贴合你和这个机会。</p>
        </div>
        {!profileSource && (
          <div className="resume-invite">
            <div>
              <Icon name="folder" />
              <span>
                添加简历，让表达更贴合你
                <span className="invite-detail"> · 可一次上传多份</span>
              </span>
            </div>
            <button className="text-button" onClick={() => setDrawerOpen(true)}>
              添加简历 <Icon name="plus" size={16} />
            </button>
          </div>
        )}
        <section
          className={`composer ${dragging ? "dragging" : ""} ${jdError ? "invalid" : ""}`}
          aria-label="岗位输入"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles("jd", Array.from(e.dataTransfer.files));
          }}
        >
          <label className="sr-only" htmlFor="jd-input">
            岗位描述（JD）
          </label>
          <textarea
            ref={jdRef}
            id="jd-input"
            className="jd-input"
            value={jdDraft}
            disabled={isBusy}
            onChange={(e) => {
              setJdDraft(e.target.value);
              setJdError("");
            }}
            placeholder={
              "粘贴 JD 原文，也可以直接粘贴截图或拖入文件…\n\n例如：岗位名称、工作职责、任职要求"
            }
            aria-invalid={!!jdError}
            aria-describedby={jdError ? "jd-error" : "jd-help"}
            onPaste={(e) => {
              const images = Array.from(e.clipboardData.files).filter((file) =>
                file.type.startsWith("image/"),
              );
              if (images.length) {
                e.preventDefault();
                addFiles("jd", images);
              }
            }}
          />
          {fileChips(jdFiles, "jd")}
          <div className="composer-toolbar">
            <div className="attachment-actions">
              <button
                className="attachment-button"
                disabled={isBusy}
                onClick={() => jdFileRef.current?.click()}
              >
                <Icon name="clip" size={18} />
                添加附件
              </button>
              <span id="jd-help" className="input-hint">
                多岗位可用 --- 分隔
              </span>
              <input
                ref={jdFileRef}
                type="file"
                hidden
                multiple
                accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp"
                onChange={(e) => {
                  addFiles("jd", Array.from(e.target.files || []));
                  e.target.value = "";
                }}
              />
            </div>
            <button
              className="primary-button"
              disabled={isBusy}
              onClick={() => void generate()}
            >
              {isBusy ? (
                <span className="spinner" />
              ) : (
                <Icon name="spark" size={18} />
              )}
              {isBusy
                ? busy?.startsWith("生成")
                  ? busy
                  : "处理中…"
                : "生成打招呼语"}
            </button>
          </div>
        </section>
        {jdError && (
          <p className="error-text inline-error" id="jd-error" role="alert">
            {jdError}
          </p>
        )}
        <div className="under-composer">
          <span>
            {profileSource
              ? `参考${selectedResume ? "指定简历" : "已有资料"} · ${materials.resumes.length} 份简历${materials.facts.length ? ` · ${materials.facts.length} 条补充` : ""}`
              : "也可以先生成通用开场白，不虚构个人经历"}
          </span>
          {remaining !== null && <span>本小时剩余 {remaining} 次</span>}
        </div>
        <details className="preferences">
          <summary>
            调整偏好 <span>语气、简历、侧重点 · 可选</span>
            <span className="chevron">⌄</span>
          </summary>
          <div className="preferences-body">
            <div className="preference-grid">
              <fieldset>
                <legend>表达语气</legend>
                <div className="tone-options">
                  {tones.map(([id, label]) => (
                    <button
                      type="button"
                      key={id}
                      aria-pressed={tone === id}
                      className={tone === id ? "selected" : ""}
                      disabled={isBusy}
                      onClick={() => setTone(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div>
                <label htmlFor="resume-choice">参考简历</label>
                <select
                  id="resume-choice"
                  disabled={isBusy}
                  value={selectedResume}
                  onChange={(e) => setSelectedResume(e.target.value)}
                >
                  <option value="">自动参考所有资料</option>
                  {materials.resumes.map((resume) => (
                    <option key={resume.id} value={resume.id}>
                      {resume.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label htmlFor="supplement">这次想补充什么？</label>
            <input
              id="supplement"
              disabled={isBusy}
              value={supplement}
              onChange={(e) => setSupplement(e.target.value)}
              placeholder="例如：可两周内到岗，想了解团队负责的业务"
            />
            <details className="focus-details">
              <summary>
                侧重点建议 <span>不选择也能直接生成</span>
              </summary>
              <label htmlFor="focus-input">想突出哪段经历或能力？</label>
              <input
                id="focus-input"
                disabled={isBusy}
                value={extraFocus}
                onChange={(e) => setExtraFocus(e.target.value)}
                placeholder="留空即可，由助手根据岗位选择"
              />
              <button
                className="secondary-button"
                disabled={isBusy}
                onClick={() => void suggestFocus()}
              >
                帮我想几个侧重点
              </button>
              {focusOptions.length > 0 && (
                <fieldset className="focus-options">
                  <legend>仅对生成建议时参考的岗位生效</legend>
                  <label>
                    <input
                      type="radio"
                      name="focus"
                      checked={!selectedFocus}
                      disabled={isBusy}
                      onChange={() => setSelectedFocus("")}
                    />
                    不指定侧重点
                  </label>
                  {focusOptions.map((option) => (
                    <label key={option.id}>
                      <input
                        type="radio"
                        name="focus"
                        checked={selectedFocus === option.id}
                        disabled={isBusy}
                        onChange={() => setSelectedFocus(option.id)}
                      />
                      <span>
                        <strong>{option.title}</strong>
                        <small>{option.angle}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
            </details>
          </div>
        </details>
        {notice && (
          <div role="status" className={`notice ${notice.kind}`}>
            {notice.text}
          </div>
        )}
        {storageError && (
          <div role="status" className="notice warn">
            {storageError}
          </div>
        )}
        {jobs.length > 0 ? (
          <section className="results" aria-label="生成结果">
            <div className="results-heading">
              <h2>
                你的打招呼语{" "}
                <span>{resultCount ? `${resultCount} 条` : ""}</span>
              </h2>
              {resultCount > 1 && (
                <button
                  className="text-button"
                  onClick={() =>
                    void copy(
                      jobs
                        .filter((job) => job.result)
                        .map((job) => `${job.name}\n${job.result!.greeting}`)
                        .join("\n\n"),
                      "all",
                    )
                  }
                >
                  <Icon name="copy" size={16} />
                  {copied === "all" ? "已复制" : "复制全部"}
                </button>
              )}
            </div>
            {jobs.length > 1 && (
              <div className="batch-controls">
                <span>已选 {selectedCount} 个岗位</span>
                <button
                  disabled={isBusy}
                  onClick={() =>
                    setJobs((prev) =>
                      prev.map((job) => ({ ...job, selected: true })),
                    )
                  }
                >
                  全选
                </button>
                <button
                  disabled={isBusy}
                  onClick={() =>
                    setJobs((prev) =>
                      prev.map((job) => ({ ...job, selected: false })),
                    )
                  }
                >
                  取消全选
                </button>
              </div>
            )}
            {jobs.map((job) => (
              <article className="result-card" key={job.id}>
                <div className="result-card-header">
                  <div className="job-title">
                    {jobs.length > 1 && (
                      <input
                        type="checkbox"
                        aria-label={`选择 ${job.name}`}
                        checked={job.selected}
                        disabled={isBusy}
                        onChange={(e) =>
                          setJobs((prev) =>
                            prev.map((x) =>
                              x.id === job.id
                                ? { ...x, selected: e.target.checked }
                                : x,
                            ),
                          )
                        }
                      />
                    )}
                    <h3>{job.name}</h3>
                  </div>
                  <div className="result-header-actions">
                    {job.result && (
                      <button
                        className="copy-button"
                        onClick={() => void copy(job.result!.greeting, job.id)}
                      >
                        <Icon name="copy" size={16} />
                        {copied === job.id ? "已复制" : "复制"}
                      </button>
                    )}
                    <button
                      className="icon-button"
                      disabled={isBusy}
                      aria-label={`移除岗位 ${job.name}`}
                      onClick={() =>
                        setJobs((prev) => prev.filter((x) => x.id !== job.id))
                      }
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                </div>
                <details className="job-original">
                  <summary>查看或修改 JD 原文</summary>
                  <label className="sr-only" htmlFor={`jd-${job.id}`}>
                    JD 原文
                  </label>
                  <textarea
                    id={`jd-${job.id}`}
                    value={job.text}
                    disabled={isBusy}
                    onChange={(e) => {
                      const text = e.target.value;
                      setJobs((prev) =>
                        prev.map((x) =>
                          x.id === job.id
                            ? {
                                ...x,
                                text,
                                name: jobTitle(text),
                                result: undefined,
                                skipped: [],
                                error: undefined,
                              }
                            : x,
                        ),
                      );
                    }}
                  />
                </details>
                {job.error && (
                  <div role="alert" className="notice error">
                    {job.error}
                    <button
                      className="text-button"
                      disabled={isBusy}
                      onClick={() => void rewrite(job, "")}
                    >
                      重试
                    </button>
                  </div>
                )}
                {job.result ? (
                  <>
                    <label className="sr-only" htmlFor={`greeting-${job.id}`}>
                      编辑打招呼语
                    </label>
                    <textarea
                      id={`greeting-${job.id}`}
                      className="greeting-text"
                      value={job.result.greeting}
                      disabled={isBusy}
                      onChange={(e) =>
                        setJobs((prev) =>
                          prev.map((x) =>
                            x.id === job.id && x.result
                              ? {
                                  ...x,
                                  result: {
                                    ...x.result,
                                    greeting: e.target.value,
                                  },
                                }
                              : x,
                          ),
                        )
                      }
                    />
                    <div className="result-tools">
                      <span>可直接编辑 · {job.result.greeting.length} 字</span>
                      <div>
                        {["短一点", "更直接", "去掉套话"].map((label) => (
                          <button
                            key={label}
                            disabled={isBusy}
                            onClick={() =>
                              void rewrite(
                                job,
                                `请${label}。当前文案仅作表达参考，不是新的事实来源：${job.result!.greeting}`,
                              )
                            }
                          >
                            {label}
                          </button>
                        ))}
                        <button
                          disabled={isBusy}
                          onClick={() =>
                            void rewrite(job, "重新选择表达方式，不改变事实。")
                          }
                        >
                          重新生成
                        </button>
                      </div>
                    </div>
                    <details className="revision">
                      <summary>告诉助手怎么改</summary>
                      <label className="sr-only" htmlFor={`revision-${job.id}`}>
                        修改要求
                      </label>
                      <input
                        id={`revision-${job.id}`}
                        value={revisions[job.id] || ""}
                        onChange={(e) =>
                          setRevisions((prev) => ({
                            ...prev,
                            [job.id]: e.target.value,
                          }))
                        }
                        placeholder="例如：少一点客套，重点说社群项目"
                      />
                      <button
                        className="secondary-button"
                        disabled={isBusy || !revisions[job.id]?.trim()}
                        onClick={() => void rewrite(job, revisions[job.id])}
                      >
                        按要求调整
                      </button>
                    </details>
                    {!!job.result.questions?.filter(
                      (q) => !job.skipped.includes(q.question),
                    ).length && (
                      <details className="follow-up">
                        <summary>
                          <Icon name="plus" size={17} />
                          <span>
                            补充一点经历，让表达更具体
                            <small>可选 · 当前文案已经可以使用</small>
                          </span>
                          <span className="chevron">⌄</span>
                        </summary>
                        {job.result.questions
                          .filter((q) => !job.skipped.includes(q.question))
                          .map((q) => (
                            <div className="question" key={q.question}>
                              <p className="question-reason">{q.reason}</p>
                              <label htmlFor={`${job.id}-${q.question}`}>
                                {q.question}
                              </label>
                              <textarea
                                id={`${job.id}-${q.question}`}
                                value={answers[`${job.id}:${q.question}`] || ""}
                                disabled={isBusy}
                                onChange={(e) =>
                                  setAnswers((prev) => ({
                                    ...prev,
                                    [`${job.id}:${q.question}`]: e.target.value,
                                  }))
                                }
                                placeholder="说说你实际做过什么；没有精确数据也没关系。"
                              />
                              <p className="helper">
                                保存后加入个人资料，可在“我的资料”中修改或删除。
                              </p>
                              <div className="question-actions">
                                <button
                                  className="secondary-button"
                                  disabled={
                                    isBusy ||
                                    !answers[`${job.id}:${q.question}`]?.trim()
                                  }
                                  onClick={() =>
                                    void saveAnswer(
                                      job,
                                      q.question,
                                      answers[`${job.id}:${q.question}`],
                                    )
                                  }
                                >
                                  保存并更新文案
                                </button>
                                <button
                                  className="text-button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    void saveAnswer(
                                      job,
                                      q.question,
                                      "没有相关经历，请不要在文案中声称具备该经历。",
                                    )
                                  }
                                >
                                  没有相关经历
                                </button>
                                <button
                                  className="text-button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    setJobs((prev) =>
                                      prev.map((x) =>
                                        x.id === job.id
                                          ? {
                                              ...x,
                                              skipped: [
                                                ...x.skipped,
                                                q.question,
                                              ],
                                            }
                                          : x,
                                      ),
                                    )
                                  }
                                >
                                  暂时跳过
                                </button>
                              </div>
                            </div>
                          ))}
                      </details>
                    )}
                  </>
                ) : (
                  !job.error && (
                    <div className="result-pending">
                      {isBusy ? (
                        <>
                          <span className="spinner" /> 正在结合岗位整理表达…
                        </>
                      ) : (
                        <button
                          className="secondary-button"
                          disabled={isBusy}
                          onClick={() => void rewrite(job, "")}
                        >
                          生成这个岗位的打招呼语
                        </button>
                      )}
                    </div>
                  )
                )}
              </article>
            ))}
          </section>
        ) : (
          <div className="quiet-empty">
            <Icon name="spark" size={24} />
            <p>一句真实、具体的开场白，就从这里开始。</p>
            <span>不必填写所有选项，准备好 JD 就可以试试。</span>
          </div>
        )}
        <footer className="workspace-footer">
          真实经历，简洁表达。发送前请核对内容。
        </footer>
      </main>
      <dialog
        ref={dialogRef}
        className="materials-drawer"
        aria-labelledby="materials-title"
        onClose={() => setDrawerOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            const box = e.currentTarget.getBoundingClientRect();
            if (e.clientX < box.left || e.clientX > box.right)
              setDrawerOpen(false);
          }
        }}
      >
        <div className="drawer-header">
          <div>
            <span className="eyebrow">让助手逐渐了解你</span>
            <h2 id="materials-title">我的资料</h2>
          </div>
          <button
            className="icon-button"
            aria-label="关闭我的资料"
            onClick={() => setDrawerOpen(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="drawer-content">
          <p className="helper">
            简历和补充经历保存在当前浏览器。自动整理档案，无需逐项填表。
          </p>
          <section className="profile-summary">
            <div className="section-heading">
              <h3>个人档案</h3>
              <span className="subtle-tag">自动整理</span>
            </div>
            {currentProfile ? (
              <>
                <h4>{currentProfile.name || "我的经历"}</h4>
                <p>
                  {[
                    currentProfile.targetPosition,
                    currentProfile.yearsExperience,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <div className="skill-chips">
                  {currentProfile.skills?.map((skill, index) => (
                    <span key={index}>{skill}</span>
                  ))}
                </div>
                {currentProfile.experiences?.map((experience, index) => (
                  <div className="experience" key={index}>
                    <strong>
                      {[experience.company, experience.role]
                        .filter(Boolean)
                        .join(" · ")}
                    </strong>
                    <ul>
                      {experience.highlights?.map((highlight, i) => (
                        <li key={i}>{highlight}</li>
                      ))}
                    </ul>
                  </div>
                ))}
                <p className="helper">
                  摘要由已有材料整理，修改下方原文后会自动更新。不同版本有冲突的信息不会自动合并成事实。
                </p>
              </>
            ) : (
              <p className="helper">
                {profileSource
                  ? profileStatus || "正在整理…"
                  : "添加一份或多份简历后，这里会自动整理你的经历与技能。"}
              </p>
            )}
            {profileStatus.startsWith("自动整理暂不可用") && (
              <button
                className="text-button"
                disabled={isBusy}
                onClick={() => setProfileRetry((v) => v + 1)}
              >
                重新整理
              </button>
            )}
          </section>
          <section className="resume-library">
            <div className="section-heading">
              <h3>
                简历文档 <span>{materials.resumes.length}/20</span>
              </h3>
              <button
                className="text-button"
                disabled={isBusy || materials.resumes.length >= 20}
                onClick={() => resumeFileRef.current?.click()}
              >
                <Icon name="plus" size={16} />
                上传简历
              </button>
              <input
                ref={resumeFileRef}
                type="file"
                hidden
                multiple
                accept=".pdf,.docx,.txt,.md"
                onChange={(e) => {
                  addFiles("resume", Array.from(e.target.files || []));
                  e.target.value = "";
                }}
              />
            </div>
            <p className="helper">
              支持 PDF、DOCX、TXT，可同时添加不同岗位版本。
            </p>
            {fileChips(resumeFiles, "resume")}
            {resumeFiles.length > 0 && (
              <button
                className="secondary-button"
                disabled={isBusy}
                onClick={() => void importResumes()}
              >
                {busy === "resume"
                  ? "读取中…"
                  : `读取 ${resumeFiles.length} 份简历`}
              </button>
            )}
            {materials.resumes.map((resume) => (
              <details className="saved-resume" key={resume.id}>
                <summary>
                  <Icon name="folder" size={17} />
                  <span>{resume.name}</span>
                  <small>{resume.text.length} 字</small>
                </summary>
                <label htmlFor={`name-${resume.id}`}>简历名称</label>
                <input
                  id={`name-${resume.id}`}
                  value={resume.name}
                  disabled={isBusy}
                  onChange={(e) =>
                    setMaterials((prev) => ({
                      ...prev,
                      resumes: prev.resumes.map((x) =>
                        x.id === resume.id ? { ...x, name: e.target.value } : x,
                      ),
                    }))
                  }
                />
                <label htmlFor={`resume-${resume.id}`}>简历原文</label>
                <textarea
                  id={`resume-${resume.id}`}
                  value={resume.text}
                  disabled={isBusy}
                  onChange={(e) =>
                    setMaterials((prev) => ({
                      ...prev,
                      resumes: prev.resumes.map((x) =>
                        x.id === resume.id ? { ...x, text: e.target.value } : x,
                      ),
                    }))
                  }
                />
                <div className="document-actions">
                  <button
                    className="text-button"
                    disabled={isBusy || materials.resumes.length >= 20}
                    onClick={() =>
                      setMaterials((prev) => ({
                        ...prev,
                        resumes: [
                          ...prev.resumes,
                          {
                            ...resume,
                            id: uid(),
                            name: `${resume.name} · 副本`,
                          },
                        ],
                      }))
                    }
                  >
                    复制版本
                  </button>
                  <button
                    className="text-button danger"
                    disabled={isBusy}
                    onClick={() => {
                      setMaterials((prev) => ({
                        ...prev,
                        resumes: prev.resumes.filter((x) => x.id !== resume.id),
                      }));
                      if (selectedResume === resume.id) setSelectedResume("");
                    }}
                  >
                    删除这份简历
                  </button>
                </div>
              </details>
            ))}
            <details
              className="paste-resume"
              open={!materials.resumes.length && !resumeFiles.length}
            >
              <summary>也可以粘贴简历文字</summary>
              <label htmlFor="resume-name">名称（可选）</label>
              <input
                id="resume-name"
                value={resumeName}
                disabled={isBusy}
                onChange={(e) => setResumeName(e.target.value)}
                placeholder="例如：产品运营版"
              />
              <label htmlFor="resume-text">简历原文</label>
              <textarea
                id="resume-text"
                value={resumeDraft}
                disabled={isBusy}
                onChange={(e) => setResumeDraft(e.target.value)}
                placeholder="粘贴工作、项目、教育经历和技能…"
              />
              <button
                className="secondary-button"
                disabled={
                  isBusy ||
                  !resumeDraft.trim() ||
                  materials.resumes.length >= 20
                }
                onClick={saveResumeText}
              >
                保存简历
              </button>
            </details>
          </section>
          {materials.facts.length > 0 && (
            <section className="saved-facts">
              <h3>已补充的经历</h3>
              {materials.facts.map((fact) => (
                <details key={fact.id}>
                  <summary>{fact.question}</summary>
                  <label className="sr-only" htmlFor={`fact-${fact.id}`}>
                    补充经历
                  </label>
                  <textarea
                    id={`fact-${fact.id}`}
                    value={fact.answer}
                    disabled={isBusy}
                    onChange={(e) =>
                      setMaterials((prev) => ({
                        ...prev,
                        facts: prev.facts.map((x) =>
                          x.id === fact.id
                            ? { ...x, answer: e.target.value }
                            : x,
                        ),
                      }))
                    }
                  />
                  <button
                    className="text-button danger"
                    disabled={isBusy}
                    onClick={() =>
                      setMaterials((prev) => ({
                        ...prev,
                        facts: prev.facts.filter((x) => x.id !== fact.id),
                      }))
                    }
                  >
                    删除这条补充
                  </button>
                </details>
              ))}
            </section>
          )}
          {notice && (
            <div role="status" className={`notice ${notice.kind}`}>
              {notice.text}
            </div>
          )}
          {storageError && <p className="notice warn">{storageError}</p>}
        </div>
        <div className="drawer-footer">
          <span>随时可以回来补充资料</span>
          <button
            className="primary-button"
            onClick={() => setDrawerOpen(false)}
          >
            回到岗位 <Icon name="arrow" size={17} />
          </button>
        </div>
      </dialog>
    </>
  );
}
