/**
 * ⚡ کلمات آماده — ذخیره و یکسان‌سازی کلمات از پیش تعیین‌شدهٔ مدیر.
 *
 * کلمات داخلی (بیو، ساعت، …) در کد هستند؛ کلماتی که مدیر از پنل اضافه می‌کند
 * در bot_settings با کلید preset_keywords به‌صورت آرایه‌ای از { word, text }
 * نگه داشته می‌شوند.
 */
import type { SettingsStore } from "./settings.ts";

export const PRESET_SETTINGS_KEY = "preset_keywords";
export const MAX_CUSTOM_PRESETS = 40;
export const MAX_PRESET_WORD = 30;
export const MAX_PRESET_REPLY = 500;

export interface CustomPreset {
  /** کلمهٔ یکسان‌شده (بدون اعراب/علامت/حروف عربی). */
  word: string;
  /** متنی که ربات همان لحظه می‌فرستد. */
  text: string;
}

const CHAR_FIX: Record<string, string> = {
  "ي": "ی",
  "ك": "ک",
  "ۀ": "ه",
  "ة": "ه",
  "أ": "ا",
  "إ": "ا",
  "آ": "ا",
  "ٱ": "ا",
  "ؤ": "و",
  "ئ": "ی",
};

/** یکسان‌سازی متن برای تطبیق دقیق کلمهٔ آماده (نیم‌فاصله، اعراب، عربی/فارسی، فاصله‌ها). */
export function normalizePresetWord(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u200c\u200e\u200f]/g, " ")
    .replace(/[\u064b-\u0652\u0670]/g, "")
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[\u0600-\u06ff]/g, (char) => CHAR_FIX[char] ?? char)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** کلمهٔ آماده را برای ذخیره آماده می‌کند (یکسان‌شده و کوتاه‌شده). */
export function sanitizePresetWord(input: string): string {
  return normalizePresetWord(input).slice(0, MAX_PRESET_WORD);
}

/** مقدار خام bot_settings را به فهرست معتبر تبدیل می‌کند. */
export function readCustomPresets(value: unknown): CustomPreset[] {
  if (!Array.isArray(value)) return [];
  const items: CustomPreset[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { word?: unknown; text?: unknown };
    const word = sanitizePresetWord(String(row.word ?? ""));
    const text = String(row.text ?? "").trim().slice(0, MAX_PRESET_REPLY);
    if (word.length < 2 || text.length === 0) continue;
    if (items.some((item) => item.word === word)) continue;
    items.push({ word, text });
    if (items.length >= MAX_CUSTOM_PRESETS) break;
  }
  return items;
}

/** فهرست کلمات آمادهٔ سفارشی را از تنظیمات می‌خواند. */
export async function loadCustomPresets(settings: SettingsStore): Promise<CustomPreset[]> {
  const all = await settings.all();
  return readCustomPresets(all[PRESET_SETTINGS_KEY]);
}
