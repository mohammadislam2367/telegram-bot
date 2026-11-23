/**
 * 🧠 Offline Brain — موتور محلی ربات برای وقتی Gemini در دسترس نیست
 * (اتمام سهمیه، قطعی شبکه، بدون کلید API).
 *
 * کارهای واقعی انجام می‌دهد، نه فقط پاسخ آماده: ساعت/تاریخ شمسی، محاسبه‌ی
 * عبارت ریاضی، شیر یا خط، تاس، انتخاب تصادفی، ساخت رمز، پیشنهاد انیمه و معرفی.
 * کاملاً بدون شبکه و بدون eval؛ همیشه یک پاسخ قطعی برمی‌گرداند یا null.
 */

import { faNum } from "./texts.ts";

export type OfflineCategory =
  | "about"
  | "help"
  | "time"
  | "date"
  | "math"
  | "random"
  | "password"
  | "anime_pick"
  | "quote";

export interface OfflineAnswer {
  text: string;
  category: OfflineCategory;
}

export interface OfflineOptions {
  timeZone?: string;
  now?: Date;
  botUsername?: string;
  ownerName?: string;
  ownerId?: number;
}

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

function toLatinDigits(value: string): string {
  return value
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

function normalizeLetters(value: string): string {
  return value
    .replace(/[\u200c\u200e\u200f\u064b-\u0652\u0670]/g, " ")
    .replace(/[\u0600-\u06FF]/g, (char) => CHAR_MAP[char] ?? char)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function randomBelow(maxExclusive: number): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] % maxExclusive;
}

function pickOne<T>(items: readonly T[]): T {
  return items[randomBelow(items.length)];
}

function faTime(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(11, 19);
  }
}

