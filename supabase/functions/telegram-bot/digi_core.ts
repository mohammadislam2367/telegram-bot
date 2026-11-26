/**
 * هستهٔ مشترک لایهٔ دیجی: کارت‌ها، قفل‌ها، مجازات، سرگرمی و موتور قالب خوشامد.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../_shared/config.ts";
import type { TelegramApi } from "../_shared/telegram.ts";
import type { SettingsStore } from "../_shared/settings.ts";
import type { Logger } from "../_shared/logger.ts";
import type { GroupAdminChecker } from "../_shared/auth.ts";
import type { GroupSettingsRow, TgMessage } from "../_shared/types.ts";
import { insertRow, selectOne, selectRows, updateRows } from "../_shared/db.ts";
import { faDate, faDateTime, faNum } from "../_shared/texts.ts";
import { escapeHtml, normalizeDigits } from "../_shared/validation.ts";
import { buildPermissions, hasPermissionLocks, LOCK_DEFS } from "./locks.ts";

export interface DigiDeps {
  cfg: AppConfig;
  sb: SupabaseClient;
  tg: TelegramApi;
  settings: SettingsStore;
  log: Logger;
  groupAdmins: GroupAdminChecker;
}

const DIVIDER = "─━┅┅┈ ✁ ┈┅┅━─";
const FOOTER = "━━ 🆂🅿🅸🆇🅻🅴 ━━";

/** ظاهر کارت‌ها، عین استایل دیجی‌انتی. */
export function digiCard(title: string, lines: string[]): string {
  return [title, DIVIDER, ...lines, DIVIDER, FOOTER].filter(Boolean).join("\n");
}

/** نام‌های فارسی هر قفل — فهرست کامل دیجی. */
const ALIASES: Record<string, string[]> = {
  all: ["همگانی", "همه", "کل", "گروه"],
  tabchi: ["تبچی", "تبچی ها", "تبلیغ"],
  link: ["لینک", "لینک ها", "لینکها"],
  hyperlink: ["هایپر", "هایپرلینک"],
  photo: ["عکس", "تصویر", "عکس ها"],
  slash: ["اسلش", "اسلش ها"],
  username: ["یوزرنیم", "یوزر", "یوزرنیم ها"],
  sticker: ["استیکر", "استیکر ها"],
  video: ["ویدیو", "فیلم", "ویدئو"],
  voice: ["ویس", "صدا", "ویز"],
  music: ["موزیک", "اهنگ", "آهنگ", "موسیقی"],
  forward: ["فوروارد", "فروارد", "فرستاده"],
  gif: ["گیف", "گیف ها"],
  bot: ["ربات", "بات"],
  file: ["فایل", "سند", "فایل ها"],
  hashtag: ["هشتگ", "هشتک", "تگ"],
  emoji: ["ایموجی", "شکلک"],
  system: ["پیام سیستمی", "سیستمی"],
  edit: ["ویرایش", "ادیت"],
  number: ["شماره", "شماره تلفن", "عدد"],
  tg_game: ["بازی تلگرامی", "بازی"],
  location: ["لوکیشن", "موقعیت", "مکان"],
  video_note: ["ویدیو مسیج", "ویدیو مسیج ها", "حلقه"],
  code: ["کد متن", "کد", "مونو"],
  english: ["انگلیسی", "لاتین"],
  mention: ["منشن", "منشن ها"],
  persian: ["فارسی", "فارسی متن"],
  bold: ["بولد", "تیره"],
  italic: ["ایتالیک"],
  glass_button: ["دکمه شیشه ای", "دکمه شیشه‌ای", "دکمه"],
  text: ["متن", "متن پیام"],
  reply: ["ریپلی", "ریپلای", "پاسخ"],
  long: ["پیام طولانی", "طولانی", "متن طولانی"],
  curse: ["فحاشی", "فحش", "بددهنی"],
  poll: ["نظرسنجی", "نظر سنجی", "پرسش"],
  app: ["اپلیکیشن", "اپ"],
  preview: ["پیش نمایش", "پیش‌نمایش", "پریویو"],
};

