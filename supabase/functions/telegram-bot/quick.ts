/**
 * ⚡ دستورهای سریع — کارت معرفی (/bio)، انتشار خبر در کانال (/publish) و
 * منوی بازی (u:gm). هیچ‌کدام منتظر دیتابیس کاربر نمی‌مانند، پس پاسخ فوری است.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../_shared/config.ts";
import type { TelegramApi } from "../_shared/telegram.ts";
import type { SettingsStore } from "../_shared/settings.ts";
import type { Logger } from "../_shared/logger.ts";
import type { TgCallbackQuery, TgMessage, TgUser } from "../_shared/types.ts";
import { backButton, keyboard, urlButton } from "../_shared/keyboards.ts";
import { divider, sectionTitle } from "../_shared/texts.ts";
import { escapeHtml } from "../_shared/validation.ts";
import { offlineAnswer } from "../_shared/offline_brain.ts";
import { getSession } from "../_shared/sessions.ts";
import type { SlidingWindowLimiter } from "../_shared/rate_limit.ts";
import { type CustomPreset, loadCustomPresets, normalizePresetWord } from "../_shared/presets.ts";

export { normalizePresetWord };

export interface QuickDeps {
  cfg: AppConfig;
  sb: SupabaseClient;
  tg: TelegramApi;
  settings: SettingsStore;
  log: Logger;
  limiter?: SlidingWindowLimiter;
}

/** فهرست دستورهایی که در منوی رسمی تلگرام نشان داده می‌شوند. */
export const BOT_COMMANDS: { command: string; description: string }[] = [
  { command: "start", description: "شروع و منوی اصلی" },
  { command: "games", description: "بازی و سرگرمی" },
  { command: "quiz", description: "کوییز انیمه با گزینه" },
  { command: "bio", description: "کارت معرفی (با ریپلای روی پیام)" },
  { command: "me", description: "بیوی من در یک نگاه" },
  { command: "toolbox", description: "جعبه‌ابزار سریع: حساب، ساعت، شانس" },
  { command: "calc", description: "ماشین‌حساب سریع" },
  { command: "time", description: "ساعت و تاریخ" },
  { command: "lock", description: "قفل گروه (مدیران)" },
  { command: "unlock", description: "باز کردن گروه (مدیران)" },
  { command: "anime", description: "جستجوی انیمه" },
  { command: "rules", description: "قوانین گروه" },
  { command: "id", description: "شناسهٔ من و گروه" },
  { command: "report", description: "گزارش تخلف" },
];

const TAGLINES: readonly string[] = [
  "تماشاگر حرفه‌ای فصل‌های پشت‌سرهم 🍿",
  "شکارچی انیمه‌های کم‌دیده 🎯",
  "عاشق پایان‌های غافلگیرکننده 🌀",
  "طرفدار آثار فانتزی و ماجراجویی 🗺",
  "منتقد سخت‌گیر استودیوها 🎬",
  "هوادار موسیقی متن‌های حماسی 🎵",
  "دنبال‌کنندهٔ مانگای اصلی 📚",
  "بازیکن شب‌های بی‌خواب 😴",
  "طرفدار شخصیت‌های خاکستری 🌗",
  "عضو باشگاه «فقط یک قسمت دیگر» ⏱",
  "عاشق انیمه‌های کوتاه و پرمعنا ✨",
  "کاربری که همه را می‌شناسد 🕵️",
  "کلکسیونر پایان‌های تلخ و شیرین 🎭",
  "طرفدار انیمه‌های ورزشی و انگیزشی 🏐",
  "عاشق طراحی شخصیت و رنگ‌بندی 🎨",
  "کسی که اوست را از مانگا خوانده 📖",
  "هوادار دوبلهٔ فارسی قدیمی 📼",
  "عضو تیم «فصل بعدی حتماً می‌بینم» 📅",
  "شکارچی OSTهای کمیاب 🎧",
  "طرفدار انیمه‌های سایبرپانک و نئون 🌃",
];

