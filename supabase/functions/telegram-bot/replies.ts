/**
 * 💬 پاسخ به ریپلای — اگر کسی روی پیام خودِ ربات ریپلای کند، ربات جواب می‌دهد.
 * اگر هوش مصنوعی روشن باشد پاسخ با هوش مصنوعی ساخته می‌شود؛ در غیر این صورت
 * (خاموش یا پر بودن سهمیه) موتور سریع داخلی همان‌جا جواب می‌دهد.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../_shared/config.ts";
import type { TelegramApi } from "../_shared/telegram.ts";
import type { SettingsStore } from "../_shared/settings.ts";
import type { Logger } from "../_shared/logger.ts";
import type { TgMessage } from "../_shared/types.ts";
import { answerQuestion, dailyAiRequests } from "../_shared/ai_core.ts";
import { offlineAnswer } from "../_shared/offline_brain.ts";
import { keyboard, urlButton } from "../_shared/keyboards.ts";
import type { SlidingWindowLimiter } from "../_shared/rate_limit.ts";

export interface ReplyDeps {
  cfg: AppConfig;
  sb: SupabaseClient;
  tg: TelegramApi;
  settings: SettingsStore;
  log: Logger;
  limiter: SlidingWindowLimiter;
}

/** آیا این پیام ریپلای روی پیام خود ربات است؟ */
export function isReplyToBot(cfg: AppConfig, message: TgMessage): boolean {
  const target = message.reply_to_message?.from;
  if (!target?.is_bot) return false;
  const username = (target.username ?? "").toLowerCase();
  return username.length > 0 && username === cfg.botUsername.toLowerCase();
}

/** پاسخ سریع محلی، بدون هیچ اشاره‌ای به حالت یا نسخهٔ خاص. */
function quickAnswer(deps: ReplyDeps, text: string, timeZone: string): string {
  const answer = offlineAnswer(text, {
    timeZone,
    now: new Date(),
    botUsername: deps.cfg.botUsername,
  });
  if (answer) return answer.text;
  return [
    "سوالت را گرفتم، ولی جواب دقیقش را همین‌جا ندارم.",
    "برای حساب و کتاب /calc، برای بازی /games و برای راهنما /help را بزن.",
  ].join("\n");
}

async function aiEnabled(deps: ReplyDeps): Promise<boolean> {
  const [feature, enabled] = await Promise.all([
    deps.settings.get("feature_ai"),
    deps.settings.get("ai_enabled"),
  ]);
  return feature && enabled;
}

/**
 * سهمیهٔ جواب هوشمند در گروه به نام هر کاربر حساب می‌شود تا سهمیهٔ ربات نسوزد:
 * یک فاصلهٔ زمانی بین جواب‌ها و یک سقف روزانه (پیش‌فرض ۵) برای هر نفر.
 */
async function aiQuotaFor(
  deps: ReplyDeps,
  chatId: number,
  userId: number,
  timeZone: string,
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const [cooldownSeconds, dailyLimit] = await Promise.all([
    deps.settings.get("ai_group_cooldown_seconds"),
    deps.settings.get("ai_group_daily_limit"),
  ]);
  const used = await dailyAiRequests(deps.sb, userId, timeZone);
  const gate = deps.limiter.hit(
    `group-ai:${chatId}:${userId}`,
    1,
    Math.max(cooldownSeconds, 10) * 1000,
  );
  const allowed = gate.allowed && used < dailyLimit;
  return { allowed, used, limit: dailyLimit };
}

export async function handleBotReply(deps: ReplyDeps, message: TgMessage): Promise<boolean> {
  const chat = message.chat;
  // در چت خصوصی، مسیر عادی ربات خودش جواب می‌دهد.
  if (chat.type === "private") return false;
  if (!isReplyToBot(deps.cfg, message)) return false;

  const text = (message.text ?? message.caption ?? "").trim();
  if (!text || text.startsWith("/")) return false;

  const from = message.from;
  // پیام‌های سرویس (بدون فرستنده) یا فرستندهٔ ربات را جواب نمی‌دهیم.
  if (!from || from.is_bot) return false;

  let timeZone = "Asia/Tehran";
  try {
    timeZone = await deps.settings.get("timezone");
  } catch {
    // پیش‌فرض کافی است
  }

  let body = "";
  if (await aiEnabled(deps)) {
    const quota = await aiQuotaFor(deps, chat.id, from.id, timeZone);
    if (quota.allowed) {
      try {
        const reply = await answerQuestion(
          { sb: deps.sb, settings: deps.settings, cfg: deps.cfg },
          { userId: from.id, text, memoryEnabled: false },
        );
        body = reply.text;
      } catch (error) {
        await deps.log.warn("group ai reply failed", {
          chatId: chat.id,
          error: (error as Error).message,
        });
      }
    }
  }
  if (!body.trim()) body = quickAnswer(deps, text, timeZone);

  try {
    await deps.tg.sendMessage(chat.id, body, {
      preview: false,
      replyTo: message.message_id,
      markup: keyboard([[
        urlButton(
          "🤖 گفتگوی خصوصی",
          `https://t.me/${deps.cfg.botUsername}?start=group`,
          "primary",
        ),
      ]]),
    });
  } catch (error) {
    await deps.log.warn("reply answer failed", {
      chatId: chat.id,
      error: (error as Error).message,
    });
  }
  return true;
}
