/** Persian-first formatting helpers used by every screen. */
import { escapeHtml, truncate } from "./validation.ts";

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function faNum(value: number): string {
  try {
    return new Intl.NumberFormat("fa-IR").format(value);
  } catch {
    return String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)] ?? d);
  }
}

export function faPercent(part: number, total: number): string {
  if (total <= 0) return "۰٪";
  return `${faNum(Math.round((part / total) * 100))}٪`;
}

export function parseDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatter(timeZone: string, withTime: boolean): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("fa-IR", {
    timeZone,
    ...(withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "medium" }),
  });
}

export function faDate(value: string | Date | null | undefined, timeZone = "Asia/Tehran"): string {
  if (!value) return "—";
  const date = parseDate(value);
  if (!date) return "—";
  try {
    return formatter(timeZone, false).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function faDateTime(
  value: string | Date | null | undefined,
  timeZone = "Asia/Tehran",
): string {
  if (!value) return "—";
  const date = parseDate(value);
  if (!date) return "—";
  try {
    return formatter(timeZone, true).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

export function relativeFa(value: string | Date | null | undefined, now = new Date()): string {
  if (!value) return "—";
  const date = parseDate(value);
  if (!date) return "—";
  const diffMs = date.getTime() - now.getTime();
  const past = diffMs < 0;
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60_000);

  let text: string;
  if (minutes < 1) text = "چند لحظه";
  else if (minutes < 60) text = `${faNum(minutes)} دقیقه`;
  else if (minutes < 1440) text = `${faNum(Math.round(minutes / 60))} ساعت`;
  else text = `${faNum(Math.round(minutes / 1440))} روز`;

  return past ? `${text} پیش` : `در ${text} آینده`;
}

export function durationFa(minutes: number): string {
  if (minutes <= 0) return "دائمی";
  if (minutes < 60) return `${faNum(minutes)} دقیقه`;
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${faNum(hours)} ساعت` : `${faNum(hours)} ساعت و ${faNum(rest)} دقیقه`;
  }
  const days = Math.floor(minutes / 1440);
  return `${faNum(days)} روز`;
}

/** نمودار میله‌ای ساده و خوانا در متن تلگرام. */
export function barChart(value: number, max: number, width = 10): string {
  const safeMax = Math.max(max, value, 1);
  const filled = Math.max(0, Math.min(width, Math.round((value / safeMax) * width)));
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

export function sectionTitle(title: string): string {
  return `<b>${title}</b>`;
}

export function divider(): string {
  return "──────────────";
}

export function field(label: string, value: string | number, emoji = ""): string {
  const prefix = emoji ? `${emoji} ` : "";
  return `${prefix}<b>${label}:</b> ${value}`;
}

export function bullet(text: string): string {
  return `• ${text}`;
}

export function code(text: string): string {
  return `<code>${escapeHtml(text)}</code>`;
}

export function reportHeader(title: string, timeZone = "Asia/Tehran", now = new Date()): string {
  return `<b>${title}</b>\n<i>${faDateTime(now, timeZone)}</i>\n${divider()}`;
}

export type StatusScope = "ad" | "campaign" | "post" | "scheduled" | "group" | "ai";

const STATUS_LABELS: Record<StatusScope, Record<string, string>> = {
  ad: {
    draft: "📝 پیش‌نویس",
    active: "🟢 فعال",
    paused: "⏸ متوقف",
    archived: "📦 بایگانی",
  },
  campaign: {
    draft: "📝 پیش‌نویس",
    queued: "🕐 در صف",
    running: "🚀 در حال ارسال",
    paused: "⏸ متوقف",
    completed: "✅ پایان‌یافته",
    cancelled: "🚫 لغوشده",
    failed: "❌ ناموفق",
  },
  post: {
    draft: "📝 پیش‌نویس",
    scheduled: "🕐 زمان‌بندی‌شده",
    published: "✅ منتشرشده",
    archived: "📦 بایگانی",
  },
  scheduled: {
    pending: "🕐 در انتظار",
    sent: "✅ ارسال‌شده",
    failed: "❌ ناموفق",
    cancelled: "🚫 لغوشده",
  },
  group: {
    active: "🟢 فعال",
    inactive: "🔴 غیرفعال",
  },
  ai: {
    ok: "🟢 سالم",
    degraded: "🟡 کند/ناپایدار",
    quota_exhausted: "🔴 سهمیه تمام",
    disabled: "⚪ خاموش",
  },
};

export function statusLabel(scope: StatusScope, status: string): string {
  return STATUS_LABELS[scope][status] ?? status;
}

export function progressLine(done: number, total: number, width = 10): string {
  if (total <= 0) return barChart(0, 1, width);
  return `${barChart(done, total, width)} ${faPercent(done, total)}`;
}

/** نام نمایشی کاربر برای کارت‌های مدیریتی */
export function displayName(input: {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
}): string {
  const full = [input.first_name, input.last_name].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (input.username) return `@${input.username}`;
  return "کاربر ناشناس";
}

export function userMention(input: {
  telegram_id: number;
  first_name?: string | null;
  last_name?: string | null;
}): string {
  return `<a href="tg://user?id=${input.telegram_id}">${escapeHtml(displayName(input))}</a>`;
}

export function shorten(text: string, max = 60): string {
  return truncate(text.replace(/\s+/g, " "), max);
}

export function listOrEmpty(lines: string[], emptyText = "موردی ثبت نشده است."): string {
  return lines.length > 0 ? lines.join("\n") : `<i>${emptyText}</i>`;
}

export function errorBox(message: string): string {
  return `⚠️ <b>خطا</b>\n${message}`;
}

export function successBox(message: string): string {
  return `✅ ${message}`;
}

export function escape(text: string): string {
  return escapeHtml(text);
}