function presetGreeting(): string {
  return [
    sectionTitle("👋 سلام!"),
    "من دستیار سریع این گفتگو هستم؛ هر کلمه بگویی، همان لحظه جواب می‌دهم.",
    "",
    "🔥 امتحان کن: <b>بیو</b> · <b>ساعت</b> · <b>تاریخ</b> · <b>آیدی</b> · <b>تاس</b> · <b>جمله</b> · <b>پیشنهاد انیمه</b>",
  ].join("\n");
}

function presetAbout(botUsername: string): string {
  return [
    sectionTitle("🤖 معرفی کوتاه"),
    "دستیار سریع این گفتگو هستم: کلمات آماده، شناسه، ساعت، بیو و کمی سرگرمی — بدون معطلی و بدون فکر کردن.",
    "",
    "🧩 چت خصوصی باز کن و هر چیزی بپرس:",
    `<code>@${escapeHtml(botUsername)}</code>`,
  ].join("\n");
}

function presetPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const password = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return [
    sectionTitle("🔐 رمز پیشنهادی"),
    `<code>${escapeHtml(password)}</code>`,
    "",
    "<i>۱۶ نویسه: حرف بزرگ و کوچک، عدد و نماد. هر بار رمز تازه ساخته می‌شود.</i>",
  ].join("\n");
}

function presetRandom(): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  const hundred = 1 + (new DataView(bytes.buffer).getUint16(0) % 100);
  const six = 1 + (bytes[0] % 6);
  return [
    sectionTitle("🎲 عدد شانسی"),
    `بین ۱ تا ۱۰۰: <b>${hundred}</b>`,
    `تاس شش‌تایی: <b>${six}</b>`,
  ].join("\n");
}

export function taglineFor(seed: number): string {
  const index = Math.abs(Math.trunc(seed)) % TAGLINES.length;
  return TAGLINES[index];
}

/** یک متن بیوی آماده و خوانا برای همان کاربر (بدون هوش مصنوعی). */
export function bioSentence(user: TgUser): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
    "کاربر ناشناس";
  return `${name}؛ ${taglineFor(user.id)}`;
}

export function bioText(user: TgUser): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
    "کاربر ناشناس";
  return [
    sectionTitle("🧬 کارت معرفی"),
    `👤 نام: <b>${escapeHtml(name)}</b>`,
    user.username ? `🔗 نام کاربری: @${escapeHtml(user.username)}` : "🔗 نام کاربری: ندارد",
    `🆔 شناسه: <code>${user.id}</code>`,
    divider(),
    `💠 سبک: ${taglineFor(user.id)}`,
    `💬 بیو: ${escapeHtml(bioSentence(user))}`,
    "<i>برای گرفتن کارت یک نفر، روی پیامش ریپلای کن و /bio بزن.</i>",
  ].join("\n");
}

async function reply(
  deps: QuickDeps,
  chatId: number,
  text: string,
): Promise<void> {
  try {
    await deps.tg.sendMessage(chatId, text, { preview: false });
  } catch (error) {
    await deps.log.warn("quick reply failed", { chatId, error: (error as Error).message });
  }
}

function isOwner(deps: QuickDeps, userId: number | undefined): boolean {
  return Boolean(userId && deps.cfg.superAdminIds.includes(userId));
}

/** true یعنی همان‌جا جواب داده شد. */
export async function handleQuickMessage(deps: QuickDeps, message: TgMessage): Promise<boolean> {
  const text = (message.text ?? "").trim();
  if (!text.startsWith("/")) return false;

  const [head, ...restParts] = text.split(/\s+/);
  const command = head.slice(1).split("@")[0].toLowerCase();
  const args = restParts.join(" ").trim();
  const chatId = message.chat.id;

  if (command === "bio" || command === "me") {
    const target = message.reply_to_message?.from ?? message.from;
    if (!target) return true;
    await reply(deps, chatId, bioText(target));
    return true;
  }

  if (command === "publish") {
    if (!isOwner(deps, message.from?.id)) {
      await reply(deps, chatId, "⛔ این دستور فقط برای صاحب ربات است.");
      return true;
    }
    const replyText = message.reply_to_message?.text ?? message.reply_to_message?.caption ?? "";
    const body = (args || replyText).trim();
    if (!body) {
      await reply(
        deps,
        chatId,
        "متن خبر را بعد از دستور بنویس یا روی پیام ریپلای کن و /publish بزن.",
      );
      return true;
    }

    const target = (await deps.settings.get("channel_target")).trim();
    if (!target) {
      await reply(deps, chatId, "اول کانال انتشار را در داشبورد ربات تنظیم کن.");
      return true;
    }

    try {
      await deps.tg.sendMessage(target, body, { preview: false });
      await reply(deps, chatId, "✅ خبر در کانال منتشر شد.");
    } catch (error) {
      await deps.log.warn("publish failed", { target, error: (error as Error).message });
      await reply(deps, chatId, "❌ انتشار انجام نشد. دسترسی ربات در کانال را بررسی کن.");
    }
    return true;
  }

  return false;
}

