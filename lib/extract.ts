import mammoth from "mammoth";

const MAX_PAGES = 20;
const MAX_EXTRACT_CHARS = 50000;

export type ParseKind = "pdf" | "docx" | "txt" | "unknown";

export function detectKind(filename: string, mime: string): ParseKind {
  const name = (filename || "").toLowerCase();
  const m = (mime || "").toLowerCase();
  if (name.endsWith(".pdf") || m.includes("pdf")) return "pdf";
  if (
    name.endsWith(".docx") ||
    m.includes("wordprocessingml") ||
    m.includes("officedocument")
  )
    return "docx";
  if (
    name.endsWith(".doc") ||
    m.includes("msword")
  )
    return "unknown";
  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    m.startsWith("text/")
  )
    return "txt";
  return "unknown";
}

export async function parsePdfBuffer(buffer: Buffer): Promise<string> {
  const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs = mod as any;
  const data = new Uint8Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  const task = pdfjs.getDocument({ data, useSystemFonts: true });
  const pdf = await task.promise;
  const pages = Math.min(pdf.numPages ?? 0, MAX_PAGES);
  const parts: string[] = [];
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const line = (content.items as Array<{ str?: string }>)
      .map((it) => (typeof it.str === "string" ? it.str : ""))
      .join(" ");
    parts.push(line);
  }
  try {
    await pdf.destroy?.();
  } catch {
    // ignore
  }
  let text = parts.join("\n").replace(/\r/g, "").trim();
  if (pdf.numPages > MAX_PAGES) {
    text += `\n\n[注：PDF共${pdf.numPages}页，仅解析前${MAX_PAGES}页]`;
  }
  return text.slice(0, MAX_EXTRACT_CHARS);
}

export async function parseDocxBuffer(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer });
  return (value || "").replace(/\r/g, "").trim().slice(0, MAX_EXTRACT_CHARS);
}

export function parseTxtBuffer(buffer: Buffer): string {
  return buffer.toString("utf-8").replace(/\r/g, "").trim().slice(0, MAX_EXTRACT_CHARS);
}

export async function parseResumeBuffer(
  buffer: Buffer,
  filename: string,
  mime: string,
): Promise<{ text: string; kind: ParseKind }> {
  const kind = detectKind(filename, mime);
  if (kind === "pdf") {
    const text = await parsePdfBuffer(buffer);
    return { text, kind };
  }
  if (kind === "docx") {
    const text = await parseDocxBuffer(buffer);
    return { text, kind };
  }
  if (kind === "txt") {
    return { text: parseTxtBuffer(buffer), kind };
  }
  throw new Error(
    "不支持的文件格式：请上传 PDF / DOCX / TXT（JD截图请走图片解析）",
  );
}

export function isImageMime(mime: string, filename: string): boolean {
  const m = (mime || "").toLowerCase();
  const n = (filename || "").toLowerCase();
  if (m.startsWith("image/")) return true;
  return (
    n.endsWith(".png") ||
    n.endsWith(".jpg") ||
    n.endsWith(".jpeg") ||
    n.endsWith(".webp")
  );
}
