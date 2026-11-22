/** Input validation / parsing helpers — pure, unit-tested. */
import type { RepeatInterval } from "./types.ts";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

export function escapeHtml(input: string): string {
  return input.replace(/[&<>]/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** حذف کاراکترهای کنترلی خطرناک (به‌جز newline و tab). */
export function stripControl(input: string): string {
  // deno-lint-ignore no-control-regex
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function normalizeDigits(input: string): string {
  return input
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function sanitizeText(input: string, maxLength = 4000): string {
  return stripControl(input).replace(/\r\n/g, "\n").trim().slice(0, maxLength);
}

export function truncate(input: string, maxLength: number, suffix = "…"): string {
  if (input.length <= maxLength) return input;
  return input.slice(0, Math.max(0, maxLength - suffix.length)).trimEnd() + suffix;
}

export function parseTelegramId(raw: string): number | null {
  const digits = normalizeDigits(raw.trim().replace(/^@/, ""));
  if (!/^\d{3,20}$/.test(digits)) return null;
  const value = Number(digits);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

/** @username یا شناسه‌ی -100... کانال/گروه */
export function parseChatTarget(raw: string): string | null {
  const value = raw.trim();
  if (/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value)) return value;
  if (/^-100\d{6,}$/.test(normalizeDigits(value))) return normalizeDigits(value);
  if (/^https?:\/\/t\.me\/([A-Za-z][A-Za-z0-9_]{4,31})\/?$/.test(value)) {
    const match = value.match(/^https?:\/\/t\.me\/([A-Za-z][A-Za-z0-9_]{4,31})\/?$/);
    return match ? `@${match[1]}` : null;
  }
  return null;
}

export function isValidUrl(raw: string): boolean {
  const value = raw.trim();
  if (!/^https?:\/\/[^\s]+$/i.test(value) && !/^tg:\/\/[^\s]+$/i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "tg:";
  } catch {
    return false;
  }
}

export interface ParsedButton {
  text: string;
  url: string;
}

/** "متن دکمه | https://example.com" در هر خط، حداکثر ۳ دکمه */
export function parseButtons(
  raw: string,
): { ok: true; buttons: ParsedButton[] } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed === "-") return { ok: true, buttons: [] };

  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length > 3) return { ok: false, error: "حداکثر ۳ دکمه مجاز است." };

  const buttons: ParsedButton[] = [];
  for (const line of lines) {
    const parts = line.split(/\s*[|｜]\s*/);
    if (parts.length !== 2) {
      return { ok: false, error: "قالب دکمه باید «متن | لینک» باشد." };
    }
    const [text, url] = parts;
    if (!text || text.length > 64) {
      return { ok: false, error: "متن دکمه باید بین ۱ تا ۶۴ کاراکتر باشد." };
    }
    if (!isValidUrl(url)) {
      return { ok: false, error: `لینک دکمه معتبر نیست: ${url}` };
    }
    buttons.push({ text, url });
  }
  return { ok: true, buttons };
}

export function parseRepeatInterval(raw: string): RepeatInterval | null {
  const value = raw.trim().toLowerCase();
  if (value === "none" || value === "بدون تکرار" || value === "-" || value === "یکبار") {
    return "none";
  }
  if (value === "daily" || value === "روزانه") return "daily";
  if (value === "weekly" || value === "هفتگی") return "weekly";
  if (value === "monthly" || value === "ماهانه") return "monthly";
  return null;
}

// ─── timezone-aware date parsing ────────────────────────────────────────────

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

/** تبدیل ساعت دیواری یک منطقه زمانی به UTC (با احتساب تغییر ساعت). */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let offset = zoneOffsetMs(new Date(guess), timeZone);
  let timestamp = guess - offset;
  const correctedOffset = zoneOffsetMs(new Date(timestamp), timeZone);
  if (correctedOffset !== offset) {
    offset = correctedOffset;
    timestamp = guess - offset;
  }
  return new Date(timestamp);
}

export function formatInZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      timeZone,
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

