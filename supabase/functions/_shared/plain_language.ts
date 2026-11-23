/**
 * 🗣 زبان ساده — هر متن و برچسب دکمه‌ای که به کاربر نشان داده می‌شود از این
 * لایه عبور می‌کند تا هیچ اصطلاح فنی (HTML، دیتابیس، Webhook، API، …) دیده نشود.
 * تنها جای اعمال: context.send / sendTo / editOrSend / answerCallback.
 */
import type { TgInlineKeyboardMarkup } from "./types.ts";

/** عبارت‌های چندکلمه‌ای باید قبل از تک‌کلمه‌ای‌ها بیایند. */
const PHRASES: readonly [RegExp, string][] = [
  // متن‌های محتوایی
  [
    /هنگام ارسال امن[\u200c ]?سازی\s*HTML انجام می[\u200c ]?گیرد/gi,
    "هنگام ارسال، متن به‌طور خودکار مرتب می‌شود",
  ],
  [/امن[\u200c ]?سازی\s*HTML/gi, "مرتب‌سازی خودکار متن"],
  [/بدون\s*HTML\s*؛/gi, "به‌صورت متن ساده؛"],
  [/بدون\s*HTML/gi, "به‌صورت متن ساده"],
  [/\(\s*HTML\s+ساده\s+مجاز\s+است\s*\)/gi, ""],
  [/\bHTML\b/gi, "متن ساده"],

  // منبع اطلاعات انیمه
  [/اطلاعات\s*(?:معتبر\s*)?(?:از\s*)?Jikan\s*\(\s*MyAnimeList\s*\)/g, "اطلاعات انیمه"],
  [/اطلاعات\s*Jikan/g, "اطلاعات انیمه"],
  [/منبع:?\s*Jikan\s*\/\s*MyAnimeList/gi, "منبع: اطلاعات انیمه"],
  [/منبع\s*Jikan/gi, "منبع اطلاعات انیمه"],
  [/\bMyAnimeList\b/g, "منبع اطلاعات انیمه"],
  [/\bJikan\b/g, "منبع اطلاعات انیمه"],

  // سرویس هوش مصنوعی
  [/حالت\s+Smart Fallback/gi, "حالت آفلاین هوشمند"],
  [/Smart Fallback/gi, "حالت آفلاین هوشمند"],
  [/GEMINI_API_KEY/g, "کلید هوش مصنوعی"],
  [/کلید\s*API/gi, "کلید هوش مصنوعی"],
  [/\bAPI\s*key\b/gi, "کلید هوش مصنوعی"],
  [/خطای\s*429[^\s،.]*/g, "اختلال موقت"],
  [/\b429\b/g, "اختلال موقت"],
  [/Cooldown\s*تلاش\s*مجدد/gi, "فاصلهٔ تلاش مجدد"],
  [/Cooldown|cooldown/gi, "فاصلهٔ تلاش مجدد"],
  [/سرویس\s*AI/gi, "هوش مصنوعی"],
  [/\bAI\b/g, "هوش مصنوعی"],

  // زیرساخت و امنیت
  [/TELEGRAM_WEBHOOK_SECRET|Webhook\s*Secret/gi, "اتصال امن تلگرام"],
  [/SCHEDULER_SECRET|Scheduler\s*Secret/gi, "کلید زمان‌بند خودکار"],
  [/\bsetWebhook\b/gi, "برقراری اتصال"],
  [/Webhook/gi, "اتصال تلگرام"],
  [/Supabase\s*Secrets|SUPABASE[_A-Z]*/gi, "بخش محرمانهٔ تنظیمات"],
  [/\bSupabase\b/gi, "سامانهٔ ربات"],
  [/Edge\s*Functions/gi, "سرور ربات"],
  [/\bRLS\b/g, "سطح دسترسی"],
  [/سرویس[\u200c ]رول/g, "کلید مدیریتی"],
  [/admin_actions/g, "سوابق فعالیت"],
  [/\bAudit\b/gi, "سوابق"],
  [/Bot\s*Token/gi, "کلید محرمانهٔ ربات"],
  [/توکن\s*تأیید/g, "کد تأیید"],
  [/\bcallback\b/gi, "دکمه"],
  [/\bmetadata\b/gi, "اطلاعات تکمیلی"],

  // داده و نشست
  [/دیتابیس/g, "حافظهٔ ربات"],
  [/دیتای/g, "اطلاعات"],
  [/Sessionها|sessionها/gi, "نشست‌های باز"],
  [/\bSession\b/gi, "نشست"],
  [/\bscheduler\b/gi, "زمان‌بند"],

  // پیام‌های وضعیت
  [/کلید تنظیمات ناشناخته است/g, "این تنظیم شناخته نشد"],
  [/کلید نامعتبر است/g, "این مورد معتبر نیست"],
  [/به گروه اضافه شد/g, "به گروه یا کانال اضافه شد"],
  [/مدیریت گروه‌ها/g, "مدیریت گروه‌ها و کانال‌ها"],
  [/👮 مدیریت گروه/g, "👮 مدیریت گروه و کانال"],
];

export function humanizeText(input: string): string {
  if (!input) return input;
  let output = input;
  for (const [pattern, replacement] of PHRASES) output = output.replace(pattern, replacement);
  // پاک‌سازی فاصله‌های اضافه بعد از حذف یک عبارت
  return output.replace(/\s+([.،!؟])/g, "$1").replace(/[ \t]{2,}/g, " ");
}

export function humanizeMarkup(
  markup?: TgInlineKeyboardMarkup,
): TgInlineKeyboardMarkup | undefined {
  if (!markup) return markup;
  return {
    inline_keyboard: markup.inline_keyboard.map((row) =>
      row.map((button) => ({ ...button, text: humanizeText(button.text) }))
    ),
  };
}
