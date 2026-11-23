/**
 * 💬 پاسخ به ریپلای — اگر کسی روی پیام خودِ ربات ریپلای کند، ربات جواب می‌دهد.
 * پاسخ از دانش ذخیره‌شده ساخته می‌شود، پس بدون اینترنت و بدون تأخیر است.
 */
import type { AppConfig } from "../_shared/config.ts";
import type { TelegramApi } from "../_shared/telegram.ts";
import type { SettingsStore } from "../_shared/settings.ts";
import type { Logger } from "../_shared/logger.ts";
import type { TgMessage } from "../_shared/types.ts";
import { offlineAnswer } from "../_shared/offline_brain.ts";
import { keyboard } from "../_shared/keyboards.ts";

export interface ReplyDeps {
  cfg: AppConfig;
  tg: TelegramApi;
  settings: SettingsStore;
  log: Logger;
}

/** آیا این پیام ریپلای روی پیام خود ربات است؟ */
export function isReplyToBot(cfg: AppConfig, message: TgMessage): boolean {
  const target = message.reply_to_message?.from;
  if (!target?.is_bot) return false;
  const username = (target.username ?? "").toLowerCase();
  return username.length > 0 && username === cfg.botUsername.toLowerCase();
}

export async function handleBotReply(deps: ReplyDeps, message: TgMessage): Promise<boolean> {
  const chat = message.chat;
  // در چت خصوصی، مسیر عادی ربات خودش جواب می‌دهد.
  if (chat.type === "private") return false;
  if (!isReplyToBot(deps.cfg, message)) return false;

  const text = (message.text ?? message.caption ?? "").trim();
  if (!text || text.startsWith("/")) return false;

  let timeZone = "Asia/Tehran";
  try {
    timeZone = await deps.settings.get("timezone");
  } catch {
    // پیش‌فرض کافی است
  }

  const answer = offlineAnswer(text, {
    timeZone,
    now: new Date(),
    botUsername: deps.cfg.botUsername,
  });

  const body = answer ? answer.text : [
    "سوالت را گرفتم، ولی جواب دقیقش را همین‌جا ندارم.",
    "برای حساب و کتاب /calc، برای بازی /games و برای راهنما /help را بزن.",
  ].join("\n");

  try {
    await deps.tg.sendMessage(chat.id, body, {
      preview: false,
      replyTo: message.message_id,
      markup: keyboard([[{ text: "🏠 منوی اصلی", callback_data: "u:m" }]]),
    });
  } catch (error) {
    await deps.log.warn("reply answer failed", {
      chatId: chat.id,
      error: (error as Error).message,
    });
  }
  return true;
}
