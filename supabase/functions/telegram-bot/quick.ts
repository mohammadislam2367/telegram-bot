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
import { keyboard } from "../_shared/keyboards.ts";
import { divider, sectionTitle } from "../_shared/texts.ts";
import { escapeHtml } from "../_shared/validation.ts";

export interface QuickDeps {
  cfg: AppConfig;
  sb: SupabaseClient;
  tg: TelegramApi;
  settings: SettingsStore;
  log: Logger;
}

/** فهرست دستورهایی که در منوی رسمی تلگرام نشان داده می‌شوند. */
export const BOT_COMMANDS: { command: string; description: string }[] = [
  { command: "start", description: "شروع و منوی اصلی" },
  { command: "games", description: "بازی و سرگرمی" },
  { command: "quiz", description: "کوییز انیمه با گزینه" },
  { command: "bio", description: "کارت معرفی (با ریپلای روی پیام)" },
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
];

export function taglineFor(seed: number): string {
  const index = Math.abs(Math.trunc(seed)) % TAGLINES.length;
  return TAGLINES[index];
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

  if (command === "bio") {
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

  const chatId = cq.message?.chat.id;
  if (chatId && cq.message) {
    try {
      await deps.tg.editMessageText(chatId, cq.message.message_id, text, {
        markup: keyboard([[{ text: "🏠 منوی اصلی", callback_data: "u:m" }]]),
      });
      return true;
    } catch {
      // پیام قابل ویرایش نبود؛ نسخهٔ جدید فرستاده می‌شود
    }
  }
  if (chatId) await reply(deps, chatId, text);
  return true;
}
