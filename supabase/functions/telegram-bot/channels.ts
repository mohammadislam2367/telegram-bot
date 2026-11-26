/**
 * 📢 مدیریت کانال — کانال‌ها هم مثل گروه‌ها ثبت می‌شوند و از داخل خود کانال
 * می‌توان آمار و شناسه گرفت.
 *
 * آپدیت‌های کانال فرستنده (from) ندارند، پس این مسیر مستقل از Ctx کاربر اجرا
 * می‌شود و هیچ‌وقت به ساخت کاربر در حافظه نیاز ندارد.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../_shared/config.ts";
import type { TelegramApi } from "../_shared/telegram.ts";
import type { Logger } from "../_shared/logger.ts";
import { insertRow, selectOne, updateRows } from "../_shared/db.ts";
import type { TgChat, TgMessage } from "../_shared/types.ts";
import { divider, faNum, sectionTitle } from "../_shared/texts.ts";
import { escapeHtml } from "../_shared/validation.ts";

export interface ChannelDeps {
  cfg: AppConfig;
  sb: SupabaseClient;
  tg: TelegramApi;
  log: Logger;
}

async function isBotChannelAdmin(deps: ChannelDeps, chatId: number): Promise<boolean> {
  try {
    const me = await deps.tg.getMe();
    const member = await deps.tg.getChatMember(chatId, me.id);
    return member.status === "administrator" || member.status === "creator";
  } catch {
    return false;
  }
}

/** ثبت یا به‌روزرسانی کانال در فهرست گروه‌ها و کانال‌های ربات. */
export async function registerChannel(deps: ChannelDeps, chat: TgChat): Promise<void> {
  let members: number | null = null;
  try {
    members = await deps.tg.getChatMemberCount(chat.id);
  } catch {
    // کانال خصوصی یا بدون دسترسی
  }

  const values = {
    telegram_chat_id: chat.id,
    title: chat.title ?? null,
    username: chat.username ?? null,
    type: "channel",
    is_active: true,
    bot_is_admin: await isBotChannelAdmin(deps, chat.id),
    member_count: members,
    updated_at: new Date().toISOString(),
    left_at: null,
  };

  const existing = await selectOne<{ telegram_chat_id: number }>(
    deps.sb,
    "groups",
    (q) => q.eq("telegram_chat_id", chat.id),
  );

  if (existing) {
    await updateRows(deps.sb, "groups", values, { telegram_chat_id: chat.id });
    return;
  }
  await insertRow(deps.sb, "groups", values);
}

function channelHelp(botUsername: string): string {
  return [
    sectionTitle("📢 مدیریت کانال"),
    divider(),
    "این ربات در کانال هم کار می‌کند. دستورها را داخل خود کانال بفرست:",
    "",
    "• <code>/id</code> — شناسهٔ این کانال",
    "• <code>/stats</code> — تعداد اعضا و وضعیت",
    "• <code>/link</code> — لینک عمومی کانال",
    "• <code>/help</code> — همین راهنما",
    "",
    "برای تنظیم کانال انتشار، تبلیغات و زمان‌بندی، به چت خصوصی ربات بیا:",
    `<code>@${escapeHtml(botUsername)}</code> → /admin`,
  ].join("\n");
}

/** پردازش هر پست کانال؛ فقط دستورها پاسخ می‌گیرند. */
export async function handleChannelPost(deps: ChannelDeps, post: TgMessage): Promise<void> {
  const chat = post.chat;
  if (chat.type !== "channel") return;

  try {
    await registerChannel(deps, chat);
  } catch (error) {
    await deps.log.warn("channel register failed", {
      chatId: chat.id,
      error: (error as Error).message,
    });
  }

  const text = (post.text ?? post.caption ?? "").trim();
  if (!text.startsWith("/")) return;

  const [head] = text.split(/\s+/);
  const command = head.slice(1).split("@")[0].toLowerCase();

  const reply = async (body: string): Promise<void> => {
    try {
      await deps.tg.sendMessage(chat.id, body, { preview: false });
    } catch (error) {
      await deps.log.warn("channel reply failed", {
        chatId: chat.id,
        error: (error as Error).message,
      });
    }
  };

  if (command === "id") {
    await reply(
      [
        "<b>📢 شناسهٔ این کانال</b>",
        divider(),
        `شناسه: <code>${chat.id}</code>`,
        `نام: ${escapeHtml(chat.title ?? "—")}`,
        chat.username ? `نام کاربری: @${escapeHtml(chat.username)}` : "",
        "",
        "<i>همین شناسه را در داشبورد ربات، بخش «کانال انتشار» می‌توانی وارد کنی.</i>",
      ].filter(Boolean).join("\n"),
    );
    return;
  }

  if (command === "stats") {
    let members: number | null = null;
    try {
      members = await deps.tg.getChatMemberCount(chat.id);
    } catch {
      // ignore
    }
    const admin = await isBotChannelAdmin(deps, chat.id);
    await reply(
      [
        sectionTitle("📊 آمار کانال"),
        divider(),
        `نام: ${escapeHtml(chat.title ?? "—")}`,
        `اعضا: ${members === null ? "—" : faNum(members)}`,
        `دسترسی مدیریت ربات: ${admin ? "✅ دارد" : "❌ ندارد"}`,
        "",
        "<i>با دسترسی مدیریت، ربات می‌تواند پست‌های زمان‌بندی‌شده را منتشر کند.</i>",
      ].join("\n"),
    );
    return;
  }

  if (command === "link") {
    await reply(
      chat.username
        ? `🔗 لینک کانال: https://t.me/${escapeHtml(chat.username)}`
        : "🔒 این کانال لینک عمومی ندارد.",
    );
    return;
  }

  if (command === "help" || command === "start") {
    await reply(channelHelp(deps.cfg.botUsername));
  }
}
