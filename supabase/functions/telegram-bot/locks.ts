/**
 * 🔐 قفل‌های تفکیکی گروه — مجموعهٔ کامل دیجی‌انتی (۳۷ قفل).
 *
 * دو لایه:
 *  ۱) قفل‌های مجوزی: با setChatPermissions روی خود گروه اعمال می‌شوند.
 *  ۲) قفل‌های محتوایی: ربات پیام/موجودیت‌ها را می‌خواند و در صورت تطابق
 *     پیام را حذف و طبق تنظیمات جریمه می‌کند.
 *
 * همه‌چیز خالص و بدون شبکه است تا قابل تست باشد.
 */
import type { GroupSettingsRow, TgMessage } from "../_shared/types.ts";

export type LockKind = "permission" | "content";

export interface LockDef {
  key: string;
  label: string;
  emoji: string;
  kind: LockKind;
}

/** ترتیب همین آرایه، ترتیب نمایش در پنل است (مثل فهرست دیجی). */
export const LOCK_DEFS: readonly LockDef[] = [
  { key: "all", label: "همگانی", emoji: "🔇", kind: "permission" },
  { key: "tabchi", label: "تبچی", emoji: "📢", kind: "content" },
  { key: "link", label: "لینک", emoji: "🔗", kind: "content" },
  { key: "hyperlink", label: "هایپر", emoji: "🔵", kind: "content" },
  { key: "photo", label: "عکس", emoji: "🖼", kind: "permission" },
  { key: "slash", label: "اسلش", emoji: "➗", kind: "content" },
  { key: "username", label: "یوزرنیم", emoji: "📣", kind: "content" },
  { key: "sticker", label: "استیکر", emoji: "🎭", kind: "permission" },
  { key: "video", label: "ویدیو", emoji: "🎬", kind: "permission" },
  { key: "voice", label: "ویس", emoji: "🎙", kind: "permission" },
  { key: "music", label: "موزیک", emoji: "🎵", kind: "permission" },
  { key: "forward", label: "فروارد", emoji: "📤", kind: "content" },
  { key: "gif", label: "گیف", emoji: "🌀", kind: "content" },
  { key: "bot", label: "ربات", emoji: "🤖", kind: "content" },
  { key: "file", label: "فایل", emoji: "📎", kind: "permission" },
  { key: "hashtag", label: "هشتگ", emoji: "#️⃣", kind: "content" },
  { key: "emoji", label: "ایموجی", emoji: "😀", kind: "content" },
  { key: "system", label: "پیام سیستمی", emoji: "⚙️", kind: "content" },
  { key: "edit", label: "ویرایش", emoji: "✏️", kind: "content" },
  { key: "number", label: "شماره", emoji: "🔢", kind: "content" },
  { key: "tg_game", label: "بازی تلگرامی", emoji: "🎮", kind: "content" },
  { key: "location", label: "لوکیشن", emoji: "📍", kind: "content" },
  { key: "video_note", label: "ویدیو مسیج", emoji: "⭕", kind: "content" },
  { key: "code", label: "کد متن", emoji: "💻", kind: "content" },
  { key: "english", label: "انگلیسی", emoji: "🔤", kind: "content" },
  { key: "mention", label: "منشن", emoji: "👥", kind: "content" },
  { key: "persian", label: "فارسی", emoji: "🅰️", kind: "content" },
  { key: "bold", label: "بولد", emoji: "🅱️", kind: "content" },
  { key: "italic", label: "ایتالیک", emoji: "ℹ️", kind: "content" },
  { key: "glass_button", label: "دکمه شیشه‌ای", emoji: "🔘", kind: "content" },
  { key: "text", label: "متن", emoji: "📝", kind: "content" },
  { key: "reply", label: "ریپلی", emoji: "↩️", kind: "content" },
  { key: "long", label: "پیام طولانی", emoji: "📜", kind: "content" },
  { key: "curse", label: "فحاشی", emoji: "🤬", kind: "content" },
  { key: "poll", label: "نظرسنجی", emoji: "📊", kind: "permission" },
  { key: "app", label: "اپلیکیشن", emoji: "📱", kind: "content" },
  { key: "preview", label: "پیش‌نمایش لینک", emoji: "👁", kind: "permission" },
];

