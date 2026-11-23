/** 🧰 ابزارهای آفلاین — بدون شبکه و بدون هوش مصنوعی، همیشه سریع. */

export type CalcResult = { ok: true; value: number } | { ok: false; error: string };

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function normalizeExpr(input: string): string {
  let out = "";
  for (const ch of input) {
    const fa = FA_DIGITS.indexOf(ch);
    if (fa >= 0) {
      out += String(fa);
      continue;
    }
    const ar = AR_DIGITS.indexOf(ch);
    if (ar >= 0) {
      out += String(ar);
      continue;
    }
    if (ch === "×" || ch === "x" || ch === "X") out += "*";
    else if (ch === "÷") out += "/";
    else if (ch === "−" || ch === "–" || ch === "—") out += "-";
    else if (ch === "،" || ch === "," || ch === " " || ch === "\t" || ch === "\u200c") continue;
    else out += ch;
  }
  return out;
}

/** ماشین‌حساب امن: فقط + - * / % ^ و پرانتز. هیچ کدی اجرا نمی‌شود. */
export function safeCalc(input: string): CalcResult {
  const src = normalizeExpr(input);
  if (!src) return { ok: false, error: "عبارت خالی است." };
  if (src.length > 120) return { ok: false, error: "عبارت خیلی طولانی است." };
  if (!/^[0-9+\-*/%^().]+$/.test(src)) {
    return { ok: false, error: "فقط عدد و عملگرهای + - * / % ^ مجاز است." };
  }

  let i = 0;
  const peek = (): string => src[i];

  function parseExpr(): number {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = src[i++];
      const right = parseTerm();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parsePower();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = src[i++];
      const right = parsePower();
      if (op === "*") value *= right;
      else if (op === "/") {
        if (right === 0) throw new Error("تقسیم بر صفر ممکن نیست.");
        value /= right;
      } else {
        if (right === 0) throw new Error("تقسیم بر صفر ممکن نیست.");
        value %= right;
      }
    }
    return value;
  }

  function parsePower(): number {
    const base = parseUnary();
    if (peek() === "^") {
      i++;
      return Math.pow(base, parsePower());
    }
    return base;
  }

  function parseUnary(): number {
    if (peek() === "-") {
      i++;
      return -parseUnary();
    }
    if (peek() === "+") {
      i++;
      return parseUnary();
    }
    return parseAtom();
  }

  function parseAtom(): number {
    if (peek() === "(") {
      i++;
      const value = parseExpr();
      if (peek() !== ")") throw new Error("پرانتزها بسته نشده‌اند.");
      i++;
      return value;
    }
    const start = i;
    while (i < src.length && /[0-9.]/.test(src[i])) i++;
    if (start === i) throw new Error("عبارت نامعتبر است.");
    const num = Number(src.slice(start, i));
    if (!Number.isFinite(num)) throw new Error("عدد نامعتبر است.");
    return num;
  }

  try {
    const value = parseExpr();
    if (i !== src.length) throw new Error("عبارت نامعتبر است.");
    if (!Number.isFinite(value)) throw new Error("نتیجه بی‌نهایت شد.");
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** عدد را خوانا و کوتاه نشان می‌دهد. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded);
}

export interface ClockInfo {
  weekday: string;
  date: string;
  time: string;
  zone: string;
}

/** ساعت و تاریخ شمسی بدون هیچ درخواست شبکه‌ای. */
export function clockInfo(now: Date = new Date(), timeZone = "Asia/Tehran"): ClockInfo {
  try {
    const dateFmt = new Intl.DateTimeFormat("fa-IR", {
      timeZone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const timeFmt = new Intl.DateTimeFormat("fa-IR", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    return {
      weekday: dateFmt.formatToParts(now).find((p) => p.type === "weekday")?.value ?? "",
      date: dateFmt.format(now),
      time: timeFmt.format(now),
      zone: timeZone,
    };
  } catch {
    return {
      weekday: "",
      date: now.toISOString().slice(0, 10),
      time: now.toISOString().slice(11, 19),
      zone: "UTC",
    };
  }
}

/** عدد تصادفی صحیح در بازه‌ی بسته. */
export function randomInt(min: number, max: number, rand: () => number = Math.random): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return lo + Math.floor(rand() * (hi - lo + 1));
}

/** یک مورد تصادفی از فهرست. */
export function pickOne<T>(items: readonly T[], rand: () => number = Math.random): T | null {
  if (items.length === 0) return null;
  const index = Math.min(items.length - 1, Math.floor(rand() * items.length));
  return items[index];
}

export interface TextStats {
  chars: number;
  charsNoSpace: number;
  words: number;
  lines: number;
  readingSeconds: number;
}

/** آمار ساده‌ی یک متن — مفید برای نویسنده‌ها. */
export function textStats(text: string): TextStats {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  const charsNoSpace = trimmed.replace(/\s/g, "").length;
  return {
    chars: text.length,
    charsNoSpace,
    words,
    lines: text.split("\n").length,
    readingSeconds: Math.max(1, Math.round(words / 3)),
  };
}
