"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type JdInfo = {
  company: string;
  position: string;
  location: string;
  salary: string;
  responsibilities: string[];
  requirements: string[];
  keywords: string[];
};

type ResumeProfile = {
  name: string;
  targetPosition: string;
  yearsExperience: string;
  skills: string[];
  experiences: Array<{ company: string; role: string; highlights: string[] }>;
  strengths: string[];
};

type GenerateResult = {
  greeting: string;
  matchPoints: string[];
  suggestions: string[];
};

type FocusOption = { id: string; title: string; angle: string; why: string };
type Tone = "sincere" | "professional" | "lively";
type Busy = "extract" | "parse" | "greeting" | "focus" | null;
type Msg = { kind: "ok" | "warn" | "err"; text: string };

type DocItem = { id: string; name: string; text: string };
type JobStatus = "idle" | "loading" | "done" | "error";

const TONE_OPTIONS: Array<{ id: Tone; label: string; emoji: string; desc: string }> = [
  { id: "sincere", label: "真诚内敛", emoji: "🤝", desc: "踏实可靠、不夸张" },
  { id: "professional", label: "专业干练", emoji: "💼", desc: "结果导向、字字有力" },
  { id: "lively", label: "活泼热情", emoji: "✨", desc: "有亲和力、记忆点强" },
];

const RESUME_ACCEPT = ".pdf,.docx,.txt,.md";
const JD_ACCEPT = ".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp";
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const MAX_RESUME_FILES = 5;
const MAX_JD_FILES = 12;

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function jdTitle(info: JdInfo | null | undefined, fallbackName: string): string {
  if (!info) return fallbackName;
  const parts = [info.company, info.position].filter(Boolean);
  return parts.length ? parts.join(" · ") : fallbackName;
}

/** 把粘贴的一大段 JD 按分隔符智能拆成多条 */
function smartSplitJd(draft: string): string[] {
  const t = draft.trim();
  if (!t) return [];
  const byRule = t.split(/\n\s*(?:-{3,}|={3,}|·{3,}|…{3,}|JD\s*\d+.*)\s*\n/);
  if (byRule.length > 1 && byRule.every((s) => s.trim().length > 30)) {
    return byRule.map((s) => s.trim()).filter(Boolean);
  }
  const byBlank = t.split(/\n\s*\n\s*\n+/);
  if (byBlank.length > 1 && byBlank.every((s) => s.trim().length > 80)) {
    return byBlank.map((s) => s.trim()).filter(Boolean);
  }
  return [t];
}

const CODE_KEY = "jd-assistant-access-code";

function getStoredCode(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(CODE_KEY) || "";
  } catch {
    return "";
  }
}

