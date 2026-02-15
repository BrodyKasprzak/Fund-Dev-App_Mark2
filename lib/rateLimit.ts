import crypto from "crypto";
import { adminDb } from "@/lib/firebaseAdmin";

type EnforceRateLimitArgs = {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
};

export class RateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function hash(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function getRequestIp(req: Request) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = req.headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();

  return "unknown";
}

export async function enforceRateLimit(args: EnforceRateLimitArgs) {
  const { scope, key, limit, windowMs } = args;

  if (!scope.trim() || !key.trim() || limit < 1 || windowMs < 1000) {
    throw new Error("Invalid rate limit configuration");
  }

  const nowMs = Date.now();
  const windowStartMs = nowMs - (nowMs % windowMs);
  const windowEndMs = windowStartMs + windowMs;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowEndMs - nowMs) / 1000));

  const bucketId = hash(`${scope}:${key}:${windowStartMs}`);
  const docRef = adminDb.collection("_rate_limits").doc(bucketId);
  const now = new Date(nowMs);
  const resetAt = new Date(windowEndMs);
  const expiresAt = new Date(windowEndMs + windowMs);

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);

    if (!snap.exists) {
      tx.set(docRef, {
        scope,
        keyHash: hash(key),
        count: 1,
        windowStart: new Date(windowStartMs),
        resetAt,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });
      return;
    }

    const current = Number(snap.data()?.count ?? 0);
    if (current >= limit) {
      throw new RateLimitError("Too many requests. Please try again later.", retryAfterSeconds);
    }

    tx.update(docRef, {
      count: current + 1,
      updatedAt: now,
      resetAt,
      expiresAt,
    });
  });
}