export const LOCK_LABELS: Record<string, string> = Object.fromEntries(
  LOCK_DEFS.map((def) => [def.key, `${def.emoji} ${def.label}`]),
);

/** قفل‌ها در ستون jsonb ذخیره می‌شوند؛ هر شکل غیرمنتظره‌ای نادیده گرفته می‌شود. */
export function normalizeLocks(raw: unknown): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const def of LOCK_DEFS) {
    const value = (raw as Record<string, unknown>)[def.key];
    if (value === true) result[def.key] = true;
  }
  return result;
}

export function isLocked(locks: Record<string, boolean>, key: string): boolean {
  return locks[key] === true;
}

export function lockedLabels(locks: Record<string, boolean>): string[] {
  return LOCK_DEFS.filter((def) => locks[def.key]).map((def) => `${def.emoji} ${def.label}`);
}

// ─── لایهٔ مجوزها ────────────────────────────────────────────────────────────

export const ALL_PERMISSIONS = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
} as const;

export type ChatPermissions = Record<string, boolean>;

/** ترکیب قفل‌ها به یک شیء مجوز تلگرام. قفل «همگانی» بقیه را بی‌اثر می‌کند. */
export function buildPermissions(locks: Record<string, boolean>): ChatPermissions {
  const permissions: ChatPermissions = { ...ALL_PERMISSIONS };
  if (locks.all) {
    for (const key of Object.keys(permissions)) permissions[key] = false;
    return permissions;
  }
  if (locks.photo) permissions.can_send_photos = false;
  if (locks.video) permissions.can_send_videos = false;
  if (locks.file) permissions.can_send_documents = false;
  if (locks.sticker || locks.gif) permissions.can_send_other_messages = false;
  if (locks.voice) permissions.can_send_voice_notes = false;
  if (locks.video_note) permissions.can_send_video_notes = false;
  if (locks.music) permissions.can_send_audios = false;
  if (locks.poll) permissions.can_send_polls = false;
  if (locks.preview) permissions.can_add_web_page_previews = false;
  return permissions;
}

/** آیا با این قفل‌ها باید setChatPermissions صدا زده شود؟ */
export function hasPermissionLocks(locks: Record<string, boolean>): boolean {
  return LOCK_DEFS.some((def) => def.kind === "permission" && locks[def.key]);
}

// ─── لایهٔ محتوا ─────────────────────────────────────────────────────────────

const CHAR_MAP: Record<string, string> = {
  "ي": "ی",
  "ى": "ی",
  "ك": "ک",
  "ۀ": "ه",
  "ة": "ه",
  "أ": "ا",
  "إ": "ا",
  "آ": "ا",
  "ؤ": "و",
  "ئ": "ی",
};

export function normalizePersian(value: string): string {
  return value
    .replace(/[\u200c\u200e\u200f\u064b-\u0652\u0670]/g, " ")
    .replace(/[\u0600-\u06FF]/g, (char) => CHAR_MAP[char] ?? char)
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** ریشه‌های رایج فحاشی فارسی؛ فقط برای تشخیص، نه نمایش. */
export const PROFANITY_ROOTS: readonly string[] = [
  "کیر",
  "کوس",
  "کسکش",
  "کص",
  "کونی",
  "جنده",
  "قحبه",
  "حرومی",
  "حرومزاده",
  "مادرخراب",
  "خواهرجنده",
  "سکس",
  "گایید",
  "گایدم",
  "کیرم",
  "دوسگ",
  "پدرسگ",
  "مادرسگ",
  "اشغال",
  "بی ناموس",
  "ناموس فروش",
  "تخم سگ",
];

export interface ContentViolation {
  key: string;
  label: string;
}

const LINK_RE = /(https?:\/\/|www\.|t\.me\/|telegram\.me\/|tg:\/\/)/i;
const MENTION_RE = /(^|\s)@[A-Za-z][A-Za-z0-9_]{3,31}/;
const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_]{2,}/u;
const ENGLISH_RE = /^[\s\p{P}\p{N}A-Za-z]+$/u;
const PERSIAN_RE = /[\u0600-\u06FF]/;
const PHONE_RE = /(?:\+98|0098|0)?9\d{9}/;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const TABCHI_RE = /(تبلیغ|تبچی|کانال ما|جوین|عضو شوید|تبادل)/;

