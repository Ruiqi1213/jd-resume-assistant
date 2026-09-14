export const MAX_RESUME_CHARS = 8000;
export const MAX_JD_CHARS = 6000;
export const MAX_SUPPLEMENT_CHARS = 3000;

export function clipText(text: string, maxChars: number): string {
  const trimmed = text.replace(/\u0000/g, "").trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n\n[已截断，原文过长]`;
}

export function clipResume(text: string): string {
  return clipText(text, MAX_RESUME_CHARS);
}

export function clipJd(text: string): string {
  return clipText(text, MAX_JD_CHARS);
}

export function clipSupplement(text: string): string {
  return clipText(text, MAX_SUPPLEMENT_CHARS);
}
