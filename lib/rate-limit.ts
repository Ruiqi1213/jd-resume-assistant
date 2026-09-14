import { getAccessCode } from "./access";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return headers.get("x-real-ip") || "unknown";
}

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>;
};

let redisClient: RedisLike | null | undefined;

function getRedis(): RedisLike | null {
  if (redisClient !== undefined) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!url || !token) {
    redisClient = null;
    return null;
  }
  // 动态 import，避免未安装 @upstash/redis 时构建失败
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Redis } = require("@upstash/redis") as typeof import("@upstash/redis");
  redisClient = new Redis({ url, token });
  return redisClient;
}

/** 仅测试用：重置内存桶 + redis 客户端缓存 */
export function _resetRateLimit() {
  buckets.clear();
  redisClient = undefined;
}

/**
 * 每小时固定窗口限流。key 建议带上访问口令粒度（如 code:xxx），
 * 这样每个被分享口令的人独立配额，一个 key 被刷爆不影响其他人。
 *
 * - 配置了 UPSTASH_REDIS_REST_URL/TOKEN 时走 Redis（Vercel 多实例共享）。
 * - 未配置时退化为进程内存（本地开发 / 单实例够用）。
 */
export async function checkRateLimitShared(
  key: string,
  limit: number,
  now = Date.now(),
  windowMs = 60 * 60 * 1000,
): Promise<{ ok: true; remaining: number } | { ok: false; retryAfterSec: number }> {
  const redis = getRedis();
  if (!redis) {
    return checkRateLimit(key, limit, now, windowMs);
  }
  const rkey = `rl:${key}`;
  try {
    const raw = await redis.get(rkey);
    if (!raw) {
      await redis.set(rkey, JSON.stringify({ count: 1, resetAt: now + windowMs }), {
        ex: Math.ceil(windowMs / 1000) + 60,
      });
      return { ok: true, remaining: Math.max(0, limit - 1) };
    }
    const bucket = JSON.parse(raw) as Bucket;
    if (!bucket.resetAt || now >= bucket.resetAt) {
      await redis.set(rkey, JSON.stringify({ count: 1, resetAt: now + windowMs }), {
        ex: Math.ceil(windowMs / 1000) + 60,
      });
      return { ok: true, remaining: Math.max(0, limit - 1) };
    }
    if (bucket.count >= limit) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    }
    bucket.count += 1;
    await redis.set(rkey, JSON.stringify(bucket), {
      ex: Math.ceil((bucket.resetAt - now) / 1000) + 60,
    });
    return { ok: true, remaining: Math.max(0, limit - bucket.count) };
  } catch {
    // Redis 故障时降级为内存，避免整站不可用
    return checkRateLimit(key, limit, now, windowMs);
  }
}

export function checkRateLimit(
  key: string,
  limit: number,
  now = Date.now(),
  windowMs = 60 * 60 * 1000,
): { ok: true; remaining: number } | { ok: false; retryAfterSec: number } {
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: Math.max(0, limit - 1) };
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { ok: true, remaining: Math.max(0, limit - bucket.count) };
}

/** 按「访问口令」做限流分桶：同一口令的所有 IP 共享配额，防止口令泄露后被 distributed 刷。 */
export function rateLimitKeyForCode(scope: string, code: string, ip: string): string {
  const gate = getAccessCode();
  if (gate && code) return `${scope}:code:${code}`;
  return `${scope}:${ip}`;
}