const RELATIVE_UNITS: { pattern: RegExp; ms: number }[] = [
  { pattern: /^(m|min|mins|minute|minutes|دقیقه|دقیقهای)$/i, ms: 60_000 },
  { pattern: /^(h|hr|hrs|hour|hours|ساعت|ساعتی)$/i, ms: 3_600_000 },
  { pattern: /^(d|day|days|روز|روزه)$/i, ms: 86_400_000 },
  { pattern: /^(w|week|weeks|هفته|هفتهای)$/i, ms: 604_800_000 },
];

export type ScheduleParseResult =
  | { ok: true; date: Date }
  | { ok: false; error: string };

/**
 * ورودی‌های پذیرفته‌شده:
 *   now / الان
 *   30m  +2h  1d   (نسبی)
 *   2026-03-21 20:30   (به وقت منطقه زمانی ربات)
 *   20:30  (امروز یا فردا اگر گذشته باشد)
 */
export function parseScheduleInput(
  raw: string,
  options: { timeZone: string; now?: Date },
): ScheduleParseResult {
  const now = options.now ?? new Date();
  const normalized = normalizeDigits(raw.trim());
  if (normalized.length === 0) return { ok: false, error: "زمان را وارد کنید." };

  if (/^(now|الان|همین حالا)$/i.test(normalized)) {
    return { ok: true, date: new Date(now.getTime() + 1000) };
  }

  const relative = normalized.match(/^\+?\s*(\d{1,4})\s*([A-Za-z\u0600-\u06FF]+)$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = RELATIVE_UNITS.find((u) => u.pattern.test(relative[2]));
    if (!unit) return { ok: false, error: "واحد زمان را درست وارد کنید (m/h/d)." };
    if (amount <= 0) return { ok: false, error: "زمان باید بزرگ‌تر از صفر باشد." };
    return { ok: true, date: new Date(now.getTime() + amount * unit.ms) };
  }

  const absolute = normalized.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})$/,
  );
  if (absolute) {
    const [, y, mo, d, h, mi] = absolute;
    const year = Number(y);
    const month = Number(mo);
    const day = Number(d);
    const hour = Number(h);
    const minute = Number(mi);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
      return { ok: false, error: "تاریخ/ساعت معتبر نیست." };
    }
    const date = zonedTimeToUtc(year, month, day, hour, minute, options.timeZone);
    if (date.getTime() < now.getTime() - 60_000) {
      return { ok: false, error: "زمان انتخاب‌شده در گذشته است." };
    }
    return { ok: true, date };
  }

  const clock = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (clock) {
    const hour = Number(clock[1]);
    const minute = Number(clock[2]);
    if (hour > 23 || minute > 59) return { ok: false, error: "ساعت معتبر نیست." };

    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: options.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const [year, month, day] = formatter.format(now).split("-").map(Number);
    let date = zonedTimeToUtc(year, month, day, hour, minute, options.timeZone);
    if (date.getTime() < now.getTime() - 60_000) {
      const tomorrow = new Date(date.getTime() + 86_400_000);
      date = zonedTimeToUtc(
        tomorrow.getUTCFullYear(),
        tomorrow.getUTCMonth() + 1,
        tomorrow.getUTCDate(),
        hour,
        minute,
        options.timeZone,
      );
    }
    return { ok: true, date };
  }

  return {
    ok: false,
    error:
      "قالب زمان نامعتبر است. مثال: <code>now</code>، <code>2h</code>، <code>2026-03-21 20:30</code>",
  };
}

/** تاریخ امروز در منطقه‌ی زمانی به شکل YYYY-MM-DD */
export function todayInZone(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function daysAgoIso(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/** بررسی طول callback_data (سقف تلگرام ۶۴ بایت) */
export function isValidCallbackData(data: string): boolean {
  return data.length > 0 && new TextEncoder().encode(data).length <= 64;
}

export function buildCallback(...parts: (string | number)[]): string {
  const data = parts.join(":");
  if (!isValidCallbackData(data)) {
    throw new Error(`callback_data too long: ${data.slice(0, 80)}`);
  }
  return data;
}
