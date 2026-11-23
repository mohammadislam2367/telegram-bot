/**
 * 🚨 تشخیص توهین — فقط برای پیام‌هایی که مستقیم به ربات هستند استفاده می‌شود،
 * تا گفت‌وگوی عادی اعضا به اشتباه اخطار نگیرد.
 */

const FA_WORDS: readonly string[] = [
  "کص",
  "کصکش",
  "کصخل",
  "کیری",
  "کیر",
  "کونی",
  "کون",
  "جنده",
  "مادرجنده",
  "حرومزاده",
  "حروم‌زاده",
  "دیوث",
  "خارکسه",
  "خارکسده",
  "گوه",
  "گوهخور",
  "آشغال",
  "احمق",
  "خنگ",
  "ابله",
  "بیشعور",
  "نفهم",
  "پدرسگ",
  "لاشی",
  "عوضی",
  "مزخرف",
];

const EN_WORDS: readonly string[] = [
  "fuck",
  "fucking",
  "fucker",
  "motherfucker",
  "shit",
  "bitch",
  "bastard",
  "asshole",
  "cunt",
  "dick",
  "idiot",
  "moron",
  "stupid",
  "dumbass",
];

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

export function normalizeForProfanity(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u200c\u200e\u200f\u064b-\u0652\u0670]/g, " ")
    .replace(/[\u0600-\u06FF]/g, (char) => CHAR_MAP[char] ?? char)
    .replace(/[^0-9a-z\u0600-\u06FF]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** آیا متن توهین/فحش دارد؟ تطبیق کلمه‌به‌کلمه، نه زیررشته‌ی تصادفی. */
export function containsProfanity(value: string): boolean {
  const normalized = normalizeForProfanity(value);
  if (normalized.length === 0) return false;

  const tokens = new Set(normalized.split(" "));
  for (const word of FA_WORDS) {
    if (word.includes(" ")) {
      if (normalized.includes(normalizeForProfanity(word))) return true;
      continue;
    }
    if (tokens.has(word)) return true;
  }
  for (const word of EN_WORDS) {
    if (tokens.has(word)) return true;
  }
  return false;
}

/**
 * آیا پیام مستقیم به ربات است؟ (ریپلای روی پیام ربات یا منشن یوزرنیم ربات)
 */
export function isDirectedAtBot(
  message: { text?: string; caption?: string; reply_to_message?: { from?: { is_bot?: boolean } } },
  botUsername: string,
): boolean {
  if (message.reply_to_message?.from?.is_bot === true) return true;
  const text = `${message.text ?? ""} ${message.caption ?? ""}`;
  if (text.length === 0) return false;
  if (text.toLowerCase().includes(`@${botUsername.toLowerCase()}`)) return true;
  // \b در جاوااسکریپت حروف فارسی را word نمی‌شمارد، پس مرز کلمه را دستی می‌سازیم.
  const botWord = /(?:^|[^\u0600-\u06FFa-zA-Z])(?:ربات|بات|bot)(?:[^\u0600-\u06FFa-zA-Z]|$)/i;
  return botWord.test(text) && containsProfanity(text);
}