/** دکمهٔ «بازی و سرگرمی» در منوی کاربر. */
export async function handleQuickCallback(
  deps: QuickDeps,
  cq: TgCallbackQuery,
): Promise<boolean> {
  if ((cq.data ?? "") !== "u:gm") return false;

  const text = [
    sectionTitle("🎮 بازی و سرگرمی"),
    divider(),
    "• /quiz — کوییز انیمه با گزینه‌ها",
    "• /dice — تاس",
    "• /coin — شیر یا خط",
    "• /rps سنگ | کاغذ | قیچی",
    "• /choose گزینه۱، گزینه۲",
    "• /8ball سؤالت",
    "",
    "<i>در گروه هم کار می‌کند؛ کافی است دستور را بفرستی.</i>",
  ].join("\n");

  try {
    await deps.tg.answerCallback(cq.id, "");
  } catch {
    // پاسخ به دکمه اختیاری است
  }

  const markup = keyboard([[
    backButton("u:m", "↩️ بازگشت"),
    { text: "🏠 منوی اصلی", callback_data: "u:m", style: "success" as const },
  ]]);
  const chatId = cq.message?.chat.id;
  if (chatId && cq.message) {
    try {
      await deps.tg.editMessageText(chatId, cq.message.message_id, text, {
        markup,
      });
      return true;
    } catch {
      // پیام قابل ویرایش نبود؛ نسخهٔ جدید فرستاده می‌شود
    }
  }
  if (chatId) await reply(deps, chatId, text);
  return true;
}

/** دکمهٔ «🧬 کارت معرفی» — بیوی کاربر در یک نگاه. */
export async function handleBioCallback(
  deps: QuickDeps,
  cq: TgCallbackQuery,
): Promise<boolean> {
  if ((cq.data ?? "") !== "u:bi") return false;

  try {
    await deps.tg.answerCallback(cq.id, "");
  } catch {
    // پاسخ به دکمه اختیاری است
  }

  const body = bioText(cq.from);
  const markup = keyboard([
    [backButton("u:m", "↩️ بازگشت"), {
      text: "🏠 منوی اصلی",
      callback_data: "u:m",
      style: "success" as const,
    }],
  ]);

  const chatId = cq.message?.chat.id;
  if (chatId && cq.message && cq.message.chat.type === "private") {
    try {
      await deps.tg.editMessageText(chatId, cq.message.message_id, body, {
        preview: false,
        markup,
      });
      return true;
    } catch {
      // پیام قابل ویرایش نبود؛ نسخهٔ جدید فرستاده می‌شود
    }
  }
  const target = chatId ?? cq.from.id;
  try {
    await deps.tg.sendMessage(target, body, { preview: false, markup });
  } catch (error) {
    await deps.log.warn("bio card failed", { chatId: target, error: (error as Error).message });
  }
  return true;
}

