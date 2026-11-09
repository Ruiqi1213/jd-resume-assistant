import { afterEach, expect, it, vi } from "vitest";
import { isAccessGateEnabled, checkAccessCode, extractAccessCode } from "./access";
afterEach(() => vi.unstubAllEnvs());
it("allows public access even with a legacy deployment access code configured", () => {
 vi.stubEnv("ACCESS_CODE", "legacy-test-code");
 expect(isAccessGateEnabled()).toBe(false);
 expect(checkAccessCode("")).toBe(true);
 expect(extractAccessCode(new Request("https://example.com", { headers: {"x-access-code":"old"}}))).toBe("");
});
