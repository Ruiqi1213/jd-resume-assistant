import { NextResponse } from "next/server";
import { checkAccessCode, isAccessGateEnabled } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 前端解锁页校验口令用。不配置 ACCESS_CODE 时永远返回 ok（本地直进）。 */
export async function POST(req: Request) {
  if (!isAccessGateEnabled()) {
    return NextResponse.json({ ok: true, gate: false });
  }
  const body = (await req.json().catch(() => null)) as { accessCode?: string } | null;
  const code = typeof body?.accessCode === "string" ? body.accessCode : "";
  if (checkAccessCode(code)) {
    return NextResponse.json({ ok: true, gate: true });
  }
  return NextResponse.json({ ok: false, error: "访问口令不正确" }, { status: 401 });
}
