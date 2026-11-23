/** Inline keyboard builders — طراحی یکپارچه‌ی منوها (RTL-friendly). */
import { type AdminIdentity, hasPermission, type Permission } from "./auth.ts";
import type { TgInlineKeyboardButton, TgInlineKeyboardMarkup } from "./types.ts";

export type Button = TgInlineKeyboardButton;

export function button(text: string, callbackData: string): Button {
  return { text, callback_data: callbackData };
}

export function urlButton(text: string, url: string): Button {
  return { text, url };
}

export function keyboard(rows: Button[][]): TgInlineKeyboardMarkup {
  return { inline_keyboard: rows.filter((row) => row.length > 0) };
}

export function backButton(callbackData = "a:h", label = "↩️ بازگشت"): Button {
  return button(label, callbackData);
}

export function backRow(callbackData = "a:h"): Button[] {
  return [backButton(callbackData)];
}

export function confirmKeyboard(confirmData: string, cancelData: string): TgInlineKeyboardMarkup {
  return keyboard([
    [button("✅ تأیید و اجرا", confirmData)],
    [button("❌ انصراف", cancelData)],
  ]);
}

export function navigationKeyboard(options: {
  back?: string;
  home?: boolean;
  refresh?: string;
}): Button[][] {
  const rows: Button[][] = [];
  if (options.refresh) rows.push([button("🔄 به‌روزرسانی", options.refresh)]);
  const nav: Button[] = [];
  if (options.back) nav.push(backButton(options.back));
  if (options.home !== false) nav.push(button("🏠 داشبورد", "a:h"));
  if (nav.length > 0) rows.push(nav);
  return rows;
}

export function paginationRow(prefix: string, page: number, hasNext: boolean): Button[] {
  const row: Button[] = [];
  if (page > 1) row.push(button("◀️ قبلی", `${prefix}:${page - 1}`));
  row.push(button(`صفحه ${page}`, "noop"));
  if (hasNext) row.push(button("بعدی ▶️", `${prefix}:${page + 1}`));
  return row;
}

export function toggleButton(
  label: string,
  isEnabled: boolean,
  callbackData: string,
): Button {
  return button(`${label}: ${isEnabled ? "🟢 روشن" : "🔴 خاموش"}`, callbackData);
}

export interface AdminMenuSection {
  label: string;
  callbackData: string;
  permission: Permission;
  feature?: string;
}

/** ۱۲ بخش اصلی داشبورد به‌ترتیب خواسته‌ی پروژه. */
export const ADMIN_MENU_SECTIONS: readonly AdminMenuSection[] = [
  { label: "📊 آمار و گزارش‌ها", callbackData: "a:st", permission: "stats.read" },
  { label: "👥 مدیریت کاربران", callbackData: "a:us", permission: "users.read" },
  { label: "🚫 مدیریت مسدودسازی", callbackData: "a:bn", permission: "bans.manage" },
  { label: "📢 مدیریت تبلیغات", callbackData: "a:ad", permission: "ads.read", feature: "ads" },
  {
    label: "📨 ارسال پیام همگانی",
    callbackData: "a:bc",
    permission: "broadcast.read",
    feature: "broadcast",
  },
  {
    label: "📅 زمان‌بندی انتشار",
    callbackData: "a:sh",
    permission: "schedule.manage",
    feature: "scheduling",
  },
  { label: "🤖 مدیریت هوش مصنوعی", callbackData: "a:ai", permission: "ai.read", feature: "ai" },
  { label: "📰 مدیریت اخبار", callbackData: "a:nw", permission: "content.read", feature: "news" },
  {
    label: "🎭 مدیریت محتوای انیمه",
    callbackData: "a:ct",
    permission: "content.read",
    feature: "content",
  },
  {
    label: "👮 مدیریت گروه و کانال",
    callbackData: "a:gr",
    permission: "groups.read",
    feature: "groups",
  },
  { label: "⚙️ تنظیمات ربات", callbackData: "a:se", permission: "settings.manage" },
  { label: "🛡 امنیت و گزارش فعالیت", callbackData: "a:sc", permission: "security.read" },
  { label: "🧰 ابزارهای سیستم", callbackData: "a:tl", permission: "tools.use" },
];

export function adminMainKeyboard(
  admin: AdminIdentity | null,
  enabledFeatures: Record<string, boolean> = {},
): TgInlineKeyboardMarkup {
  const sections = ADMIN_MENU_SECTIONS.filter((section) =>
    hasPermission(admin, section.permission) &&
    (!section.feature || enabledFeatures[section.feature] !== false)
  );

  const rows: Button[][] = [];
  for (let i = 0; i < sections.length; i += 2) {
    const pair = sections.slice(i, i + 2).map((s) => button(s.label, s.callbackData));
    rows.push(pair);
  }
  rows.push([
    button("🔄 به‌روزرسانی داشبورد", "a:h"),
    button("👤 پروفایل مدیر", "a:me"),
  ]);
  return keyboard(rows);
}

export interface UserMenuOptions {
  channelUrl: string;
  supportUrl?: string;
  showAi: boolean;
  showAnime: boolean;
  showNews: boolean;
}

export function userMainKeyboard(options: UserMenuOptions): TgInlineKeyboardMarkup {
  const rows: Button[][] = [];

  // دستهٔ ۱ — سرگرمی و محتوا
  const first: Button[] = [];
  if (options.showAi) first.push(button("🤖 چت هوشمند", "u:ai"));
  if (options.showAnime) first.push(button("🔎 جستجوی انیمه", "u:an"));
  if (first.length > 0) rows.push(first);

  // دستهٔ ۲ — خبر و بازی
  const second: Button[] = [];
  if (options.showNews) second.push(button("📰 آخرین اخبار", "u:nw"));
  second.push(button("🎮 بازی و سرگرمی", "u:gm"));
  rows.push(second);

  // دستهٔ ۳ — حساب کاربری و ابزارها
  rows.push([button("👤 پروفایل من", "u:pr"), button("🧰 جعبه‌ابزار", "u:tb")]);

  // دستهٔ ۴ — کانال و پشتیبانی
  const fourth: Button[] = [button("ℹ️ راهنما", "u:hl")];
  if (options.channelUrl) fourth.push(urlButton("📢 کانال", options.channelUrl));
  if (options.supportUrl) fourth.push(urlButton("💬 پشتیبانی", options.supportUrl));
  if (fourth.length > 0) rows.push(fourth);

  // دستهٔ ۵ — تنظیم پیام‌ها
  rows.push([button("🔕 توقف پیام‌ها", "u:st")]);
  return keyboard(rows);
}
