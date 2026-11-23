/**
 * 🛡 کنترل سریع گروه — قفل/باز کردن، سنجاق کردن و کارت وضعیت.
 * همه‌ی دستورها یک درخواست تلگرام‌اند و به دیتابیس سنگین وابسته نیستند.
 */
import type { AppConfig } from "../_shared/config.ts";
import type { TelegramApi } from "../_shared/telegram.ts";
import type { SettingsStore } from "../_shared/settings.ts";
import type { Logger } from "../_shared/logger.ts";
import type { GroupAdminChecker } from "../_shared/auth.ts";
import type { TgMessage } from "../_shared/types.ts";
import { divider, sectionTitle } from "../_shared/texts.ts";

export interface GroupExtraDeps {
  cfg: AppConfig;
  tg: TelegramApi;
  settings: SettingsStore;
  log: Logger;
  groupAdmins: GroupAdminChecker;
}

const COMMANDS = ["lock", "unlock", "pin", "unpin", "panel"] as const;

const ALLOW_ALL = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
};

const LOCKED = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
};

function permsKey(chatId: number): string {
  return `group_saved_perms_${chatId}`;
}

async function reply(deps: GroupExtraDeps, chatId: number, text: string): Promise<void> {
  try {
    await deps.tg.sendMessage(chatId, text, { preview: false });
  } catch (error) {
    await deps.log.warn("group extra reply failed", { chatId, error: (error as Error).message });
  }
}

async function isGroupAdmin(
  deps: GroupExtraDeps,
  chatId: number,
  userId: number,
): Promise<boolean> {
  if (deps.cfg.superAdminIds.includes(userId)) return true;
  const result = await deps.groupAdmins.getMember(chatId, userId);
  return result.isAdmin;
}

function failureHint(action: string): string {
  return [
    `⚠️ ${action} انجام نشد.`,
    "مطمئن شو ربات در گروه ادمین است و دسترسی «مدیریت گروه» را دارد.",
  ].join("\n");
}

/** true یعنی همان‌جا جواب داده شد. */
export async function handleGroupExtra(
  deps: GroupExtraDeps,
  message: TgMessage,
): Promise<boolean> {
  const text = (message.text ?? "").trim();
  if (!text.startsWith("/")) return false;

  const chat = message.chat;
  if (chat.type !== "group" && chat.type !== "supergroup") return false;

  const command = text.split(/\s+/)[0].slice(1).split("@")[0].toLowerCase();
  if (!(COMMANDS as readonly string[]).includes(command)) return false;

  const fromId = message.from?.id;
  const chatId = chat.id;
  if (!fromId) return true;

  if (message.from?.is_bot) return false;

  if (!(await isGroupAdmin(deps, chatId, fromId))) {
    await reply(deps, chatId, "⛔ این دستور فقط برای مدیران همین گروه است.");
    return true;
  }

  if (command === "lock") {
    try {
      const info = await deps.tg.getChat(chatId);
      const previous = (info as { permissions?: Record<string, boolean> }).permissions;
      await deps.settings.set(permsKey(chatId), JSON.stringify(previous ?? ALLOW_ALL));
      await deps.tg.call<boolean>("setChatPermissions", {
        chat_id: chatId,
        permissions: LOCKED,
      });
      await reply(
        deps,
        chatId,
        "🔒 گروه قفل شد.\nفقط مدیران می‌توانند پیام بفرستند. برای باز کردن: /unlock",
      );
    } catch (error) {
      await deps.log.warn("lock failed", { chatId, error: (error as Error).message });
      await reply(deps, chatId, failureHint("قفل کردن گروه"));
    }
    return true;
  }

  if (command === "unlock") {
    try {
      let restore: Record<string, boolean> = ALLOW_ALL;
      try {
        const saved = (await deps.settings.all())[permsKey(chatId)];
        if (typeof saved === "string" && saved.length > 0) {
          const parsed = JSON.parse(saved) as Record<string, boolean> | null;
          if (parsed && typeof parsed === "object") restore = parsed;
        }
      } catch {
        // از تنظیمات پیش‌فرض استفاده می‌کنیم
      }
      await deps.tg.call<boolean>("setChatPermissions", {
        chat_id: chatId,
        permissions: restore,
      });
      await reply(deps, chatId, "🔓 گروه باز شد. اعضا می‌توانند دوباره پیام بفرستند.");
    } catch (error) {
      await deps.log.warn("unlock failed", { chatId, error: (error as Error).message });
      await reply(deps, chatId, failureHint("باز کردن گروه"));
    }
    return true;
  }

  if (command === "pin") {
    const target = message.reply_to_message?.message_id;
    if (!target) {
      await reply(deps, chatId, "📌 روی پیامی که می‌خواهی سنجاق شود ریپلای کن و /pin بزن.");
      return true;
    }
    try {
      await deps.tg.pinMessage(chatId, target, true);
      await reply(deps, chatId, "📌 پیام سنجاق شد.");
    } catch (error) {
      await deps.log.warn("pin failed", { chatId, error: (error as Error).message });
      await reply(deps, chatId, failureHint("سنجاق کردن پیام"));
    }
    return true;
  }

  if (command === "unpin") {
    try {
      await deps.tg.call<boolean>("unpinChatMessage", { chat_id: chatId });
      await reply(deps, chatId, "📎 سنجاق برداشته شد.");
    } catch (error) {
      await deps.log.warn("unpin failed", { chatId, error: (error as Error).message });
      await reply(deps, chatId, failureHint("برداشتن سنجاق"));
    }
    return true;
  }

  // panel
  try {
    const [info, count] = await Promise.all([
      deps.tg.getChat(chatId),
      deps.tg.getChatMemberCount(chatId).catch(() => null),
    ]);
    const title = (info as { title?: string }).title ?? "این گروه";
    const username = (info as { username?: string }).username;
    await reply(
      deps,
      chatId,
      [
        sectionTitle("🛡 وضعیت گروه"),
        divider(),
        `🏷 نام: <b>${title}</b>`,
        username ? `🔗 لینک: @${username}` : "🔗 لینک: خصوصی",
        `🆔 شناسه: <code>${chatId}</code>`,
        count === null ? "" : `👥 اعضا: <b>${count}</b>`,
        divider(),
        "🔒 /lock — قفل گروه",
        "🔓 /unlock — باز کردن",
        "📌 /pin — سنجاق (با ریپلای)",
        "📎 /unpin — برداشتن سنجاق",
      ].filter(Boolean).join("\n"),
    );
  } catch (error) {
    await deps.log.warn("panel failed", { chatId, error: (error as Error).message });
    await reply(deps, chatId, failureHint("نمایش وضعیت گروه"));
  }
  return true;
}