export default function Home() {
  const [accessCode, setAccessCode] = useState<string>("");
  const [unlocked, setUnlocked] = useState<boolean>(false);
  const [codeDraft, setCodeDraft] = useState<string>("");
  const [codeError, setCodeError] = useState<string>("");
  const [resumeFiles, setResumeFiles] = useState<File[]>([]);
  const [jdFiles, setJdFiles] = useState<File[]>([]);
  const [resumes, setResumes] = useState<DocItem[]>([]);
  const [jds, setJds] = useState<DocItem[]>([]);
  const [resumeDraft, setResumeDraft] = useState("");
  const [jdDraft, setJdDraft] = useState("");

  const [activeResumeId, setActiveResumeId] = useState<string>("");
  const [checkedJdIds, setCheckedJdIds] = useState<string[]>([]);
  const [expandedJdId, setExpandedJdId] = useState<string>("");
  const [expandedResultId, setExpandedResultId] = useState<string>("");

  const [supplement, setSupplement] = useState("");
  const [tone, setTone] = useState<Tone>("sincere");
  const [extraFocus, setExtraFocus] = useState("");
  const [direction, setDirection] = useState("");

  const [resumeProfile, setResumeProfile] = useState<ResumeProfile | null>(null);
  const [jdInfos, setJdInfos] = useState<Record<string, JdInfo | null>>({});
  const [results, setResults] = useState<Record<string, GenerateResult>>({});
  const [jobErrors, setJobErrors] = useState<Record<string, string>>({});
  const [jobLoading, setJobLoading] = useState<Record<string, boolean>>({});
  const [focusOptions, setFocusOptions] = useState<FocusOption[]>([]);
  const [selectedFocus, setSelectedFocus] = useState<string>("");

  const [busy, setBusy] = useState<Busy>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<Msg | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<"resume" | "jd" | null>(null);
  const [copiedId, setCopiedId] = useState<string>("");

  const resumeInputRef = useRef<HTMLInputElement>(null);
  const jdInputRef = useRef<HTMLInputElement>(null);

  const activeResume = useMemo(
    () => resumes.find((r) => r.id === activeResumeId) || resumes[0] || null,
    [resumes, activeResumeId],
  );
  const checkedJds = useMemo(
    () => jds.filter((j) => checkedJdIds.includes(j.id)),
    [jds, checkedJdIds],
  );
  const doneCount = useMemo(() => Object.keys(results).length, [results]);
  const loadingCount = useMemo(
    () => Object.values(jobLoading).filter(Boolean).length,
    [jobLoading],
  );

  const canParse = useMemo(
    () => resumes.length > 0 || jds.length > 0,
    [resumes, jds],
  );
  const canBatch = useMemo(
    () => !!activeResume && activeResume.text.trim().length > 10 && checkedJds.length > 0,
    [activeResume, checkedJds],
  );

  const stepState = useMemo(() => {
    return {
      input: resumes.length > 0 || jds.length > 0,
      parsed: !!resumeProfile || Object.keys(jdInfos).length > 0,
      focusReady: focusOptions.length > 0 || !!extraFocus.trim() || !!direction.trim(),
      done: doneCount > 0,
    };
  }, [resumes, jds, resumeProfile, jdInfos, focusOptions, extraFocus, direction, doneCount]);

  function show(kind: Msg["kind"], text: string) {
    setMessage({ kind, text });
  }

  // 首次进入：无口令门时直接进入；有口令门时用保存的口令自动解锁
  useEffect(() => {
    fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessCode: getStoredCode() }),
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.ok) {
          if (!j.gate) {
            // 未启用口令门：直接进入，无需口令
            setUnlocked(true);
            return;
          }
          const saved = getStoredCode();
          if (saved) {
            setAccessCode(saved);
            setUnlocked(true);
          }
        } else {
          try {
            localStorage.removeItem(CODE_KEY);
          } catch {
            // ignore
          }
        }
      })
      .catch(() => undefined);
  }, []);

  async function handleUnlock() {
    const code = codeDraft.trim();
    if (!code) {
      setCodeError("请输入访问口令");
      return;
    }
    setCodeError("");
    try {
      const r = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: code }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        setAccessCode(code);
        setUnlocked(true);
        try {
          localStorage.setItem(CODE_KEY, code);
        } catch {
          // ignore
        }
      } else {
        setCodeError(j.error || "口令不正确");
      }
    } catch {
      setCodeError("网络异常，请重试");
    }
  }

  function authHeaders(): Record<string, string> {
    const h: Record<string, string> = {};
    if (accessCode) h["x-access-code"] = accessCode;
    return h;
  }

  function addFiles(slot: "resume" | "jd", list: FileList | File[] | null) {
    const arr = list ? Array.from(list as unknown as Iterable<File>) : [];
    if (!arr.length) return;
    const over: string[] = [];
    const ok: File[] = [];
    for (const f of arr) {
      if (f.size > 10 * 1024 * 1024) {
        over.push(f.name);
        continue;
      }
      ok.push(f);
    }
    if (over.length) show("warn", `${over.join("、")} 超过 10MB，已跳过。`);
    if (slot === "resume") {
      setResumeFiles((prev) => [...prev, ...ok].slice(0, MAX_RESUME_FILES));
      if (resumeFiles.length + ok.length > MAX_RESUME_FILES) {
        show("warn", `简历文件最多 ${MAX_RESUME_FILES} 个，超出部分已截断。`);
      }
    } else {
      setJdFiles((prev) => [...prev, ...ok].slice(0, MAX_JD_FILES));
      if (jdFiles.length + ok.length > MAX_JD_FILES) {
        show("warn", `JD 文件最多 ${MAX_JD_FILES} 个，超出部分已截断。`);
      }
    }
  }

  function handleAddResumeText() {
    const t = resumeDraft.trim();
    if (!t) {
      show("warn", "请先在简历文本框粘贴内容。");
      return;
    }
    const item: DocItem = { id: uid(), name: `粘贴简历 ${resumes.length + 1}`, text: t };
    setResumes((prev) => {
      const next = [...prev, item];
      if (!activeResumeId && next.length === 1) setActiveResumeId(item.id);
      return next;
    });
    if (!activeResumeId) setActiveResumeId(item.id);
    setResumeDraft("");
    show("ok", "已添加 1 份简历。");
  }

  function handleAddJdText(smart: boolean) {
    const t = jdDraft.trim();
    if (!t) {
      show("warn", "请先在 JD 文本框粘贴内容（可一次粘贴多个岗位）。");
      return;
    }
    const parts = smart ? smartSplitJd(t) : [t];
    const items: DocItem[] = parts.map((p, i) => ({
      id: uid() + `-${i}`,
      name: parts.length > 1 ? `粘贴JD ${jds.length + i + 1}` : `粘贴JD ${jds.length + 1}`,
      text: p,
    }));
    setJds((prev) => [...prev, ...items]);
    setCheckedJdIds((prev) => [...prev, ...items.map((x) => x.id)]);
    setJdDraft("");
    show("ok", `已添加 ${items.length} 条 JD${smart && items.length > 1 ? "（已按分隔符拆分）" : ""}。`);
  }

  async function handleExtract() {
    if (resumeFiles.length === 0 && jdFiles.length === 0) {
      show("warn", "请先选择文件：简历 PDF/DOCX/TXT，或 JD 文件/截图（可多选）。也可以直接粘贴文本添加。");
      return;
    }
    setBusy("extract");
    setMessage(null);
    try {
      const form = new FormData();
      resumeFiles.forEach((f) => form.append("resumes", f));
      jdFiles.forEach((f) => form.append("jds", f));
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `解析失败(${res.status})`);
      const newResumes: DocItem[] = Array.isArray(json.resumes)
        ? json.resumes.map((r: { name: string; text: string }, i: number) => ({
            id: uid() + `-r${i}`,
            name: r.name || `简历 ${resumes.length + i + 1}`,
            text: r.text || "",
          }))
        : json.resumeText
          ? [{ id: uid(), name: resumeFiles[0]?.name || "简历", text: json.resumeText }]
          : [];
      const newJds: DocItem[] = Array.isArray(json.jds)
        ? json.jds.map((r: { name: string; text: string }, i: number) => ({
            id: uid() + `-j${i}`,
            name: r.name || `JD ${jds.length + i + 1}`,
            text: r.text || "",
          }))
        : [];
      if (newResumes.length) {
        setResumes((prev) => {
          const next = [...prev, ...newResumes];
          if (!activeResumeId && next.length) setActiveResumeId(next[0].id);
          return next;
        });
        if (!activeResumeId && newResumes.length) setActiveResumeId(newResumes[0].id);
      }
      if (newJds.length) {
        setJds((prev) => [...prev, ...newJds]);
        setCheckedJdIds((prev) => [...prev, ...newJds.map((x) => x.id)]);
      }
      setResumeFiles([]);
      setJdFiles([]);
      if (typeof json.remaining === "number") setRemaining(json.remaining);
      const warns: string[] = Array.isArray(json.warnings) ? json.warnings : [];
      show(
        "ok",
        `文件解析完成：简历 ${newResumes.length} 份，JD ${newJds.length} 条${warns.length ? "；" + warns.join("；") : ""}${
          newResumes.length + newJds.length === 0 ? "（但未提取到文字，扫描件请改用截图或粘贴）" : ""
        }`,
      );
    } catch (e) {
      show("err", e instanceof Error ? e.message : "文件解析失败");
    } finally {
      setBusy(null);
    }
  }

  async function handleParse() {
    if (!canParse) {
      show("warn", "还没有简历或 JD，请先上传文件或粘贴添加。");
      return;
    }
    setBusy("parse");
    setMessage(null);
    try {
      const payloadJds = jds.map((j) => j.text);
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          accessCode,
          resumeText: activeResume?.text || resumes[0]?.text || "",
          jdTexts: payloadJds,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `结构化解析失败(${res.status})`);
      setResumeProfile(json.resumeProfile || null);
      const infos: JdInfo[] = Array.isArray(json.jdInfos)
        ? json.jdInfos
        : json.jdInfo
          ? [json.jdInfo]
          : [];
      const map: Record<string, JdInfo | null> = {};
      jds.forEach((j, i) => {
        map[j.id] = infos[i] || null;
      });
      setJdInfos(map);
      if (typeof json.remaining === "number") setRemaining(json.remaining);
      show("ok", `结构化解析完成：简历画像 1 份，JD ${infos.length} 条。`);
    } catch (e) {
      show("err", e instanceof Error ? e.message : "结构化解析失败");
    } finally {
      setBusy(null);
    }
  }

  function focusJdForStrategy(): DocItem | null {
    if (expandedJdId) return jds.find((j) => j.id === expandedJdId) || null;
    return checkedJds[0] || jds[0] || null;
  }

  async function handleFocus() {
    const target = focusJdForStrategy();
    if (!activeResume || !target) {
      show("warn", "请先准备好 1 份简历和至少 1 条 JD，再生成侧重点。");
      return;
    }
    setBusy("focus");
    setMessage(null);
    try {
      const info = jdInfos[target.id];
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          accessCode,
          mode: "focus",
          resumeText: activeResume.text,
          jd: info || target.text,
          direction,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `生成失败(${res.status})`);
      const options: FocusOption[] = Array.isArray(json.options) ? json.options : [];
      setFocusOptions(options);
      if (options.length > 0) setSelectedFocus(options[0].id);
      if (typeof json.remaining === "number") setRemaining(json.remaining);
      show("ok", `已基于「${jdTitle(info, target.name)}」生成侧重点，批量生成时会对每条 JD 生效。`);
    } catch (e) {
      show("err", e instanceof Error ? e.message : "生成失败");
    } finally {
      setBusy(null);
    }
  }

  async function generateOne(jdId: string): Promise<boolean> {
    const jd = jds.find((j) => j.id === jdId);
    if (!jd || !activeResume) return false;
    setJobLoading((prev) => ({ ...prev, [jdId]: true }));
    setJobErrors((prev) => {
      const n = { ...prev };
      delete n[jdId];
      return n;
    });
    try {
      const chosen = focusOptions.find((o) => o.id === selectedFocus);
      const info = jdInfos[jdId];
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          accessCode,
          mode: "greeting",
          resumeText: activeResume.text,
          jd: info || jd.text,
          supplement,
          tone,
          extraFocus: [extraFocus, chosen ? `侧重点：${chosen.title} - ${chosen.angle}` : ""]
            .filter(Boolean)
            .join("\n"),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `生成失败(${res.status})`);
      setResults((prev) => ({ ...prev, [jdId]: json.result }));
      if (typeof json.remaining === "number") setRemaining(json.remaining);
      setExpandedResultId(jdId);
      return true;
    } catch (e) {
      setJobErrors((prev) => ({
        ...prev,
        [jdId]: e instanceof Error ? e.message : "生成失败",
      }));
      return false;
    } finally {
      setJobLoading((prev) => ({ ...prev, [jdId]: false }));
    }
  }

  async function handleBatch() {
    if (!canBatch) {
      show("warn", "批量生成需要：1 份简历 + 至少勾选 1 条 JD。");
      return;
    }
    const targets = checkedJds.map((j) => j.id);
    setBatchBusy(true);
    setBusy("greeting");
    setMessage(null);
    setProgress({ done: 0, total: targets.length });
    let okCount = 0;
    for (const id of targets) {
      const ok = await generateOne(id);
      if (ok) okCount++;
      setProgress((p) => (p ? { done: p.done + 1, total: p.total } : p));
    }
    setBatchBusy(false);
    setBusy(null);
    setProgress(null);
    show(
      okCount === targets.length ? "ok" : "warn",
      `批量生成完成：成功 ${okCount}/${targets.length}。可在下方逐条复制，或点「复制全部」。`,
    );
  }

  async function handleCopyOne(jdId: string) {
    const r = results[jdId];
    if (!r) return;
    const ok = await copyText(r.greeting);
    if (ok) {
      setCopiedId(jdId);
      setTimeout(() => setCopiedId((c) => (c === jdId ? "" : c)), 2000);
    } else {
      show("err", "复制失败，请手动选中文字复制。");
    }
  }

  async function handleCopyAll() {
    const parts = checkedJds
      .filter((j) => results[j.id])
      .map((j) => {
        const info = jdInfos[j.id];
        const r = results[j.id];
        return `【${jdTitle(info, j.name)}】\n${r.greeting}`;
      });
    if (!parts.length) {
      show("warn", "还没有可复制的结果，先批量生成。");
      return;
    }
    const ok = await copyText(parts.join("\n\n---\n\n"));
    show(ok ? "ok" : "err", ok ? `已复制全部 ${parts.length} 条招呼语。` : "复制失败，请逐条手动复制。");
  }

  function dropzone(slot: "resume" | "jd") {
    const files = slot === "resume" ? resumeFiles : jdFiles;
    const accept = slot === "resume" ? RESUME_ACCEPT : JD_ACCEPT;
    const inputRef = slot === "resume" ? resumeInputRef : jdInputRef;
    const title = slot === "resume" ? "简历文件（可多选）" : "JD 文件 / 截图（可多选）";
    const sub =
      slot === "resume"
        ? `PDF · DOCX · TXT，上限${MAX_RESUME_FILES}份 · 10MB/份`
        : `截图 PNG/JPG 一次选多张，上限${MAX_JD_FILES}条`;
    const isImg = files.length === 1 && (IMAGE_EXT.test(files[0].name) || files[0].type.startsWith("image/"));
    return (
      <div
        className={`dropzone ${files.length ? "has-file" : ""} ${dragOver === slot ? "dragging" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(slot);
        }}
        onDragLeave={() => setDragOver((s) => (s === slot ? null : s))}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(null);
          addFiles(slot, e.dataTransfer.files);
        }}
      >
        <div className="dz-icon">{slot === "resume" ? "📄" : isImg ? "🖼️" : "🧲"}</div>
        <div className="dz-title">{title}</div>
        <div className="dz-sub">
          {files.length ? `已选 ${files.length} 个，点击继续添加` : `点击选择或拖拽到此处\n${sub}`}
        </div>
        {files.length > 0 && (
          <div className="dz-files" onClick={(e) => e.stopPropagation()}>
            {files.map((f, i) => (
              <div className="dz-file" key={`${f.name}-${i}`}>
                <span className="name" title={f.name}>{f.name}</span>
                <span className="size">{fmtSize(f.size)}</span>
                <button
                  type="button"
                  className="dz-remove"
                  onClick={() =>
                    slot === "resume"
                      ? setResumeFiles((prev) => prev.filter((_, k) => k !== i))
                      : setJdFiles((prev) => prev.filter((_, k) => k !== i))
                  }
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        )}
        {!files.length && <span className="dz-cta">选择文件</span>}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          hidden
          onChange={(e) => {
            addFiles(slot, e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  if (!unlocked) {
    return (
      <>
        <nav className="topnav">
          <div className="topnav-inner">
            <div className="logo-mark">招</div>
            <div>
              <div className="brand-name">JD × 简历 · 打招呼助手</div>
              <div className="brand-sub">私密部署 · 凭口令访问</div>
            </div>
          </div>
        </nav>
        <div className="page gate-page">
          <div className="card gate-card">
            <div className="gate-icon">🔐</div>
            <h2>请输入访问口令</h2>
            <p>
              这是一个私有部署的求职助手，仅限受邀使用。向网站所有者获取口令后输入即可开始。
            </p>
            <input
              type="text"
              value={codeDraft}
              onChange={(e) => setCodeDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleUnlock();
              }}
              placeholder="访问口令"
              autoFocus
            />
            {codeError && <div className="notice err">{codeError}</div>}
            <button className="btn btn-primary gate-btn" onClick={handleUnlock}>
              进入
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <nav className="topnav">
        <div className="topnav-inner">
          <div className="logo-mark">招</div>
          <div>
            <div className="brand-name">JD × 简历 · 打招呼助手</div>
            <div className="brand-sub">批量 JD · 一份简历一次生成多条招呼语</div>
          </div>
          <span className={`quota-pill ${remaining === null ? "dim" : ""}`}>
            {remaining === null ? "配额未使用" : `本小时剩余 ${remaining} 次`}
          </span>
        </div>
      </nav>
      <div className="page">
        <header className="hero">
          <h1>一次截图多个岗位，一键生成每条招呼语</h1>
          <p>
            上传 1 份简历 + 多张 JD 截图（或粘贴多条 JD），自动 OCR 与结构化解析，
            选好语气后批量生成每条岗位的专属打招呼私信，逐条复制投递。
          </p>
          <div className="hero-badges">
            <span>多截图批量 OCR</span>
            <span>多 JD 批量解析</span>
            <span>逐条专属生成</span>
            <span>3 档语气风格</span>
            <span>一键复制全部</span>
          </div>
        </header>

        <div className="stepper">
          {[
            { done: stepState.input, t: "① 输入", s: `${resumes.length} 份简历 · ${jds.length} 条JD` },
            { done: stepState.parsed, t: "② 解析", s: "画像 + JD 结构化" },
            { done: stepState.focusReady, t: "③ 策略", s: "侧重点 / 语气" },
            { done: stepState.done, t: "④ 批量生成", s: `${doneCount} 条已生成` },
          ].map((x, i) => (
            <div className={`step-item ${x.done ? "done" : ""}`} key={i}>
              <div className="step-dot">{x.done ? "✓" : i + 1}</div>
              <div>
                <div className="t">{x.t}</div>
                <div className="s">{x.s}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid">
          <section className="card">
            <div className="card-head">
              <div className="card-num">1</div>
              <div>
                <h2>简历与 JD 批量输入</h2>
                <p>文件可多选上传；文本可逐条粘贴添加，多个岗位一次粘贴可用智能拆分。</p>
              </div>
            </div>

            <div className="drop-grid">
              {dropzone("resume")}
              {dropzone("jd")}
            </div>

            <div className="row mt">
              <button className="btn btn-primary" disabled={busy !== null} onClick={handleExtract}>
                {busy === "extract" && <span className="spinner" />}
                {busy === "extract" ? "解析文件中…" : "解析上传文件"}
              </button>
              <button className="btn btn-secondary" disabled={busy !== null || !canParse} onClick={handleParse}>
                {busy === "parse" && <span className="spinner" />}
                {busy === "parse" ? "结构化解析中…" : `结构化解析（${jds.length} 条JD）`}
              </button>
            </div>

            <div className="section-title">简历库（{resumes.length}）</div>
            {resumes.length === 0 && (
              <div className="empty slim">还没有简历：上传文件解析，或在下方粘贴添加</div>
            )}
            {resumes.map((r) => (
              <div
                key={r.id}
                className={`doc-row ${activeResume?.id === r.id ? "active" : ""}`}
                onClick={() => setActiveResumeId(r.id)}
              >
                <span className="radio" />
                <div className="meta">
                  <strong>{r.name}</strong>
                  <span>{r.text.length} 字 · 生成时使用{activeResume?.id === r.id ? "（当前）" : ""}</span>
                </div>
                <button
                  className="mini-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setResumes((prev) => prev.filter((x) => x.id !== r.id));
                    if (activeResumeId === r.id) setActiveResumeId("");
                  }}
                >
                  删除
                </button>
              </div>
            ))}
            <div className="field-row">
              <label>粘贴简历文本</label>
              <span className="spacer" />
              <span className="count">{resumeDraft.length} 字</span>
            </div>
            <textarea
              value={resumeDraft}
              onChange={(e) => setResumeDraft(e.target.value)}
              placeholder="粘贴一份简历全文，点下方按钮加入简历库…"
            />
            <div className="row mt">
              <button className="btn btn-secondary btn-sm" onClick={handleAddResumeText}>
                添加这份简历
              </button>
            </div>

            {activeResume && (
              <>
                <div className="field-row">
                  <label>当前简历正文（可编辑）</label>
                  <span className="hint">{activeResume.name}</span>
                  <span className="spacer" />
                  <span className="count">{activeResume.text.length} 字</span>
                </div>
                <textarea
                  value={activeResume.text}
                  onChange={(e) =>
                    setResumes((prev) =>
                      prev.map((x) => (x.id === activeResume.id ? { ...x, text: e.target.value } : x)),
                    )
                  }
                />
              </>
            )}

            <div className="section-title">JD 列表（{jds.length}）· 勾选参与批量生成</div>
            {jds.length === 0 && (
              <div className="empty slim">还没有 JD：多选截图上传，或在下方粘贴添加</div>
            )}
            {jds.map((j, idx) => {
              const info = jdInfos[j.id];
              const checked = checkedJdIds.includes(j.id);
              return (
                <div key={j.id} className={`doc-row col ${checked ? "active" : ""}`}>
                  <div
                    className="doc-row-top"
                    onClick={() =>
                      setCheckedJdIds((prev) =>
                        prev.includes(j.id) ? prev.filter((x) => x !== j.id) : [...prev, j.id],
                      )
                    }
                  >
                    <span className="checkbox">{checked ? "✓" : ""}</span>
                    <div className="meta">
                      <strong>
                        {idx + 1}. {jdTitle(info, j.name)}
                      </strong>
                      <span>
                        {j.text.length} 字
                        {info?.keywords?.length ? ` · ${info.keywords.slice(0, 4).join(" / ")}` : ""}
                        {results[j.id] ? " · 已生成" : ""}
                      </span>
                    </div>
                    <button
                      className="mini-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedJdId((v) => (v === j.id ? "" : j.id));
                      }}
                    >
                      {expandedJdId === j.id ? "收起" : "查看"}
                    </button>
                    <button
                      className="mini-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setJds((prev) => prev.filter((x) => x.id !== j.id));
                        setCheckedJdIds((prev) => prev.filter((x) => x !== j.id));
                      }}
                    >
                      删除
                    </button>
                  </div>
                  {expandedJdId === j.id && (
                    <textarea
                      className="inline-edit"
                      value={j.text}
                      onChange={(e) =>
                        setJds((prev) =>
                          prev.map((x) => (x.id === j.id ? { ...x, text: e.target.value } : x)),
                        )
                      }
                    />
                  )}
                </div>
              );
            })}
            <div className="field-row">
              <label>粘贴 JD 文本</label>
              <span className="hint">一次粘贴多个岗位可用智能拆分</span>
              <span className="spacer" />
              <span className="count">{jdDraft.length} 字</span>
            </div>
            <textarea
              value={jdDraft}
              onChange={(e) => setJdDraft(e.target.value)}
              placeholder="粘贴一条或多条 JD…多条之间用空行或 --- 分隔"
            />
            <div className="row mt">
              <button className="btn btn-secondary btn-sm" onClick={() => handleAddJdText(false)}>
                添加 1 条 JD
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => handleAddJdText(true)}>
                智能拆分添加多条
              </button>
            </div>

            <div className="field-row">
              <label>补充说明</label>
              <span className="hint">对全部 JD 生效：意向城市、到岗时间…</span>
            </div>
            <input
              type="text"
              value={supplement}
              onChange={(e) => setSupplement(e.target.value)}
              placeholder="例如：可一周内到岗，意向杭州…"
            />

            {message && <div className={`notice ${message.kind}`}>{message.text}</div>}
          </section>

          <div className="stack">
            <section className="card">
              <div className="card-head">
                <div className="card-num">2</div>
                <div>
                  <h2>解析结果</h2>
                  <p>简历画像 + 每条 JD 的公司/岗位/关键词。</p>
                </div>
              </div>

              {busy === "parse" && (
                <div>
                  <div className="skeleton" style={{ width: "55%" }} />
                  <div className="skeleton" />
                  <div className="skeleton" style={{ width: "80%" }} />
                </div>
              )}

              {!resumeProfile && Object.keys(jdInfos).length === 0 && busy !== "parse" && (
                <div className="empty">
                  <span className="big">🔍</span>
                  暂无解析结果
                  <br />
                  点「结构化解析」后展示画像与各条 JD 要点
                </div>
              )}

              {resumeProfile && (
                <>
                  <div className="section-title">候选人画像</div>
                  <dl className="kv">
                    <dt>姓名</dt>
                    <dd>{resumeProfile.name || "—"}</dd>
                    <dt>意向岗位</dt>
                    <dd>{resumeProfile.targetPosition || "—"}</dd>
                    <dt>经验</dt>
                    <dd>{resumeProfile.yearsExperience || "—"}</dd>
                  </dl>
                  {resumeProfile.skills?.length > 0 && (
                    <div className="chips">
                      {resumeProfile.skills.map((s, i) => (
                        <span className="chip" key={i}>{s}</span>
                      ))}
                    </div>
                  )}
                </>
              )}

              {jds.length > 0 && Object.keys(jdInfos).length > 0 && (
                <>
                  <div className="section-title">各 JD 要点</div>
                  {jds.map((j, i) => {
                    const info = jdInfos[j.id];
                    if (!info) return null;
                    return (
                      <div className="jd-mini" key={j.id}>
                        <strong>
                          {i + 1}. {jdTitle(info, j.name)}
                        </strong>
                        <div className="sub">
                          {[info.location, info.salary].filter(Boolean).join(" · ") || "地点/薪资未知"}
                        </div>
                        {info.keywords?.length > 0 && (
                          <div className="chips">
                            {info.keywords.slice(0, 8).map((k, k2) => (
                              <span className="chip green" key={k2}>{k}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <div className="card-num">3</div>
                <div>
                  <h2>批量结果（{doneCount}/{jds.length}）</h2>
                  <p>每条 JD 独立生成，可逐条复制或一键复制全部。</p>
                </div>
                {doneCount > 0 && (
                  <button className="btn btn-secondary btn-sm" style={{ marginLeft: "auto" }} onClick={handleCopyAll}>
                    复制全部
                  </button>
                )}
              </div>

              {progress && (
                <div className="progress">
                  <div className="bar" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                  <span>正在生成 {progress.done}/{progress.total}…</span>
                </div>
              )}

              {jds.length === 0 && (
                <div className="empty">
                  <span className="big">💬</span>
                  还没有 JD，先在左侧添加
                </div>
              )}

              {jds.map((j, i) => {
                const r = results[j.id];
                const err = jobErrors[j.id];
                const loading = jobLoading[j.id];
                const info = jdInfos[j.id];
                const open = expandedResultId === j.id;
                return (
                  <div key={j.id} className={`result-row ${r ? "done" : ""}`}>
                    <div className="result-top" onClick={() => setExpandedResultId((v) => (v === j.id ? "" : j.id))}>
                      <span className={`status ${r ? "ok" : loading ? "run" : err ? "fail" : ""}`}>
                        {r ? "✓" : loading ? "…" : err ? "!" : i + 1}
                      </span>
                      <div className="meta">
                        <strong>{jdTitle(info, j.name)}</strong>
                        <span>{r ? `${r.greeting.length} 字` : err ? err : loading ? "生成中…" : "未生成"}</span>
                      </div>
                      {r && (
                        <button
                          className="mini-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyOne(j.id);
                          }}
                        >
                          {copiedId === j.id ? "已复制" : "复制"}
                        </button>
                      )}
                      {!r && !loading && (
                        <button
                          className="mini-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            generateOne(j.id);
                          }}
                        >
                          生成
                        </button>
                      )}
                    </div>
                    {loading && <div className="skeleton" />}
                    {r && open && (
                      <div className="result-body">
                        <div className="greeting">{r.greeting}</div>
                        {r.matchPoints?.length > 0 && (
                          <>
                            <div className="section-title">为什么匹配</div>
                            <ol className="tight">
                              {r.matchPoints.map((m, k) => (
                                <li key={k}>{m}</li>
                              ))}
                            </ol>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          </div>
        </div>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <div className="card-num">4</div>
            <div>
              <h2>生成策略 · 对全部 JD 生效</h2>
              <p>选定简历 + 语气 + 侧重点，一键批量生成已勾选的 JD。</p>
            </div>
          </div>

          <div className="grid" style={{ gap: 18 }}>
            <div>
              <div className="field-row">
                <label>使用简历</label>
                <span className="hint">批量生成统一使用这份</span>
              </div>
              <div className="resume-pick">
                {resumes.map((r) => (
                  <span
                    key={r.id}
                    className={`pick ${activeResume?.id === r.id ? "on" : ""}`}
                    onClick={() => setActiveResumeId(r.id)}
                  >
                    {r.name}
                  </span>
                ))}
                {resumes.length === 0 && <span className="count">暂无简历，请先添加</span>}
              </div>

              <div className="field-row">
                <label>方向偏好</label>
                <span className="hint">用于生成侧重点，可选</span>
              </div>
              <input
                type="text"
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                placeholder="例如：偏技术深度 / 偏业务结果…"
              />
              <div className="row mt">
                <button className="btn btn-secondary" disabled={busy !== null} onClick={handleFocus}>
                  {busy === "focus" && <span className="spinner" />}
                  {busy === "focus" ? "生成中…" : "生成侧重点"}
                </button>
              </div>
              {focusOptions.map((o) => (
                <div
                  key={o.id}
                  className={`focus-opt ${selectedFocus === o.id ? "active" : ""}`}
                  onClick={() => setSelectedFocus(o.id)}
                >
                  <div className="top">
                    <span className="radio" />
                    <strong>{o.title}</strong>
                  </div>
                  <p><span>切入：</span>{o.angle}</p>
                  <p><span>理由：</span>{o.why}</p>
                </div>
              ))}
            </div>

            <div>
              <div className="field-row">
                <label>语气风格</label>
              </div>
              <div className="tone-grid">
                {TONE_OPTIONS.map((t) => (
                  <div
                    key={t.id}
                    className={`tone-card ${tone === t.id ? "active" : ""}`}
                    onClick={() => setTone(t.id)}
                  >
                    <div className="e">{t.emoji}</div>
                    <div className="n">{t.label}</div>
                    <div className="d">{t.desc}</div>
                  </div>
                ))}
              </div>

              <div className="field-row">
                <label>侧重点补充</label>
                <span className="hint">与选中侧重点一起拼入每条生成</span>
              </div>
              <input
                type="text"
                value={extraFocus}
                onChange={(e) => setExtraFocus(e.target.value)}
                placeholder="例如：突出高并发与稳定性…"
              />

              <div className="row mt">
                <button className="btn btn-primary" disabled={busy !== null || batchBusy || !canBatch} onClick={handleBatch}>
                  {(busy === "greeting" || batchBusy) && <span className="spinner" />}
                  {batchBusy || busy === "greeting"
                    ? `生成中…${loadingCount > 0 ? `${loadingCount} 条` : ""}`
                    : `一键批量生成（${checkedJds.length} 条）`}
                </button>
                <span className="count">
                  {canBatch ? "输入就绪" : "需 1 份简历 + 勾选 JD"}
                </span>
              </div>
              <div className="row mt">
                <button className="btn btn-secondary btn-sm" disabled={!canBatch} onClick={() => checkedJds[0] && generateOne(checkedJds[0].id)}>
                  只生成第一条试试
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setCheckedJdIds(jds.map((j) => j.id))}>
                  全选
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setCheckedJdIds([])}>
                  全不选
                </button>
              </div>
            </div>
          </div>
        </section>

        <p className="footer">
          简历与 JD 文本仅用于本次生成，不做持久化存储 · 图片 JD 需在 .env.local 配置视觉模型 · 超长文本自动截断 · 批量生成逐条调用模型，注意配额消耗
        </p>
      </div>
    </>
  );
}