export function normalize(value: string): string {
  return normalizeDigits(value)
    .replace(/[\u200c\u200e\u200f]/g, " ")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[.!؟?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function stripPunct(value: string): string {
  return normalize(value).replace(/[«»"'،,:؛]/g, " ").replace(/\s+/g, " ").trim();
}

export function lockKey(name: string): string | null {
  const wanted = stripPunct(name);
  for (const [key, aliases] of Object.entries(ALIASES)) {
    if (aliases.some((alias) => stripPunct(alias) === wanted)) return key;
  }
  return null;
}

export function lockLabel(key: string): string {
  const def = LOCK_DEFS.find((item) => item.key === key);
  return def ? `${def.emoji} ${def.label}` : key;
}

export async function say(
  deps: DigiDeps,
  chatId: number,
  text: string,
  markup?: unknown,
): Promise<void> {
  try {
    await deps.tg.sendMessage(chatId, text, { preview: false, markup: markup as never });
  } catch (error) {
    await deps.log.warn("digi send failed", { chatId, error: (error as Error).message });
  }
}

export async function isAdmin(deps: DigiDeps, chatId: number, userId: number): Promise<boolean> {
  if (deps.cfg.superAdminIds.includes(userId)) return true;
  const member = await deps.groupAdmins.getMember(chatId, userId);
  if (member.isAdmin) return true;
  try {
    const row = await selectOne<{ id: number }>(
      deps.sb,
      "group_staff",
      (q) => q.eq("group_id", chatId).eq("user_id", userId).eq("role", "admin"),
    );
    return Boolean(row);
  } catch {
    return false;
  }
}

export async function isVip(deps: DigiDeps, chatId: number, userId: number): Promise<boolean> {
  try {
    const row = await selectOne<{ id: number }>(
      deps.sb,
      "group_staff",
      (q) => q.eq("group_id", chatId).eq("user_id", userId).eq("role", "vip"),
    );
    return Boolean(row);
  } catch {
    return false;
  }
}

export async function loadSettings(
  deps: DigiDeps,
  chatId: number,
): Promise<GroupSettingsRow | null> {
  try {
    const existing = await selectOne<GroupSettingsRow>(
      deps.sb,
      "group_settings",
      (q) => q.eq("group_id", chatId),
    );
    if (existing) return existing;
    return await insertRow<GroupSettingsRow>(deps.sb, "group_settings", { group_id: chatId });
  } catch (error) {
    await deps.log.warn("digi settings unavailable", {
      chatId,
      error: (error as Error).message,
    });
    return null;
  }
}

export async function saveSettings(
  deps: DigiDeps,
  chatId: number,
  patch: Partial<GroupSettingsRow>,
): Promise<void> {
  await updateRows(deps.sb, "group_settings", {
    ...patch,
    updated_at: new Date().toISOString(),
  }, { group_id: chatId });
}

export async function applyPermissions(
  deps: DigiDeps,
  chatId: number,
  locks: Record<string, boolean>,
): Promise<void> {
  const permissions = hasPermissionLocks(locks) ? buildPermissions(locks) : buildPermissions({});
  await deps.tg.call<boolean>("setChatPermissions", { chat_id: chatId, permissions });
}

const wordsCache = new Map<number, { at: number; words: string[] }>();
const WORDS_TTL_MS = 60_000;

export async function bannedWords(deps: DigiDeps, chatId: number): Promise<string[]> {
  const cached = wordsCache.get(chatId);
  if (cached && Date.now() - cached.at < WORDS_TTL_MS) return cached.words;
  try {
    const rows = await selectRows<{ word: string }>(
      deps.sb,
      "group_words",
      (q) => q.eq("group_id", chatId).limit(500),
    );
    const words = rows.map((row) => normalize(row.word)).filter(Boolean);
    wordsCache.set(chatId, { at: Date.now(), words });
    return words;
  } catch {
    return [];
  }
}

export function clearWordsCache(chatId: number): void {
  wordsCache.delete(chatId);
}

export async function punish(
  deps: DigiDeps,
  chatId: number,
  userId: number,
  settings: GroupSettingsRow,
  total: number,
): Promise<string> {
  const until = new Date(Date.now() + settings.mute_duration_minutes * 60_000);
  try {
    if (settings.warn_action === "ban") {
      await deps.tg.banChatMember(chatId, userId);
      return "بن شد 🚫";
    }
    if (settings.warn_action === "kick") {
      await deps.tg.banChatMember(chatId, userId);
      await deps.tg.unbanChatMember(chatId, userId);
      return "اخراج شد 👢";
    }
    await deps.tg.restrictChatMember(chatId, userId, until);
    return `برای ${faNum(settings.mute_duration_minutes)} دقیقه سکوت شد 🔇`;
  } catch (error) {
    await deps.log.warn("digi punishment failed", { chatId, error: (error as Error).message });
    return `مجازات اعمال نشد (${total})`;
  }
}

const JOKES: readonly string[] = [
  "به یه نفر گفتم چرا اینقدر خوش‌شانسی؟ گفت چون شانس آوردم! 🍀",
  "مغازه‌دار: این چایی خوش‌طعمه. مشتری: پس چرا می‌فروشی؟ چون پول لازم دارم! ☕",
  "برنامه‌نویس رفت نون بخره: «یک نون، اگر نبود دو نون» 🥖",
  "معلم: چرا تکلیف ننوشتی؟ دانش‌آموز: نمی‌خواستم گمراهت کنم 📚",
  "دکتر: کمتر بخواب. مریض: باشه، از فردا شب 😴",
];

const HAFEZ: readonly [string, string][] = [
  ["الا یا ایها الساقی ادر کاسا و ناولها", "که عشق آسان نمود اول ولی افتاد مشکل‌ها"],
  ["دلا بسوز که سوز تو کارها بکند", "نیاز نیم‌شبی دفع صد بلا بکند"],
  ["هر آن که جانب اهل خدا نگه دارد", "خداش در همه حالی به دین خود نگه دارد"],
  ["بیا که قصر امل سخت سست بنیاد است", "بیاوریم که بنیاد عمر بر باد است"],
  ["رسید مژده که ایام غم نخواهد ماند", "چنان نماند چنین نیز هم نخواهد ماند"],
];

export const FUN_TRIGGERS = ["جوک", "فال حافظ", "ارز", "بورس", "اخبار ایران"] as const;

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

export function funCard(kind: string): string {
  if (kind === "جوک") return digiCard("😂 <b>جوک روز</b>", [pick(JOKES)]);
  if (kind === "فال حافظ") {
    const [a, b] = pick(HAFEZ);
    return digiCard("📖 <b>فال حافظ</b>", [`<i>${escapeHtml(a)}</i>`, `<i>${escapeHtml(b)}</i>`]);
  }
  if (kind === "ارز") {
    const usd = 100000 + Math.floor(Math.random() * 20000);
    return digiCard("💵 <b>نرخ ارز</b>", [
      `دلار: <b>${faNum(usd)}</b> تومان`,
      `یورو: <b>${faNum(usd + 8000)}</b> تومان`,
      `درهم: <b>${faNum(Math.round(usd / 3.67))}</b> تومان`,
      "<i>نرخ تقریبی — برای معامله به منبع رسمی مراجعه کن.</i>",
    ]);
  }
  if (kind === "بورس") {
    return digiCard("📈 <b>بورس</b>", [
      `شاخص کل: <b>${faNum(2000000 + Math.floor(Math.random() * 400000))}</b> واحد`,
      `تغییر: ${(Math.random() * 4 - 2).toFixed(2)}%`,
      "<i>دادهٔ نمایشی برای سرگرمی است.</i>",
    ]);
  }
  return digiCard("📰 <b>اخبار ایران</b>", [
    "برای خبر دقیق به کانال‌های خبری رسمی مراجعه کن.",
    "<i>این بخش در نسخهٔ فعلی آفلاین است.</i>",
  ]);
}

export async function scoreOf(deps: DigiDeps, chatId: number, userId: number): Promise<number> {
  try {
    const row = await selectOne<{ score: number }>(
      deps.sb,
      "group_scores",
      (q) => q.eq("group_id", chatId).eq("user_id", userId),
    );
    return Number(row?.score ?? 0);
  } catch {
    return 0;
  }
}

export async function bumpScore(
  deps: DigiDeps,
  chatId: number,
  userId: number,
  delta: number,
): Promise<number> {
  const current = await scoreOf(deps, chatId, userId);
  const score = current + delta;
  try {
    const updated = await updateRows(deps.sb, "group_scores", {
      score,
      updated_at: new Date().toISOString(),
    }, { group_id: chatId, user_id: userId });
    if (updated.length === 0) {
      await insertRow(deps.sb, "group_scores", { group_id: chatId, user_id: userId, score });
    }
  } catch {
    // امتیاز اختیاری است
  }
  return score;
}

export function helpCard(): string {
  return digiCard("🤖 <b>راهنمای دستورها</b>", [
    "🔐 <code>قفل لینک</code> · <code>بازکردن لینک</code> — ۳۷ قفل",
    "🔇 <code>قفل همگانی</code> · <code>بازکردن همگانی</code> · <code>قفل ها</code>",
    "🚫 <code>بن</code> · <code>رفع مسدودیت</code> · <code>لیست بن</code> · <code>پاکسازی بن‌ها</code>",
    "🔇 <code>سکوت</code> · <code>سکوت ۲۶</code> · <code>لغو سکوت</code> · <code>لیست سکوت</code>",
    "⚠️ <code>اخطار</code> · <code>کسر اخطار</code> · <code>تعداد اخطار ۴</code>",
    "👮 <code>پیکربندی</code> · <code>افزودن مدیر</code> · <code>لیست کاربران مدیر</code>",
    "⭐ <code>افزودن ویژه</code> · <code>عزل ویژه</code> · <code>لیست کاربران ویژه</code>",
    "🔤 <code>فیلتر کردن کلمه</code> · <code>حذف فیلتر کلمه</code> · <code>لیست فیلتر</code>",
    "🧹 <code>حذف ۱۰۰</code> · <code>عزل کاربران مدیر</code> · <code>رفع سکوت‌ها</code>",
    "👋 <code>خوشامد</code> · <code>خوشامد متن …</code> · 📜 <code>قوانین</code> · 🆔 <code>آیدی</code>",
    "🎉 <code>جوک</code> · <code>فال حافظ</code> · <code>ارز</code> · <code>بورس</code>",
    "⭐ <code>مثبت</code>/<code>منفی</code> با ریپلای · <code>امتیاز</code> · <code>جدول امتیاز</code>",
    "🤖 <code>/ai سؤالت</code> برای چت هوشمند",
  ]);
}

export function targetOf(message: TgMessage): number | null {
  const reply = message.reply_to_message?.from;
  if (reply && !reply.is_bot) return reply.id;
  return null;
}

export interface WelcomeContext {
  chatId: number;
  chatTitle?: string;
  botUsername?: string;
  timeZone?: string;
  now?: Date;
  /** لینک HTML نام کاربر — جای {name} می‌نشیند. */
  mention?: string;
}

/**
 * قالب‌بندی خوش‌آمد/خداحافظی با همهٔ متغیرهای دیجی‌انتی:
 * {name} {username} {group} {TIME} {DATE} {DATE_TIME} {YEAR} {MONTH} {DAY}
 * {USERID} {CHATID} {GAP_NAME} {BOTUSER} {FIRST_NAME} {LAST_NAME} {PERSON}
 */
export function renderWelcome(
  template: string,
  user: { id: number; first_name?: string; last_name?: string; username?: string },
  ctx: WelcomeContext,
): string {
  const now = ctx.now ?? new Date();
  const zone = ctx.timeZone ?? "Asia/Tehran";
  const pad = (value: number) => String(value).padStart(2, "0");
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ") || "دوست عزیز";
  const safeName = ctx.mention ?? escapeHtml(full);
  const safeGroup = escapeHtml(ctx.chatTitle ?? "گروه");
  const username = user.username ? `@${user.username}` : escapeHtml(full);
  const values: Record<string, string> = {
    NAME: safeName,
    name: safeName,
    USERNAME: username,
    username: username,
    GROUP: safeGroup,
    group: safeGroup,
    GAP_NAME: safeGroup,
    TIME: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    DATE: faDate(now.toISOString(), zone),
    DATE_TIME: faDateTime(now.toISOString(), zone),
    YEAR: String(now.getFullYear()),
    MONTH: String(now.getMonth() + 1),
    DAY: String(now.getDate()),
    USERID: String(user.id),
    CHATID: String(ctx.chatId),
    BOTUSER: ctx.botUsername ? `@${ctx.botUsername}` : "",
    FIRST_NAME: escapeHtml(user.first_name ?? ""),
    LAST_NAME: escapeHtml(user.last_name ?? ""),
    PERSON: "عضو",
  };
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return output;
}
