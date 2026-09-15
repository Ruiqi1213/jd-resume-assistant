import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

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
  // pdf-parse：纯 Node 解析，无 worker、无 canvas，适合 Vercel serverless
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  await parser.destroy().catch(() => undefined);
  let text = (result.text || "").replace(/\r/g, "").trim();
  if (!text) return "";
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
