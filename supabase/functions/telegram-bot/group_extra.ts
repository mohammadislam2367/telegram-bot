/**
 * 🛡 کنترل گروه — دستورهای متنی /lock /unlock /pin /unpin /verify.
 * پنل قدیمی (`gp:`) حذف شد؛ تنها پنل موجود در `digi_panel.ts` است.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../_shared/config.ts";
import type { TelegramApi } from "../_shared/telegram.ts";
import type { SettingsStore } from "../_shared/settings.ts";
import type { Logger } from "../_shared/logger.ts";
import type { GroupAdminChecker } from "../_shared/auth.ts";
import type { GroupSettingsRow, TgMessage } from "../_shared/types.ts";
import { insertRow, selectOne } from "../_shared/db.ts";
import { mainMarkup, mainScreen } from "./digi_panel.ts";

export interface GroupExtraDeps {
  cfg: AppConfig;
  sb: SupabaseClient;
  tg: TelegramApi;
  settings: SettingsStore;
  log: Logger;
  groupAdmins: GroupAdminChecker;
}

const COMMANDS = ["lock", "unlock", "pin", "unpin", "panel", "verify"] as const;

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

async function loadGroupSettings(
  deps: GroupExtraDeps,
  chatId: number,
): Promise<GroupSettingsRow> {
  const existing = await selectOne<GroupSettingsRow>(
    deps.sb,
    "group_settings",
    (q) => q.eq("group_id", chatId),
  );
  if (existing) return existing;
  try {
    return await insertRow<GroupSettingsRow>(deps.sb, "group_settings", { group_id: chatId });
  } catch {
    const fallback = await selectOne<GroupSettingsRow>(
      deps.sb,
      "group_settings",
      (q) => q.eq("group_id", chatId),
    );
    if (fallback) return fallback;
    throw new Error("group_settings unavailable");
  }
}

async function applyLock(deps: GroupExtraDeps, chatId: number, minutes?: number): Promise<void> {
  const info = await deps.tg.getChat(chatId);
  const previous = (info as { permissions?: Record<string, boolean> }).permissions;
  await deps.settings.set(permsKey(chatId), JSON.stringify(previous ?? ALLOW_ALL));
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    permissions: LOCKED,
  };
  if (minutes) payload.until_date = Math.floor(Date.now() / 1000) + minutes * 60;
  await deps.tg.call<boolean>("setChatPermissions", payload);
}

async function applyUnlock(deps: GroupExtraDeps, chatId: number): Promise<void> {
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
  await deps.tg.call<boolean>("setChatPermissions", { chat_id: chatId, permissions: restore });
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

  if (command === "verify") {
    const settings = await loadGroupSettings(deps, chatId);
    const next = !settings.verify_enabled;
    try {
      await deps.sb
        .from("group_settings")
        .update({ verify_enabled: next, updated_at: new Date().toISOString() })
        .eq("group_id", chatId);
    } catch (error) {
      await deps.log.warn("verify toggle failed", { chatId, error: (error as Error).message });
    }
    await reply(
      deps,
      chatId,
      next
        ? "🔍 تأیید هویت روشن شد.\nاعضای تازه تا زدن دکمهٔ «✅ تأیید هویت» نمی‌توانند پیام بفرستند."
        : "🔍 تأیید هویت خاموش شد. اعضای تازه آزادانه پیام می‌فرستند.",
    );
    return true;
  }

  if (command === "lock") {
    try {
      await applyLock(deps, chatId);
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
      await applyUnlock(deps, chatId);
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

  // /panel → تنها پنل موجود (DIGI)
  const settings = await loadGroupSettings(deps, chatId);
  try {
    await deps.tg.sendMessage(chatId, mainScreen(settings), {
      preview: false,
      markup: mainMarkup(true) as never,
    });
  } catch (error) {
    await deps.log.warn("panel render failed", { chatId, error: (error as Error).message });
    await reply(deps, chatId, "⚠️ پنل باز نشد. دوباره تلاش کن.");
  }
  return true;
}
