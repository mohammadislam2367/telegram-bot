/**
 * 🔐 قفل‌های تفکیکی گروه — دیجی‌انتی‌وار.
 *
 * دو لایه دارد:
 *  ۱) قفل‌های مجوزی: با setChatPermissions روی خود گروه اعمال می‌شوند
 *     (پیام، عکس، ویدیو، فایل، ویس، آهنگ، استیکر/گیف، نظرسنجی، پیش‌نمایش لینک).
 *  ۲) قفل‌های محتوایی: ربات پیام را می‌خواند و اگر با قفل بخورد حذف/جریمه می‌کند
 *     (لینک، یوزرنیم، هشتگ، فوروارد، فحاشی، پیام طولانی، انگلیسی، مخاطب، لوکیشن، ربات).
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

/** ترتیب همین آرایه، ترتیب دکمه‌های پنل است. */
export const LOCK_DEFS: readonly LockDef[] = [
  { key: "all", label: "همگانی", emoji: "🔇", kind: "permission" },
  { key: "link", label: "لینک", emoji: "🔗", kind: "content" },
  { key: "photo", label: "عکس", emoji: "🖼", kind: "permission" },
  { key: "video", label: "ویدیو", emoji: "🎬", kind: "permission" },
  { key: "file", label: "فایل", emoji: "📎", kind: "permission" },
  { key: "sticker", label: "استیکر/گیف", emoji: "🎭", kind: "permission" },
  { key: "voice", label: "ویس", emoji: "🎙", kind: "permission" },
  { key: "music", label: "آهنگ", emoji: "🎵", kind: "permission" },
  { key: "poll", label: "نظرسنجی", emoji: "📊", kind: "permission" },
  { key: "preview", label: "پیش‌نمایش لینک", emoji: "👁", kind: "permission" },
  { key: "username", label: "یوزرنیم/منشن", emoji: "📣", kind: "content" },
  { key: "hashtag", label: "هشتگ", emoji: "#️⃣", kind: "content" },
  { key: "forward", label: "فوروارد", emoji: "📤", kind: "content" },
  { key: "curse", label: "فحاشی", emoji: "🤬", kind: "content" },
  { key: "long", label: "پیام طولانی", emoji: "📜", kind: "content" },
  { key: "english", label: "انگلیسی", emoji: "🔤", kind: "content" },
  { key: "contact", label: "مخاطب", emoji: "👤", kind: "content" },
  { key: "location", label: "لوکیشن", emoji: "📍", kind: "content" },
  { key: "bot", label: "پیام ربات", emoji: "🤖", kind: "content" },
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
  if (locks.sticker) permissions.can_send_other_messages = false;
  if (locks.voice) permissions.can_send_voice_notes = false;
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
const PROFANITY_ROOTS: readonly string[] = [
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

const LONG_MESSAGE_CHARS = 700;

function entitiesOf(message: TgMessage): { type: string }[] {
  return [...(message.entities ?? []), ...(message.caption_entities ?? [])];
}

function messageText(message: TgMessage): string {
  return message.text ?? message.caption ?? "";
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

  if (locks.link) {
    const hasLink = LINK_RE.test(text) || entityTypes.has("url") || entityTypes.has("text_link");
    if (hasLink) return hit("link");
  }

  if (locks.photo && message.photo) return hit("photo");
  if (locks.video && (message.video || message.video_note)) return hit("video");
  if (locks.file && message.document) return hit("file");
  if (locks.sticker && (message.sticker || message.animation || message.dice || message.game)) {
    return hit("sticker");
  }
  if (locks.voice && message.voice) return hit("voice");
  if (locks.music && message.audio) return hit("music");
  if (locks.poll && message.poll) return hit("poll");

  if (locks.username) {
    const hasMention = entityTypes.has("mention") || MENTION_RE.test(text);
    if (hasMention) return hit("username");
  }

  if (locks.hashtag) {
    const hasHashtag = entityTypes.has("hashtag") || HASHTAG_RE.test(text);
    if (hasHashtag) return hit("hashtag");
  }

  if (
    locks.forward && (message.forward_origin || message.forward_date) &&
    !message.is_automatic_forward
  ) {
    return hit("forward");
  }

  if (locks.curse) {
    const found = PROFANITY_ROOTS.some((root) => normalized.includes(normalizePersian(root)));
    if (found) return hit("curse");
  }

  if (locks.long && text.length > LONG_MESSAGE_CHARS) return hit("long");

  if (locks.english && text.length >= 4 && ENGLISH_RE.test(text)) {
    return hit("english");
  }

  if (locks.contact && message.contact) return hit("contact");
  if (locks.location && (message.location || message.venue)) return hit("location");
  if (locks.bot && message.via_bot) return hit("bot");

  return null;
}

/** برای پیام‌های پنل: خلاصهٔ قفل‌های روشن. */
export function locksSummary(settings: GroupSettingsRow): string {
  const locks = normalizeLocks(settings.locks);
  const labels = lockedLabels(locks);
  if (labels.length === 0) return "🔓 همه باز";
  return `${labels.length} قفل: ${labels.join(" • ")}`;
}