function faJalaliDate(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      timeZone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function gregorianDate(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

// ─── calculator (recursive descent, no eval) ─────────────────────────────────

function evaluateExpression(source: string): number | null {
  const expression = source.replace(/\s+/g, "");
  if (expression.length === 0 || expression.length > 80) return null;

  let index = 0;
  const peek = (): string | undefined => expression[index];

  function parseSum(): number | null {
    let left = parseProduct();
    if (left === null) return null;
    while (peek() === "+" || peek() === "-") {
      const operator = expression[index++];
      const right = parseProduct();
      if (right === null) return null;
      left = operator === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseProduct(): number | null {
    let left = parsePower();
    if (left === null) return null;
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const operator = expression[index++];
      const right = parsePower();
      if (right === null) return null;
      if (operator === "/" && right === 0) return null;
      if (operator === "*") left = left * right;
      else if (operator === "/") left = left / right;
      else left = left % right;
    }
    return left;
  }

  function parsePower(): number | null {
    const base = parseAtom();
    if (base === null) return null;
    if (peek() === "^") {
      index++;
      const exponent = parsePower();
      if (exponent === null) return null;
      return Math.pow(base, exponent);
    }
    return base;
  }

  function parseAtom(): number | null {
    const current = peek();
    if (current === "(") {
      index++;
      const inner = parseSum();
      if (inner === null || peek() !== ")") return null;
      index++;
      return inner;
    }
    if (current === "-") {
      index++;
      const value = parseAtom();
      return value === null ? null : -value;
    }
    if (current === "+") {
      index++;
      return parseAtom();
    }
    const start = index;
    while (index < expression.length && /[0-9.]/.test(expression[index])) index++;
    if (index === start) return null;
    const value = Number(expression.slice(start, index));
    return Number.isFinite(value) ? value : null;
  }

  const result = parseSum();
  if (result === null || index !== expression.length || !Number.isFinite(result)) return null;
  return result;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const rounded = Number(value.toFixed(6));
  return String(rounded);
}

const MATH_NOISE = [
  "چند میشه",
  "چقدر میشه",
  "محاسبه کن",
  "حساب کن",
  "چقدره",
  "چنده",
  "بگو",
  "چند",
  "میشه",
  "؟",
  "?",
  "=",
  "کن",
];

// ترتیب مهم است: عبارت‌های چندکلمه‌ای قبل از تک‌کلمه‌ای‌ها تبدیل می‌شوند.
const MATH_WORDS: [RegExp, string][] = [
  [/به\s*علاوه|بعلاوه|جمع/g, "+"],
  [/منهای|منها|تفریق/g, "-"],
  [/ضرب\s*در|ضربدر|ضرب/g, "*"],
  [/تقسیم\s*بر|تقسیم/g, "/"],
  [/به\s*توان|توان/g, "^"],
];

/** اگر ورودی یک عبارت ریاضی بود، نتیجه را برمی‌گرداند. */
export function solveMath(input: string): number | null {
  let text = normalizeLetters(toLatinDigits(input));
  for (const noise of MATH_NOISE) text = text.split(noise).join(" ");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;

  const percent = text.match(/(\d+(?:\.\d+)?)\s*درصد\s*(?:از\s*)?(\d+(?:\.\d+)?)/);
  if (percent) {
    return (Number(percent[1]) / 100) * Number(percent[2]);
  }

  const root = text.match(/جذر\s*(\d+(?:\.\d+)?)/);
  if (root) return Math.sqrt(Number(root[1]));

  for (const [pattern, replacement] of MATH_WORDS) text = text.replace(pattern, replacement);
  text = text.replace(/\s+/g, "");
  if (!/[+\-*/%^]/.test(text)) return null;
  if (!/^[0-9+\-*/%^().]+$/.test(text)) return null;
  return evaluateExpression(text);
}

// ─── random tools ────────────────────────────────────────────────────────────

const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*";

function buildPassword(length = 16): string {
  let password = "";
  for (let i = 0; i < length; i++) {
    password += PASSWORD_ALPHABET[randomBelow(PASSWORD_ALPHABET.length)];
  }
  return password;
}

const COIN_FACES = ["🪙 شیر", "🪙 خط"];

// ─── anime picker data ───────────────────────────────────────────────────────

const ANIME_PICKS: readonly string[] = [
  "Attack on Titan — اکشن، فانتزی تاریک (2013)",
  "Fullmetal Alchemist: Brotherhood — ماجراجویی، اکشن (2009)",
  "Death Note — تریلر روانی (2006)",
  "Steins;Gate — علمی‌تخیلی، سفر در زمان (2011)",
  "Code Geass — مکا، درام سیاسی (2006)",
  "Cowboy Bebop — فضایی، وسترن (1998)",
  "Hunter x Hunter (2011) — ماجراجویی، شونن",
  "Vinland Saga — تاریخی، درام (2019)",
  "Mob Psycho 100 — اکشن، کمدی (2016)",
  "One Punch Man — اکشن، طنز (2015)",
  "Demon Slayer — اکشن، فانتزی (2019)",
  "Jujutsu Kaisen — اکشن، ماورایی (2020)",
  "Frieren: Beyond Journey's End — فانتزی، آرام (2023)",
  "Violet Evergarden — درام، احساسی (2018)",
  "A Silent Voice — فیلم، درام مدرسه (2016)",
  "Spirited Away — فیلم، فانتزی (2001)",
  "Your Name — فیلم، عاشقانه (2016)",
  "Haikyuu!! — ورزشی (2014)",
  "Bocchi the Rock! — موسیقی، کمدی (2022)",
  "Chainsaw Man — اکشن، خونین (2022)",
  "Spy x Family — کمدی، خانوادگی (2022)",
  "Monster — تریلر روانی (2004)",
  "Psycho-Pass — سایبرپانک، پلیسی (2012)",
  "Made in Abyss — ماجراجویی، تاریک (2017)",
  "Solo Leveling — اکشن، فانتزی (2024)",
  "Dandadan — اکشن، کمدی (2024)",
  "Berserk (1997) — فانتزی تاریک",
  "Erased — معمایی، سفر در زمان (2016)",
];

const QUOTES: readonly string[] = [
  "«هر روزی که تمرین نکنی، یک روز از رقیبت عقب‌تری.»",
  "«شکست پایان کار نیست؛ پایان تلاش است.»",
  "«آرزو بدون برنامه فقط یک جمله است.»",
  "«بهترین زمان برای شروع، همین حالاست.»",
  "«سختی‌ها می‌گذرند، آنچه ساخته‌ای می‌ماند.»",
  "«اگر می‌خواهی سریع بروی تنها برو، اگر می‌خواهی دور بروی با هم برو.»",
  "«انیمه‌ای که نگاهش می‌کنی داستان کسی است که تسلیم نشد.»",
  "«کوچک شروع کن، اما شروع کن.»",
];

const HELP_LINES: readonly string[] = [
  "⚡ <b>حالت آفلاین فعال است</b> — بدون هوش مصنوعی هم این کارها را انجام می‌دهم:",
  "",
  "🕒 ساعت و تاریخ شمسی: «ساعت چنده» / «تاریخ امروز»",
  "🧮 محاسبه: «۱۲۵۰ * ۴» یا «۲۰ درصد ۵۰۰» یا «۲ به توان ۱۰»",
  "🎲 تصادفی: «شیر یا خط» / «تاس» / «بین ۱ تا ۹۰ یک عدد بده»",
  "🔐 رمز امن: «رمز بساز»",
  "🍿 پیشنهاد انیمه: «یه انیمه پیشنهاد بده»",
  "💬 جمله انگیزشی: «یه جمله بگو»",
  "📚 جستجوی واقعی انیمه: <code>/anime نام انیمه</code>",
  "📰 اخبار: /news",
  "",
  "همین‌طور به بیش از ۱۰۰ پرسش متداول از دانش ذخیره‌شده پاسخ می‌دهم.",
];

// ─── matchers ────────────────────────────────────────────────────────────────

function aboutAnswer(options: OfflineOptions): OfflineAnswer {
  const bot = options.botUsername ? `@${options.botUsername}` : "این ربات";
  const owner = options.ownerName
    ? options.ownerId
      ? `<a href="tg://user?id=${options.ownerId}">${options.ownerName}</a>`
      : options.ownerName
    : null;

  return {
    category: "about",
    text: [
      `🤖 من دستیار هوشمند ${bot} هستم؛ مدیر Anime Click Ultimate.`,
      owner ? `👑 صاحب و مالک این ربات: ${owner}` : "",
      "",
      "کارهای روزمره را حتی بدون اینترنت و هوش مصنوعی انجام می‌دهم:",
      "ساعت/تاریخ، محاسبه، انتخاب تصادفی، پیشنهاد انیمه و پاسخ به سوالات متداول.",
      "",
      "برای دیدن همه‌ی توانایی‌ها بنویس: <b>چیکار می‌کنی</b>",
    ].filter(Boolean).join("\n"),
  };
}

export function offlineAnswer(
  input: string,
  options: OfflineOptions = {},
): OfflineAnswer | null {
  const raw = input.trim();
  if (raw.length === 0) return null;

  const text = normalizeLetters(toLatinDigits(raw));
  if (text.length === 0) return null;
  const timeZone = options.timeZone || "Asia/Tehran";
  const now = options.now ?? new Date();

  // معرفی و صاحب ربات
  if (
    /(کی هستی|تو کی|اسمت|خودت رو معرفی|خودت را معرفی|who are you|your name|صاحب|مالک|owner|ادمین ربات|مدیر ربات)/
      .test(
        text,
      )
  ) {
    return aboutAnswer(options);
  }

  // توانایی‌ها
  if (
    /(چیکار|چه کار|قابلیت|چی بلدی|چه بلدی|help|راهنما|دستورات|چه کاری)/.test(text)
  ) {
    return { category: "help", text: HELP_LINES.join("\n") };
  }

  // ساعت
  if (/(ساعت چند|ساعت چنده|چه ساعتی|الان ساعت|time now|what time)/.test(text)) {
    return {
      category: "time",
      text: `🕒 ساعت به وقت ${timeZone}: <b>${faTime(now, timeZone)}</b>`,
    };
  }

  // تاریخ
  if (/(تاریخ|امروز چندم|چه روزی|چه تاریخ|today|date)/.test(text)) {
    return {
      category: "date",
      text: [
        `📅 امروز: <b>${faJalaliDate(now, timeZone)}</b>`,
        `🗓 میلادی: ${gregorianDate(now, timeZone)}`,
      ].join("\n"),
    };
  }

  // رمز ساز
  if (/(پسورد|رمز عبور|رمز بساز|password|generate.*pass)/.test(text)) {
    return {
      category: "password",
      text: [
        "🔐 رمز تصادفی امن:",
        `<code>${buildPassword()}</code>`,
        "",
        "<i>این رمز فقط یک‌بار نمایش داده می‌شود؛ جای امنی ذخیره‌اش کن.</i>",
      ].join("\n"),
    };
  }

  // شیر یا خط / تاس / عدد تصادفی / انتخاب
  if (/(شیر یا خط|شیروخط|coin ?flip|heads or tails)/.test(text)) {
    return { category: "random", text: `نتیجه: <b>${pickOne(COIN_FACES)}</b>` };
  }

  if (/(تاس|dice|d6)/.test(text)) {
    const sides = /(\d+)\s*ضلعی|d(\d+)/.exec(text);
    const max = Math.min(Math.max(Number(sides?.[1] ?? sides?.[2] ?? 6), 2), 100);
    return {
      category: "random",
      text: `🎲 تاس (${faNum(max)} وجهی): <b>${faNum(randomBelow(max) + 1)}</b>`,
    };
  }

  const range = text.match(/بین\s*(\d+)\s*(?:تا|و|-)\s*(\d+)/);
  if (range && /(عدد|رقم|number|random)/.test(text)) {
    const low = Math.min(Number(range[1]), Number(range[2]));
    const high = Math.max(Number(range[1]), Number(range[2]));
    if (high > low) {
      return {
        category: "random",
        text: `🎯 عدد تصادفی بین ${faNum(low)} و ${faNum(high)}: <b>${
          faNum(low + randomBelow(high - low + 1))
        }</b>`,
      };
    }
  }

  if (/(عدد تصادفی|random number)/.test(text)) {
    return {
      category: "random",
      text: `🎯 عدد تصادفی: <b>${faNum(randomBelow(100) + 1)}</b>`,
    };
  }

  const choose = raw.match(/^(.{2,60}?)\s+یا\s+(.{2,60})$/s);
  if (choose && /(انتخاب|قرعه|کدوم|بهتره|choose|pick|or)/.test(text)) {
    const left = choose[1].trim();
    const right = choose[2].trim();
    const winner = randomBelow(2) === 0 ? left : right;
    return {
      category: "random",
      text: `🎯 انتخاب من: <b>${escapeText(winner)}</b>\n<i>گزینه‌های دیگر: ${
        escapeText(
          winner === left ? right : left,
        )
      }</i>`,
    };
  }

  // پیشنهاد انیمه
  if (/(انیمه پیشنهاد|پیشنهاد انیمه|یه انیمه|یک انیمه|چی ببینم|what to watch)/.test(text)) {
    return {
      category: "anime_pick",
      text: [
        "🍿 پیشنهاد امروز:",
        `<b>${pickOne(ANIME_PICKS)}</b>`,
        "",
        "برای اطلاعات کامل: <code>/anime نام انیمه</code>",
      ].join("\n"),
    };
  }

  // جمله انگیزشی
  if (/(جمله|نقل قول|انگیزشی|یه حرف|quote)/.test(text)) {
    return { category: "quote", text: `💬 ${pickOne(QUOTES)}` };
  }

  // ریاضی (آخر از همه، چون سخت‌گیرانه‌ترین شرط را دارد)
  const result = solveMath(raw);
  if (result !== null) {
    return {
      category: "math",
      text: `🧮 نتیجه: <b>${faNum(Number(formatNumber(result)))}</b>`,
    };
  }

  return null;
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function offlineCapabilities(): readonly string[] {
  return ["time", "date", "math", "random", "password", "anime_pick", "quote", "help", "about"];
}
