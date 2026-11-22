/** Rate limiting — پنجره‌ی لغزان در حافظه‌ی نمونه‌ی اجرا + سهمیه‌ی روزانه در DB. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { countRows } from "./db.ts";

export interface RateDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly maxKeys = 5000) {}

  hit(key: string, limit: number, windowMs: number, now = Date.now()): RateDecision {
    if (limit <= 0) return { allowed: true, remaining: 0, retryAfterMs: 0 };
    const cutoff = now - windowMs;
    const existing = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (existing.length >= limit) {
      const oldest = existing[0] ?? now;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, oldest + windowMs - now),
      };
    }

    existing.push(now);
    this.hits.set(key, existing);
    if (this.hits.size > this.maxKeys) this.prune(now);
    return { allowed: true, remaining: limit - existing.length, retryAfterMs: 0 };
  }

  prune(now = Date.now()): void {
    for (const [key, timestamps] of this.hits) {
      const fresh = timestamps.filter((t) => t > now - 3_600_000);
      if (fresh.length === 0) this.hits.delete(key);
      else this.hits.set(key, fresh);
    }
  }

  reset(key?: string): void {
    if (key) this.hits.delete(key);
    else this.hits.clear();
  }
}

/** یک نمونه برای هر isolate؛ چند نمونه در بار بالا، محدودیت را تقریبی می‌کند. */
export const limiter = new SlidingWindowLimiter();

export async function countSince(
  sb: SupabaseClient,
  table: string,
  userColumn: string,
  userId: number,
  sinceIso: string,
  extra?: (q: unknown) => unknown,
): Promise<number> {
  return await countRows(sb, table, (query) => {
    let q = query.eq(userColumn, userId).gte("created_at", sinceIso);
    if (extra) q = extra(q);
    return q;
  });
}

export function startOfDayIso(timeZone = "Asia/Tehran", now = new Date()): string {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year, month, day] = formatted.split("-").map(Number);
  // نیمه‌شب تهران ≈ 20:30 UTC روز قبل؛ با پیدا کردن offset دقیق محاسبه می‌شود.
  const noonUtc = Date.UTC(year, month - 1, day, 12, 0, 0);
  const offset = zoneOffsetMs(new Date(noonUtc), timeZone);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - offset).toISOString();
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour === 24 ? 0 : parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return asUtc - date.getTime();
}