/** متن کارت معرفی برای دستور /me. */
export function bioCommandText(message: TgMessage): string | null {
  const head = (message.text ?? "").trim().split(/\s+/)[0] ?? "";
  const command = head.replace(/^\//, "").split("@")[0].toLowerCase();
  if (command !== "me") return null;
  return message.from ? bioText(message.from) : null;
}

// ─── کلیدواژه‌های آماده ───────────────────────────────────────────────────────
// چند کلمهٔ از پیش تعیین‌شده که ربات بدون فکر کردن، بدون هوش مصنوعی و بدون پیام
// «در حال فکر کردن» همان لحظه جواب می‌دهد. هم در گروه و هم در چت خصوصی کار می‌کند.

export type PresetId =
  | "bio"
  | "time"
  | "date"
  | "id"
  | "help"
  | "coin"
  | "dice"
  | "anime"
  | "quote"
  | "greeting"
  | "about"
  | "password"
  | "random";

const PRESET_WORDS: Record<PresetId, readonly string[]> = {
  bio: ["بیو", "بیوگرافی", "بیو من", "کارت معرفی", "bio", "biography"],
  time: ["ساعت", "ساعت چنده", "ساعت چند", "الان ساعت چنده", "وقت", "time"],
  date: ["تاریخ", "تاریخ امروز", "امروز چندمه", "چه روزیه", "date", "today"],
  id: ["ایدی", "ایدی من", "شناسه", "شناسه من", "id", "myid"],
  help: ["راهنما", "کمک", "دستورات", "چیکار میکنی", "چی بلدی", "help"],
  coin: ["شیر یا خط", "شیروخط", "سکه", "coin"],
  dice: ["تاس", "تاس بنداز", "dice"],
  anime: ["انیمه پیشنهاد", "پیشنهاد انیمه", "یه انیمه", "چی ببینم", "anime pick"],
  quote: ["جمله", "جمله انگیزشی", "یه جمله بگو", "نقل قول", "quote"],
  greeting: ["سلام", "درود", "سلام علیکم"],
  about: ["کی هستی", "تو کی هستی", "خودت رو معرفی کن", "معرفی ربات", "who are you"],
  password: ["رمز بساز", "پسورد بساز", "رمز امن", "password"],
  random: ["عدد شانسی", "عدد تصادفی", "یه عدد بده", "random number"],
};

/** عبارت یکسان‌شده‌ای که موتور سریع داخلی برای هر کلیدواژه جواب می‌دهد. */
const PRESET_QUERIES: Partial<Record<PresetId, string>> = {
  time: "ساعت چنده",
  date: "تاریخ امروز",
  help: "راهنما",
  coin: "شیر یا خط",
  dice: "تاس",
  anime: "یه انیمه پیشنهاد بده",
  quote: "یه جمله بگو",
};

// کلمات سفارشی مدیر با یک کش کوتاه خوانده می‌شوند تا هر پیام به دیتابیس نزند.
let customCache: { at: number; items: CustomPreset[] } | null = null;
const CUSTOM_CACHE_MS = 120_000;

/** بعد از افزودن/حذف از پنل صدا زده می‌شود تا کش همان نمونه خالی شود. */
export function invalidatePresetCache(): void {
  customCache = null;
}

async function customPresets(deps: QuickDeps): Promise<CustomPreset[]> {
  if (customCache && Date.now() - customCache.at < CUSTOM_CACHE_MS) return customCache.items;
  try {
    const items = await loadCustomPresets(deps.settings);
    customCache = { at: Date.now(), items };
    return items;
  } catch {
    return [];
  }
}

async function findCustomPreset(deps: QuickDeps, word: string): Promise<CustomPreset | null> {
  const items = await customPresets(deps);
  return items.find((item) => item.word === word) ?? null;
}

/** کلیدواژهٔ آمادهٔ متن را پیدا می‌کند (بدون دستور اسلش). */
export function matchPreset(text: string): PresetId | null {
  const word = normalizePresetWord(text);
  if (!word) return null;
  for (const id of Object.keys(PRESET_WORDS) as PresetId[]) {
    if (PRESET_WORDS[id].some((candidate) => normalizePresetWord(candidate) === word)) return id;
  }
  return null;
}

function presetIdText(user: TgUser, chatId: number): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || "کاربر";
  return [
    sectionTitle("🆔 شناسه‌ها"),
    `👤 نام: <b>${escapeHtml(name)}</b>`,
    `🔢 شناسهٔ شما: <code>${user.id}</code>`,
    user.username ? `🔗 نام کاربری: @${escapeHtml(user.username)}` : "🔗 نام کاربری: ندارد",
    `💬 شناسهٔ این گفتگو: <code>${chatId}</code>`,
  ].join("\n");
}

