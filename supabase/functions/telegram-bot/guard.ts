/**
 * 🛡 نگهبان گروه — هر رباتی که عضو عادی (نه مدیر) به گروه اضافه کند،
 * بلافاصله اخراج می‌شود. ربات‌هایی که مدیران اضافه می‌کنند آزادند.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../_shared/config.ts";
import type { TelegramApi } from "../_shared/telegram.ts";
import type { Logger } from "../_shared/logger.ts";
import type { TgUpdate } from "../_shared/types.ts";

export interface GuardDeps {
  cfg: AppConfig;
  sb: SupabaseClient;
  tg: TelegramApi;
  log: Logger;
}

async function botSelfId(deps: GuardDeps): Promise<number | null> {
  try {
    const me = await deps.tg.getMe();
    return me.id;
  } catch {
    return null;
  }
}

async function isChatAdmin(deps: GuardDeps, chatId: number, userId: number): Promise<boolean> {
  try {
    const member = await deps.tg.getChatMember(chatId, userId);
    return member.status === "administrator" || member.status === "creator";
  } catch {
    return false;
  }
}

function joinedBots(update: TgUpdate): number[] {
  const ids: number[] = [];

  for (const member of update.message?.new_chat_members ?? []) {
    if (member.is_bot) ids.push(member.id);
  }

  const changed = update.chat_member;
  const came = changed?.old_chat_member.status === "left" ||
    changed?.old_chat_member.status === "kicked";
  const entered = changed?.new_chat_member.status === "member" ||
    changed?.new_chat_member.status === "administrator";
  if (changed?.new_chat_member.user.is_bot && came && entered) {
    ids.push(changed.new_chat_member.user.id);
  }

  return ids;
}

/** true یعنی نگهبان کاری انجام داد و بقیهٔ مسیر لازم نیست. */
export async function handleBotGuard(deps: GuardDeps, update: TgUpdate): Promise<boolean> {
  const chat = update.message?.chat ?? update.chat_member?.chat;
  if (!chat) return false;
  if (chat.type !== "group" && chat.type !== "supergroup") return false;

  const candidates = joinedBots(update);
  if (candidates.length === 0) return false;

  const selfId = await botSelfId(deps);
  const targets = candidates.filter((id) => id !== selfId);
  if (targets.length === 0) return false;

  const adder = update.message?.from ?? update.chat_member?.from;
  if (adder && await isChatAdmin(deps, chat.id, adder.id)) return false;

  let acted = false;
  for (const botId of targets) {
    try {
      await deps.tg.banChatMember(chat.id, botId);
      acted = true;
    } catch (error) {
      await deps.log.warn("anti-bot ban failed", {
        chatId: chat.id,
        botId,
        error: (error as Error).message,
      });
    }
  }

  if (!acted) return false;

  if (update.message) {
    try {
      await deps.tg.deleteMessage(chat.id, update.message.message_id);
    } catch {
      // پیام سرویس ممکن است از قبل پاک شده باشد
    }
  }

  try {
    await deps.tg.sendMessage(
      chat.id,
      "🤖 ربات‌ها فقط با اجازهٔ مدیران به این گروه اضافه می‌شوند.\nربات اضافه‌شده حذف شد.",
      { preview: false },
    );
  } catch (error) {
    await deps.log.warn("anti-bot notice failed", { error: (error as Error).message });
  }

  return true;
}
