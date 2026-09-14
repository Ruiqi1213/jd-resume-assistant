/** 访问口令（防刷）：服务端统一校验。 */
export function getAccessCode(): string {
  return (process.env.ACCESS_CODE || "").trim();
}

export function isAccessGateEnabled(): boolean {
  return getAccessCode().length > 0;
}

/** 从请求中提取口令：优先 Authorization: Bearer，其次 x-access-code header / query / body 字段。 */
export function extractAccessCode(req: Request, body?: unknown): string {
  const h = req.headers;
  const auth = h.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  const header = (h.get("x-access-code") || "").trim();
  if (header) return header;
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("code") || "").trim();
    if (q) return q;
  } catch {
    // ignore
  }
  if (body && typeof body === "object") {
    const v = (body as Record<string, unknown>).accessCode;
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function checkAccessCode(provided: string): boolean {
  const expected = getAccessCode();
  if (!expected) return true; // 未配置则不设门槛（本地开发方便）
  if (!provided) return false;
  // 常量时间比较，避免时序侧信道
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}
