/**
 * قفل‌های گروه — ۳۷ قفل دیجی‌انتی در دو لایه:
 *   permission: با setChatPermissions روی گروه اعمال می‌شود.
 *   content   : ربات پیام را می‌خواند و در صورت تطابق حذف/جریمه می‌کند.
 * خالص و بدون شبکه تا قابل تست باشد.
 */
import type { TgMessage } from "./core.ts";

export type LockKind = "permission" | "content";

export interface LockDef {
  key: string;
  label: string;
  emoji: string;
  kind: LockKind;
}

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

/** نام‌های فارسی که در دستور متنی «قفل …» پذیرفته می‌شوند. */
const ALIASES: Record<string, string[]> = {
  all: ["همگانی", "همه", "کل", "گروه"],
  tabchi: ["تبچی", "تبچی ها", "تبلیغ"],
  link: ["لینک", "لینک ها", "لینکها"],
  hyperlink: ["هایپر", "هایپرلینک"],
  photo: ["عکس", "تصویر", "عکس ها"],
  slash: ["اسلش", "اسلش ها"],
  username: ["یوزرنیم", "یوزر", "یوزرنیم ها", "یوزرنیم‌ها"],
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
  system: ["پیام سیستمی", "سیستمی", "پیام سیستم"],
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

function plain(value: string): string {
  return value
    .replace(/[‌‎‏]/g, " ")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[«»"'،,:؛!؟?.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function lockKey(name: string): string | null {
  const wanted = plain(name);
  if (!wanted) return null;
  for (const [key, aliases] of Object.entries(ALIASES)) {
    if (aliases.some((alias) => plain(alias) === wanted)) return key;
  }
  return lockKeyByLabel(wanted);
}

function lockKeyByLabel(wanted: string): string | null {
  const found = LOCK_DEFS.find((def) => plain(`${def.emoji} ${def.label}`) === wanted);
  return found?.key ?? null;
}

export function normalizeLocks(raw: unknown): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const def of LOCK_DEFS) {
    if ((raw as Record<string, unknown>)[def.key] === true) result[def.key] = true;
  }
  return result;
}

export const ALL_PERMISSIONS: Record<string, boolean> = {
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
  can_invite_users: true,
};

export function buildPermissions(locks: Record<string, boolean>): Record<string, boolean> {
  const permissions = { ...ALL_PERMISSIONS };
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

export function normalizeFa(value: string): string {
  return value
    .replace(/[‌‎‏ً-ْٰ]/g, " ")
    .replace(/[؀-ۿ]/g, (char) => CHAR_MAP[char] ?? char)
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

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
  "بی ناموس",
  "تخم سگ",
];

const LINK_RE = /(https?:\/\/|www\.|t\.me\/|telegram\.me\/|tg:\/\/)/i;
const MENTION_RE = /(^|\s)@[A-Za-z][A-Za-z0-9_]{3,31}/;
const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_]{2,}/u;
const ENGLISH_RE = /^[\s\p{P}\p{N}A-Za-z]+$/u;
const PERSIAN_RE = /[؀-ۿ]/;
const PHONE_RE = /(?:️\+98|0098|0)?9\d{9}/;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const TABCHI_RE = /(تبلیغ|تبچی|کانال ما|جوین|عضو شوید|تبادل)/;
const LONG_CHARS = 700;

export interface Violation {
  key: string;
  label: string;
}

export function detectViolation(
  message: TgMessage,
  locks: Record<string, boolean>,
): Violation | null {
  if (Object.keys(locks).length === 0) return null;

  const text = message.text ?? message.caption ?? "";
  const normalized = normalizeFa(text);
  const entities = [...(message.entities ?? []), ...(message.caption_entities ?? [])];
  const types = new Set(entities.map((entity) => entity.type));
  const hit = (key: string): Violation | null =>
    locks[key] ? { key, label: LOCK_LABELS[key] ?? key } : null;

  if (locks.tabchi && TABCHI_RE.test(normalized)) return hit("tabchi");
  if (locks.link && (LINK_RE.test(text) || types.has("url") || types.has("text_link"))) {
    return hit("link");
  }
  if (locks.hyperlink && types.has("text_link")) return hit("hyperlink");
  if (locks.photo && message.photo) return hit("photo");
  if (locks.slash && /(^|\s)\//.test(text)) return hit("slash");
  if (locks.username && (types.has("mention") || MENTION_RE.test(text))) return hit("username");
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
  if (locks.hashtag && (types.has("hashtag") || HASHTAG_RE.test(text))) return hit("hashtag");
  if (locks.emoji && (EMOJI_RE.test(text) || types.has("custom_emoji"))) return hit("emoji");
  if (locks.system && (message.new_chat_members || message.left_chat_member)) {
    return hit("system");
  }
  if (locks.edit && message.edit_date) return hit("edit");
  if (locks.number && PHONE_RE.test(normalized.replace(/[\s-]/g, ""))) return hit("number");
  if (locks.tg_game && (message.game || message.dice)) return hit("tg_game");
  if (locks.location && (message.location || message.venue)) return hit("location");
  if (locks.video_note && message.video_note) return hit("video_note");
  if (locks.code && (types.has("code") || types.has("pre"))) return hit("code");
  if (locks.english && text.length >= 4 && ENGLISH_RE.test(text)) return hit("english");
  if (locks.mention && types.has("text_mention")) return hit("mention");
  if (locks.persian && PERSIAN_RE.test(text)) return hit("persian");
  if (locks.bold && types.has("bold")) return hit("bold");
  if (locks.italic && types.has("italic")) return hit("italic");
  if (locks.glass_button && (message.reply_markup?.inline_keyboard?.length ?? 0) > 0) {
    return hit("glass_button");
  }
  if (locks.reply && message.reply_to_message) return hit("reply");
  if (locks.long && text.length > LONG_CHARS) return hit("long");
  if (
    locks.curse &&
    PROFANITY_ROOTS.some((root) => normalized.includes(normalizeFa(root)))
  ) {
    return hit("curse");
  }
  if (locks.poll && message.poll) return hit("poll");
  if (locks.text && text.length > 0) return hit("text");
  return null;
}

// ─── ضدفیشینگ ────────────────────────────────────────────────────────────────

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

export function isPhishing(text: string): boolean {
  if (!text) return false;
  const normalized = normalizeFa(text);
  if (PHISH_DOMAINS.some((domain) => normalized.includes(domain))) return true;
  if (!URL_RE.test(text) && !URL_RE.test(normalized)) return false;
  return PHISH_WORDS.some((word) => normalized.includes(normalizeFa(word)));
}