/**
 * true یعنی همین‌جا و بدون هوش مصنوعی جواب داده شد.
 * کندی و پیام «در حال فکر کردن» فقط برای سوال‌های واقعی می‌ماند.
 */
export async function handlePresetTrigger(deps: QuickDeps, message: TgMessage): Promise<boolean> {
  const chat = message.chat;
  if (chat.type === "channel") return false;
  const from = message.from;
  if (!from || from.is_bot) return false;

  let candidate = (message.text ?? "").trim();
  if (!candidate || candidate.startsWith("/")) return false;

  // «@Spixle_bot بیو» هم مثل «بیو» جواب می‌گیرد.
  const handle = `@${deps.cfg.botUsername}`.toLowerCase();
  if (candidate.toLowerCase().startsWith(handle)) {
    candidate = candidate.slice(handle.length).trim();
  }
  if (candidate.length === 0 || candidate.length > 40) return false;

  const preset = matchPreset(candidate);
  const custom = preset ? null : await findCustomPreset(deps, normalizePresetWord(candidate));
  if (!preset && !custom) return false;

  // وقتی ربات منتظر یک مقدار از مدیر است، کلمهٔ آماده اجرا نمی‌شود.
  if (chat.type === "private") {
    try {
      const session = await getSession(deps.sb, from.id, chat.id);
      const state = session?.state ?? "";
      if (state.startsWith("input:") || state.startsWith("wizard:") || state === "confirm") {
        return false;
      }
    } catch {
      // اگر خواندن وضعیت ممکن نشد، پاسخ سریع ادامه پیدا می‌کند.
    }
  }

  // فاصلهٔ کوتاه ضد تکرار، تا اسپم «بیو» پاسخ پشت‌سرهم نسازد.
  if (deps.limiter) {
    const gate = deps.limiter.hit(`preset:${chat.id}:${from.id}`, 1, 4000);
    if (!gate.allowed) return true;
  }

  const target = message.reply_to_message?.from ?? from;
  let body: string;
  if (custom) {
    body = escapeHtml(custom.text);
  } else {
    const builtin = preset as PresetId;
    if (builtin === "bio") {
      body = bioText(target);
    } else if (builtin === "id") {
      body = presetIdText(from, chat.id);
    } else if (builtin === "greeting") {
      body = presetGreeting();
    } else if (builtin === "about") {
      body = presetAbout(deps.cfg.botUsername);
    } else if (builtin === "password") {
      body = presetPassword();
    } else if (builtin === "random") {
      body = presetRandom();
    } else {
      let timeZone = "Asia/Tehran";
      try {
        timeZone = await deps.settings.get("timezone");
      } catch {
        // پیش‌فرض کافی است
      }
      const answer = offlineAnswer(PRESET_QUERIES[builtin] ?? candidate, {
        timeZone,
        botUsername: deps.cfg.botUsername,
      });
      if (!answer) return false;
      body = answer.text;
    }
  }

  const markup = chat.type === "private"
    ? keyboard([[
      {
        text: "🧹 پاک کردن حافظه",
        callback_data: "u:mm",
        style: "danger" as const,
      },
      { text: "🏠 منوی اصلی", callback_data: "u:m", style: "success" as const },
    ]])
    : keyboard([[
      urlButton(
        "🤖 گفتگوی خصوصی",
        `https://t.me/${deps.cfg.botUsername}?start=group`,
        "primary",
      ),
    ]]);

  try {
    await deps.tg.sendMessage(chat.id, body, {
      preview: false,
      markup,
      replyTo: chat.type === "private" ? undefined : message.message_id,
    });
  } catch (error) {
    await deps.log.warn("preset reply failed", {
      chatId: chat.id,
      preset,
      error: (error as Error).message,
    });
  }
  return true;
}
