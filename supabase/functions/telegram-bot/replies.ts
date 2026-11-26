/**
 * 💬 پاسخ در گروه — وقتی ربات را منشن کنند یا کسی روی پیامش ریپلای کند،
 * ربات جواب می‌دهد. پیش‌فرض دستورمحور است: بدون `/ai` هیچ پاسخ هوش مصنوعی
 * ساخته نمی‌شود و فقط کارت راهنما فرستاده می‌شود.
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
import { divider, sectionTitle } from "../_shared/texts.ts";
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

function mentionRegex(botUsername: string): RegExp {
  const escaped = botUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@${escaped}(?![A-Za-z0-9_])`, "gi");
}

/**
 * آیا ربات مخاطب قرار گرفته است؟
 * ریپلای روی پیام ربات، یا منشن @ربات در هر جای متن — منشن حتی وقتی
 * privacy mode روشن است به دست ربات می‌رسد، پس گروه‌ها همین‌طور کار می‌کنند.
 */
export function botIsAddressed(cfg: AppConfig, message: TgMessage): boolean {
  if (isReplyToBot(cfg, message)) return true;
  const text = `${message.text ?? ""}\n${message.caption ?? ""}`;
  if (!text.trim()) return false;
  return mentionRegex(cfg.botUsername).test(text);
}

/** منشن ربات را از متن حذف می‌کند تا سوال خالص بماند. */
export function stripMention(cfg: AppConfig, text: string): string {
  return text.replace(mentionRegex(cfg.botUsername), " ").replace(/\s+/g, " ").trim();
}

/**
 * کارت «دستورمحور» گروه — پیش‌فرض ربات مثل دیجی‌انتی دستور است، نه چت آزاد.
 * چت هوشمند فقط با درخواست صریح `/ai سؤال` فعال می‌شود.
 */
function groupCard(): string {
  return [
    sectionTitle("🤖 به‌جای چت، با دستور کار می‌کنم"),
    "🛡 <code>/panel</code> — پنل مدیریت گروه",
    divider(),
    "📜 <code>/rules</code> · 🆔 <code>/id</code> · 📊 <code>/stats</code>",
    "⚠️ <code>/warn</code> · 🚫 <code>/ban</code> · 🔇 <code>/mute</code> · 🧹 <code>/purge</code>",
    "🍿 <code>/anime نام</code> · 📰 <code>/news</code> · 🎲 <code>/dice</code> · 🎯 <code>/quiz</code>",
    "",
    "🤖 <b>چت هوشمند:</b> <code>/ai سؤالت</code> — فقط همین‌طور روشن می‌شود.",
  ].join("\n");
}

/** وقتی فقط منشن بدون سوال می‌آید، کارت راهنمای کوتاه. */
function mentionCard(): string {
  return [
    sectionTitle("🤖 در خدمتم"),
    "سوالت را بعد از منشن بنویس؛ همان لحظه جواب می‌دهم.",
    divider(),
    "• <b>بیو</b> · <b>ساعت</b> · <b>تاریخ</b> · <b>آیدی</b> · <b>تاس</b> · <b>جمله</b>",
    "• <b>پیشنهاد انیمه</b> · <b>رمز بساز</b> · <b>عدد شانسی</b> · <b>راهنما</b>",
    "",
    "<i>مدیران گروه: /panel برای پنل مدیریت گروه</i>",
  ].join("\n");
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
  // مقدار ۰ در پنل یعنی بدون محدودیت / بدون فاصله.
  const gate = cooldownSeconds > 0
    ? deps.limiter.hit(`group-ai:${chatId}:${userId}`, 1, cooldownSeconds * 1000)
    : { allowed: true };
  const allowed = gate.allowed && (dailyLimit <= 0 || used < dailyLimit);
  return { allowed, used, limit: dailyLimit };
}

export async function handleBotReply(deps: ReplyDeps, message: TgMessage): Promise<boolean> {
  const chat = message.chat;
  // در چت خصوصی، مسیر عادی ربات خودش جواب می‌دهد.
  if (chat.type === "private") return false;
  if (!botIsAddressed(deps.cfg, message)) return false;

  const raw = (message.text ?? message.caption ?? "").trim();
  if (!raw) return false;
  // پیش‌فرض دستورمحور است؛ فقط `/ai` اجازهٔ ورود به چت هوشمند می‌دهد.
  const explicitAi = /^\/ai(\s|$)/i.test(raw);
  if (raw.startsWith("/") && !explicitAi) return false;

  const from = message.from;
  // پیام‌های سرویس (بدون فرستنده) یا فرستندهٔ ربات را جواب نمی‌دهیم.
  if (!from || from.is_bot) return false;

  const text = stripMention(deps.cfg, raw);
  const question = text.replace(/^\/ai\b\s*/i, "").trim();
  if (!text) {
    try {
      await deps.tg.sendMessage(chat.id, mentionCard(), {
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
      await deps.log.warn("mention card failed", {
        chatId: chat.id,
        error: (error as Error).message,
      });
    }
    return true;
  }

  let timeZone = "Asia/Tehran";
  try {
    timeZone = await deps.settings.get("timezone");
  } catch {
    // پیش‌فرض کافی است
  }

  // بدون درخواست صریح، هیچ پاسخی از هوش مصنوعی ساخته نمی‌شود.
  if (!explicitAi) {
    try {
      await deps.tg.sendMessage(chat.id, groupCard(), {
        preview: false,
        replyTo: message.message_id,
      });
    } catch (error) {
      await deps.log.warn("group card failed", {
        chatId: chat.id,
        error: (error as Error).message,
      });
    }
    return true;
  }

  if (!question) {
    try {
      await deps.tg.sendMessage(chat.id, groupCard(), { preview: false });
    } catch (error) {
      await deps.log.warn("group card failed", {
        chatId: chat.id,
        error: (error as Error).message,
      });
    }
    return true;
  }

  let body = "";
  if (await aiEnabled(deps)) {
    const quota = await aiQuotaFor(deps, chat.id, from.id, timeZone);
    if (quota.allowed) {
      try {
        const reply = await answerQuestion(
          { sb: deps.sb, settings: deps.settings, cfg: deps.cfg },
          { userId: from.id, text: question, memoryEnabled: false },
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
  if (!body.trim()) body = quickAnswer(deps, question, timeZone);

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
