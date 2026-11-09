/** Public workspace: access codes are no longer required. */
export function getAccessCode(): string {
  return "";
}
export function isAccessGateEnabled(): boolean {
  return false;
}
export function extractAccessCode(_req: Request, _body?: unknown): string {
  return "";
}
export function checkAccessCode(_provided: string): boolean {
  return true;
}