const LONG_MESSAGE_CHARS = 700;

function entitiesOf(message: TgMessage): { type: string }[] {
  return [...(message.entities ?? []), ...(message.caption_entities ?? [])];
}

function messageText(message: TgMessage): string {
  return message.text ?? message.caption ?? "";
}

function hasMarkup(message: TgMessage): boolean {
  const markup = (message as unknown as { reply_markup?: { inline_keyboard?: unknown[] } })
    .reply_markup;
  return Array.isArray(markup?.inline_keyboard) && markup.inline_keyboard.length > 0;
}

/**
 * اگر پیام با یکی از قفل‌های محتوایی بخورد، همان قفل را برمی‌گرداند.
 * ترتیب بررسی، ترتیب LOCK_DEFS است تا نتیجهٔ تست‌ها پایدار بماند.
 */
export function detectContentLock(
  message: TgMessage,
  locks: Record<string, boolean>,
): ContentViolation | null {
  if (Object.keys(locks).length === 0) return null;

  const text = messageText(message);
  const normalized = normalizePersian(text);
  const entities = entitiesOf(message);
  const entityTypes = new Set(entities.map((entity) => entity.type));

  const hit = (key: string): ContentViolation | null => {
    if (!locks[key]) return null;
    return { key, label: LOCK_LABELS[key] ?? key };
  };

  if (locks.tabchi && TABCHI_RE.test(normalized)) return hit("tabchi");

  if (locks.link) {
    const hasLink = LINK_RE.test(text) || entityTypes.has("url") || entityTypes.has("text_link");
    if (hasLink) return hit("link");
  }

  if (locks.hyperlink && entityTypes.has("text_link")) return hit("hyperlink");
  if (locks.photo && message.photo) return hit("photo");
  if (locks.slash && /(^|\s)\//.test(text)) return hit("slash");

  if (locks.username) {
    const hasUsername = entityTypes.has("mention") || MENTION_RE.test(text);
    if (hasUsername) return hit("username");
  }

  if (locks.sticker && message.sticker) return hit("sticker");
  if (locks.video && message.video) return hit("video");
  if (locks.voice && message.voice) return hit("voice");
  if (locks.music && message.audio) return hit("music");

  if (
    locks.forward && (message.forward_origin || message.forward_date) &&
    !message.is_automatic_forward
  ) {
    return hit("forward");
  }

  if (locks.gif && message.animation) return hit("gif");
  if (locks.bot && (message.via_bot || message.from?.is_bot)) return hit("bot");
  if (locks.file && message.document) return hit("file");

  if (locks.hashtag) {
    const hasHashtag = entityTypes.has("hashtag") || HASHTAG_RE.test(text);
    if (hasHashtag) return hit("hashtag");
  }

  if (locks.emoji && (EMOJI_RE.test(text) || entityTypes.has("custom_emoji"))) return hit("emoji");
  const pinned = (message as unknown as { pinned_message?: unknown }).pinned_message;
  if (locks.system && (message.new_chat_members || message.left_chat_member || pinned)) {
    return hit("system");
  }

  if (locks.edit && (message as unknown as { edit_date?: number }).edit_date) return hit("edit");

  if (locks.number && PHONE_RE.test(normalized.replace(/[\s-]/g, ""))) return hit("number");
  if (locks.tg_game && (message.game || message.dice)) return hit("tg_game");
  if (locks.location && (message.location || message.venue)) return hit("location");
  if (locks.video_note && message.video_note) return hit("video_note");

  if (locks.code && (entityTypes.has("code") || entityTypes.has("pre"))) return hit("code");

  if (locks.english && text.length >= 4 && ENGLISH_RE.test(text)) return hit("english");
  if (locks.mention && entityTypes.has("text_mention")) return hit("mention");
  if (locks.persian && PERSIAN_RE.test(text)) return hit("persian");
  if (locks.bold && entityTypes.has("bold")) return hit("bold");
  if (locks.italic && entityTypes.has("italic")) return hit("italic");
  if (locks.glass_button && hasMarkup(message)) return hit("glass_button");
  if (locks.reply && message.reply_to_message) return hit("reply");
  if (locks.long && text.length > LONG_MESSAGE_CHARS) return hit("long");

  if (locks.curse) {
    const found = PROFANITY_ROOTS.some((root) => normalized.includes(normalizePersian(root)));
    if (found) return hit("curse");
  }

  if (locks.poll && message.poll) return hit("poll");
  if (
    locks.app &&
    (entityTypes.has("web_app_data") ||
      (message as unknown as { web_app_data?: unknown }).web_app_data)
  ) {
    return hit("app");
  }
  if (locks.text && text.length > 0) return hit("text");

  return null;
}

// ─── ضدفیشینگ ───────────────────────────────────────────────────────────────

/** دامنه‌های تقلیدی که در کمپین‌های فیشینگ تلگرام دیده می‌شوند. */
const PHISH_DOMAINS: readonly string[] = [
  "telegrom",
  "telegrarn",
  "teligram",
  "telegraam",
  "telgram",
  "tlgrm",
  "tcl.me",
  "telegram-login",
  "telegramlogin",
];

/** عبارت‌های طعمهٔ رایج کلاهبرداری فارسی. */
const PHISH_WORDS: readonly string[] = [
  "جایزه",
  "قرعه",
  "برنده شو",
  "برنده شدی",
  "ارمغان",
  "هدیه رایگان",
  "دو برابر",
  "چند برابر",
  "کلیک کن",
  "پروکسی رایگان",
  "ولت رایگان",
  "شارژ رایگان",
  "کد تایید",
  "کد ورود",
  "رمز کارت",
  "درگاه پرداخت",
  "افزایش ممبر",
  "فالوور رایگان",
];

const URL_RE =
  /(?:https?:\/\/|www\.)[^\s]+|(?:[a-z0-9-]+\.)+(?:ir|com|net|org|me|xyz|top|site|online|app|io|co|info|biz|shop)\b/i;

/**
 * تشخیص پیام فیشینگ/کلاهبرداری: دامنهٔ تقلیدی، یا لینک همراه با عبارت طعمه.
 * پیام‌های معمولی و لینک‌های بی‌خطر false می‌گیرند.
 */
export function isPhishing(text: string): boolean {
  if (!text) return false;
  const normalized = normalizePersian(text);
  if (PHISH_DOMAINS.some((domain) => normalized.includes(domain))) return true;
  if (!URL_RE.test(text) && !URL_RE.test(normalized)) return false;
  return PHISH_WORDS.some((word) => normalized.includes(normalizePersian(word)));
}

/** برای پیام‌های پنل: خلاصهٔ قفل‌های روشن. */
export function locksSummary(settings: GroupSettingsRow): string {
  const locks = normalizeLocks(settings.locks);
  const labels = lockedLabels(locks);
  if (labels.length === 0) return "🔓 همه باز";
  return `${labels.length} قفل: ${labels.join(" • ")}`;
}
