/**
 * Smart Fallback engine — تطبیق کلیدواژه‌ای مقاوم برای زمانی که Gemini
 * در دسترس نیست (429/سهمیه/خطا). بدون تکرار بی‌نهایت و بدون وابستگی شبکه.
 */
import { FALLBACK_ENTRIES, type FallbackEntry, type FallbackLanguage } from "./fallback_data.ts";

export interface FallbackMatch {
  id: string;
  category: string;
  answer: string;
  score: number;
  language: FallbackLanguage;
}

// نویسه‌های عربی → فارسی، حذف اعراب و علائم
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
  "\u200c": " ",
};

const STOP_WORDS = new Set([
  "از",
  "به",
  "با",
  "در",
  "که",
  "این",
  "آن",
  "را",
  "و",
  "یا",
  "برای",
  "یه",
  "یک",
  "the",
  "a",
  "an",
  "is",
  "are",
  "of",
  "to",
  "in",
  "and",
  "or",
  "me",
  "about",
  "for",
]);

export function normalizeQuery(input: string): string {
  let text = input.toLowerCase().trim();
  text = text.replace(/[\u064B-\u0652\u0670\u0640]/g, "");
  text = text.replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  text = text.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  text = text.replace(/[\u0600-\u06FF]/g, (char) => CHAR_MAP[char] ?? char);
  text = text.replace(/[^\p{L}\p{N}\s]/gu, " ");
  return text.replace(/\s+/g, " ").trim();
}

export function detectLanguage(input: string): "fa" | "en" {
  // اگر حتی یک حرف فارسی/عربی در پرسش باشد، پاسخ فارسی می‌دهیم.
  return /[\u0600-\u06FF]/.test(input) ? "fa" : "en";
}

function tokenize(normalized: string): Set<string> {
  return new Set(
    normalized
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  );
}

function scoreEntry(entry: FallbackEntry, normalized: string, tokens: Set<string>): number {
  let score = 0;
  for (const keyword of entry.keywords) {
    const kw = normalizeQuery(keyword);
    if (!kw) continue;

    if (normalized === kw) {
      score += 6;
      continue;
    }
    if (normalized.includes(kw)) {
      score += kw.includes(" ") ? 4 : 2.5;
      continue;
    }

    const kwTokens = kw.split(" ").filter((token) => token.length > 1);
    if (kwTokens.length > 0 && kwTokens.every((token) => tokens.has(token))) {
      score += 3;
      continue;
    }
    if (kwTokens.some((token) => tokens.has(token))) {
      score += 1;
    }
  }
  return score;
}

export interface FindFallbackOptions {
  language?: "fa" | "en";
  minScore?: number;
}

/** بهترین پاسخ ذخیره‌شده برای پرسش؛ اگر چیزی پیدا نشد null. */
export function findFallback(
  input: string,
  options: FindFallbackOptions = {},
): FallbackMatch | null {
  const normalized = normalizeQuery(input);
  if (normalized.length === 0) return null;

  const tokens = tokenize(normalized);
  const language = options.language ?? detectLanguage(input);
  const minScore = options.minScore ?? 2.5;

  let best: FallbackMatch | null = null;
  for (const entry of FALLBACK_ENTRIES) {
    let score = scoreEntry(entry, normalized, tokens);
    if (score === 0) continue;
    if (entry.language === language) score += 0.75;
    else if (entry.language !== "both" && entry.language !== language) score -= 0.5;

    if (!best || score > best.score) {
      best = {
        id: entry.id,
        category: entry.category,
        answer: entry.answer,
        score,
        language: entry.language,
      };
    }
  }

  if (!best || best.score < minScore) return null;
  return best;
}

/** پاسخ عمومی وقتی هیچ تطبیقی پیدا نشد (همیشه قابل ارائه). */
export function genericFallback(language: "fa" | "en" = "fa"): string {
  if (language === "en") {
    return [
      "I don't have a saved answer for this exact question right now.",
      "",
      "You can:",
      "• Use /anime &lt;title&gt; to look up an anime",
      "• Check /news for the latest posts",
      "• Contact support for a human reply",
    ].join("\n");
  }
  return [
    "در حال حاضر پاسخ آماده‌ای برای این سوال ندارم.",
    "",
    "می‌توانی:",
    "• با <code>/anime نام انیمه</code> اطلاعات بگیر",
    "• با /news آخرین خبرها را ببینی",
    "• برای پاسخ انسانی با پشتیبانی تماس بگیری",
  ].join("\n");
}

export function fallbackCount(): number {
  return FALLBACK_ENTRIES.length;
}

export { fallbackCategories } from "./fallback_data.ts";

/** عنوان‌های شناخته‌شده برای غنی‌سازی پاسخ با Jikan. */
export const KNOWN_TITLE_KEYWORDS: readonly string[] = [
  "اتک آن تایتان",
  "attack on titan",
  "دیمن اسلیر",
  "demon slayer",
  "جوجوتسو",
  "jujutsu",
  "وان پیس",
  "one piece",
  "ناروتو",
  "naruto",
  "فول متال",
  "fullmetal",
  "دث نوت",
  "death note",
  "استینز گیت",
  "steins gate",
  "کد گیاس",
  "code geass",
  "کابوی بیباپ",
  "cowboy bebop",
  "هانتر هانتر",
  "hunter x hunter",
  "مای هیرو",
  "my hero academia",
  "توکیو غول",
  "tokyo ghoul",
  "بلچ",
  "bleach",
  "هایکیو",
  "haikyuu",
  "ویولت",
  "violet evergarden",
  "شکل صدا",
  "a silent voice",
  "فریرن",
  "frieren",
  "چینساومن",
  "chainsaw man",
  "اسپای فامیلی",
  "spy x family",
  "وینلند",
  "vinland",
  "وان پانچ",
  "one punch man",
  "سولو لولینگ",
  "solo leveling",
  "داندادان",
  "dandadan",
  "مونستر",
  "monster",
  "بوچی",
  "bocchi",
  "اوشی نو کو",
  "oshi no ko",
  "برزرک",
  "berserk",
];

export function looksLikeAnimeInfoQuery(input: string): boolean {
  const normalized = normalizeQuery(input);
  if (normalized.length === 0) return false;
  if (
    /\b(انیمه|anime|مال|mal|jikan)\b/.test(normalized) &&
    /(چیه|چیست|اطلاعات|معرفی|خلاصه|درباره|info|about|what is|who is)/.test(normalized)
  ) {
    return true;
  }
  return KNOWN_TITLE_KEYWORDS.some((keyword) => normalized.includes(normalizeQuery(keyword)));
}
