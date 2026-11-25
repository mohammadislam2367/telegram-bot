/**
 * 🛡 کنترل گروه — قفل/باز کردن، قفل موقت، سنجاق، و پنل مدیریت گروه با
 * دکمه‌های دسته‌بندی‌شده (صفحه‌بندی‌دار) که تنظیمات واقعی گروه را تغییر می‌دهد.
 * همه‌ی دکمه‌ها فقط برای ادمین‌های همان گروه کار می‌کنند.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../_shared/config.ts";
import type { TelegramApi } from "../_shared/telegram.ts";
import type { SettingsStore } from "../_shared/settings.ts";
import type { Logger } from "../_shared/logger.ts";
import type { GroupAdminChecker } from "../_shared/auth.ts";
import type {
  GroupSettingsRow,
  TgCallbackQuery,
  TgInlineKeyboardMarkup,
  TgMessage,
} from "../_shared/types.ts";
import { countRows, insertRow, selectOne, updateRows } from "../_shared/db.ts";
import { backButton, keyboard } from "../_shared/keyboards.ts";
import { divider, faNum, sectionTitle } from "../_shared/texts.ts";
import { escapeHtml, truncate } from "../_shared/validation.ts";
import {
  buildPermissions,
  hasPermissionLocks,
  LOCK_DEFS,
  LOCK_LABELS,
  locksSummary,
  normalizeLocks,
} from "./locks.ts";

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

const TEMP_LOCK_MINUTES = 60;

function lockRow(
  def: { key: string; label: string; emoji: string },
  locks: Record<string, boolean>,
): { text: string; callback_data: string; style?: "success" | "danger" } {
  const locked = locks[def.key] === true;
  return {
    text: `${def.emoji} ${def.label}: ${locked ? "🔒" : "🔓"}`,
    callback_data: `gp:l:${def.key}`,
    style: locked ? "success" : "danger",
  };
}

const TOGGLE_FIELDS: Record<string, { label: string; emoji: string }> = {
  welcome_enabled: { label: "خوش آمد", emoji: "👋" },
  goodbye_enabled: { label: "خداحافظی", emoji: "🚪" },
  antilink_enabled: { label: "ضد لینک", emoji: "🛡" },
  antispam_enabled: { label: "ضد تبچی", emoji: "🧹" },
  block_forwards: { label: "ضد فوروارد", emoji: "📤" },
  delete_warn_messages: { label: "حذف پیام متخلف", emoji: "✂️" },
  verify_enabled: { label: "تأیید هویت", emoji: "🔍" },
  strict_mode: { label: "سختگیرانه", emoji: "⚖️" },
};

const WARN_ACTION_LABELS: Record<string, string> = {
  mute: "سکوت",
  kick: "اخراج",
  ban: "بن",
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

async function saveGroupSettings(
  deps: GroupExtraDeps,
  chatId: number,
  patch: Partial<GroupSettingsRow>,
): Promise<void> {
  await updateRows(deps.sb, "group_settings", {
    ...patch,
    updated_at: new Date().toISOString(),
  }, { group_id: chatId });
}

function onOff(value: boolean): string {
  return value ? "🟢" : "🔴";
}

function toggleRow(
  field: keyof typeof TOGGLE_FIELDS,
  settings: GroupSettingsRow,
): { text: string; callback_data: string; style?: "success" | "danger" } {
  const meta = TOGGLE_FIELDS[field];
  const enabled = settings[field as keyof GroupSettingsRow] === true;
  return {
    text: `${meta.emoji} ${meta.label}: ${onOff(enabled)}`,
    callback_data: `gp:t:${field}`,
    style: enabled ? "success" : "danger",
  };
}

async function panelMarkup(
  deps: GroupExtraDeps,
  page: number,
  settings: GroupSettingsRow,
): Promise<TgInlineKeyboardMarkup> {
  const timeZone = await deps.settings.get("timezone").catch(() => "Asia/Tehran");
  const privateUrl = `https://t.me/${deps.cfg.botUsername}?start=admin`;

  if (page === 2) {
    return keyboard([
      [{
        text: `🔒 قفل گروه`,
        callback_data: "gp:lock",
        style: "danger",
      }],
      [
        { text: `🧹 پاک‌سازی گروه`, callback_data: "gp:purge", style: "primary" },
        {
          text: `🔇 مدت سکوت: ${faNum(settings.mute_duration_minutes)}د`,
          callback_data: "gp:show:mute",
          style: "primary",
        },
      ],
      [
        {
          text: `🌊 بازه اسپم: ${faNum(settings.flood_window_seconds)}ث`,
          callback_data: "gp:show:flood",
          style: "primary",
        },
        {
          text: `⚠️ حد اخطار: ${faNum(settings.warn_limit)}`,
          callback_data: "gp:show:warn",
          style: "primary",
        },
      ],
      [
        { text: "📝 متن خوش‌آمد", callback_data: "gp:show:welcome_text", style: "primary" },
        { text: "📜 قوانین گروه", callback_data: "gp:rules", style: "primary" },
      ],
      [
        { text: "📊 گزارشات", callback_data: "gp:stats", style: "primary" },
        { text: "⚙️ تنظیمات کامل", url: privateUrl },
      ],
      [
        { text: "◀️ صفحه قبل", callback_data: "gp:p:1", style: "primary" },
        { text: "🔐 قفل‌ها ▶️", callback_data: "gp:p:3", style: "success" },
      ],
      [backButton("gp:close", "↩️ بازگشت")],
    ]);
  }

  if (page === 3) {
    const locks = normalizeLocks(settings.locks);
    const rows: { text: string; callback_data: string; style?: "success" | "danger" }[][] = [];
    for (let index = 0; index < LOCK_DEFS.length; index += 2) {
      rows.push(LOCK_DEFS.slice(index, index + 2).map((def) => lockRow(def, locks)));
    }
    return keyboard([
      ...rows,
      [{ text: "🔓 باز کردن همهٔ قفل‌ها", callback_data: "gp:l:reset", style: "danger" }],
      [
        { text: "◀️ صفحه قبل", callback_data: "gp:p:2", style: "primary" },
        { text: "🏠 صفحه اول", callback_data: "gp:p:1", style: "primary" },
      ],
      [backButton("gp:close", "↩️ بازگشت")],
    ]);
  }

  return keyboard([
    [{
      text: `🕒 قفل موقت (${faNum(TEMP_LOCK_MINUTES)} دقیقه)`,
      callback_data: "gp:temp",
      style: "danger",
    }],
    [toggleRow("welcome_enabled", settings), toggleRow("goodbye_enabled", settings)],
    [toggleRow("antilink_enabled", settings), toggleRow("antispam_enabled", settings)],
    [toggleRow("block_forwards", settings), toggleRow("delete_warn_messages", settings)],
    [toggleRow("verify_enabled", settings), toggleRow("strict_mode", settings)],
    [
      {
        text: `🌊 پیام رگباری: ${faNum(settings.flood_limit)}`,
        callback_data: "gp:show:flood",
        style: "primary",
      },
      {
        text: `⚖️ اقدام اخطار: ${WARN_ACTION_LABELS[settings.warn_action] ?? settings.warn_action}`,
        callback_data: "gp:wa",
        style: "primary",
      },
    ],
    [
      { text: "📌 سنجاق", callback_data: "gp:pin", style: "primary" },
      { text: "🔓 باز کردن گروه", callback_data: "gp:unlock", style: "success" },
    ],
    [
      { text: "📊 گزارشات", callback_data: "gp:stats", style: "primary" },
      { text: `🕒 ${escapeHtml(timeZone)}`, callback_data: "gp:tz", style: "primary" },
    ],
    [{ text: "صفحه بعد ▶️", callback_data: "gp:p:2", style: "primary" }],
    [{ text: "🔐 قفل‌های گروه", callback_data: "gp:p:3", style: "success" }],
    [backButton("gp:close", "↩️ بازگشت")],
  ]);
}

async function panelText(
  deps: GroupExtraDeps,
  chatId: number,
  settings: GroupSettingsRow,
): Promise<string> {
  let title = "این گروه";
  let members: number | null = null;
  try {
    const info = await deps.tg.getChat(chatId);
    title = (info as { title?: string }).title ?? title;
    members = await deps.tg.getChatMemberCount(chatId).catch(() => null);
  } catch {
    // اطلاعات گروه اختیاری است
  }

  const on = (field: keyof GroupSettingsRow) => settings[field] === true ? "فعال 🟢" : "غیرفعال 🔴";

  return [
    sectionTitle(`🛡 پنل مدیریت «${truncate(title, 40)}»`),
    divider(),
    `👥 اعضا: ${members === null ? "—" : faNum(members)}`,
    `🚪 خوش‌آمد: ${on("welcome_enabled")} • 🛡 ضد لینک: ${on("antilink_enabled")}`,
    `🧹 ضد تبچی: ${on("antispam_enabled")} • 📤 ضدفوروارد: ${on("block_forwards")}`,
    `🔍 تأیید هویت: ${on("verify_enabled")} • ⚖️ سختگیرانه: ${on("strict_mode")}`,
    `🔐 ${locksSummary(settings)}`,
    `⚠️ اخطار: ${faNum(settings.warn_limit)} تا ${
      WARN_ACTION_LABELS[settings.warn_action] ?? settings.warn_action
    } • 🔇 ${faNum(settings.mute_duration_minutes)} دقیقه`,
    "",
    "<i>هر دکمه همان‌جا اعمال می‌شود. صفحه بعد: متن‌ها، قفل گروه و پاک‌سازی.</i>",
  ].join("\n");
}

async function renderPanel(
  deps: GroupExtraDeps,
  chatId: number,
  page: number,
  editMessageId?: number,
): Promise<void> {
  const settings = await loadGroupSettings(deps, chatId);
  const text = await panelText(deps, chatId, settings);
  const markup = await panelMarkup(deps, page, settings);
  try {
    if (editMessageId) {
      await deps.tg.editMessageText(chatId, editMessageId, text, { markup });
      return;
    }
    await deps.tg.sendMessage(chatId, text, { markup, preview: false });
  } catch (error) {
    await deps.log.warn("group panel render failed", {
      chatId,
      error: (error as Error).message,
    });
  }
}

async function answer(deps: GroupExtraDeps, cq: TgCallbackQuery, text: string): Promise<void> {
  try {
    await deps.tg.answerCallback(cq.id, text);
  } catch {
    // پاسخ به دکمه اختیاری است
  }
}

async function applyLock(deps: GroupExtraDeps, chatId: number, minutes?: number): Promise<boolean> {
  const info = await deps.tg.getChat(chatId);
  const previous = (info as { permissions?: Record<string, boolean> }).permissions;
  await deps.settings.set(permsKey(chatId), JSON.stringify(previous ?? ALLOW_ALL));
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    permissions: LOCKED,
  };
  if (minutes) payload.until_date = Math.floor(Date.now() / 1000) + minutes * 60;
  await deps.tg.call<boolean>("setChatPermissions", payload);
  return true;
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

async function applyLockPermissions(
  deps: GroupExtraDeps,
  chatId: number,
  locks: Record<string, boolean>,
): Promise<void> {
  if (hasPermissionLocks(locks)) {
    const saved = (await deps.settings.all())[permsKey(chatId)];
    if (!saved) {
      const info = await deps.tg.getChat(chatId);
      const previous = (info as { permissions?: Record<string, boolean> }).permissions;
      await deps.settings.set(permsKey(chatId), JSON.stringify(previous ?? ALLOW_ALL));
    }
    await deps.tg.call<boolean>("setChatPermissions", {
      chat_id: chatId,
      permissions: buildPermissions(locks),
    });
    return;
  }
  await applyUnlock(deps, chatId);
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
    await saveGroupSettings(deps, chatId, { verify_enabled: !settings.verify_enabled });
    await reply(
      deps,
      chatId,
      !settings.verify_enabled
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

  await renderPanel(deps, chatId, 1);
  return true;
}

/** دکمه‌های پنل گروه؛ true یعنی callback مال همین ماژول بود. */
export async function handleGroupPanelCallback(
  deps: GroupExtraDeps,
  cq: TgCallbackQuery,
): Promise<boolean> {
  const data = cq.data ?? "";
  if (!data.startsWith("gp:")) return false;

  const chatId = cq.message?.chat.id;
  if (!chatId) {
    await answer(deps, cq, "این پنل قدیمی شده است.");
    return true;
  }

  const parts = data.split(":");
  const action = parts[1] ?? "";
  const messageId = cq.message?.message_id;

  // قوانین گروه برای همهٔ اعضا، همان‌جا در گروه نمایش داده می‌شود.
  if (action === "rules") {
    const settings = await loadGroupSettings(deps, chatId);
    const body = (settings.rules_text ?? "").trim() ||
      "قوانینی ثبت نشده است؛ مدیران می‌توانند از پنل گروه آن را تنظیم کنند.";
    try {
      await deps.tg.sendMessage(chatId, `<b>📜 قوانین گروه</b>\n\n${escapeHtml(body)}`, {
        preview: false,
        markup: keyboard([[
          { text: "🛡 پنل گروه", callback_data: "gp:p:1", style: "success" },
          { text: "❌ بستن", callback_data: "gp:close", style: "danger" },
        ]]),
      });
      await answer(deps, cq, "قوانین گروه فرستاده شد.");
    } catch (error) {
      await deps.log.warn("group rules failed", {
        chatId,
        error: (error as Error).message,
      });
      await answer(deps, cq, "ارسال قوانین انجام نشد.");
    }
    return true;
  }

  // دکمهٔ «تأیید هویت» — هر عضو فقط هویت خودش را تأیید می‌کند.
  if (action === "v") {
    const targetId = Number(parts[2]);
    if (!Number.isSafeInteger(targetId) || targetId <= 0) {
      await answer(deps, cq, "این دکمه معتبر نیست.");
      return true;
    }
    if (targetId !== cq.from.id && !(await isGroupAdmin(deps, chatId, cq.from.id))) {
      await answer(deps, cq, "⛔ فقط همان عضو می‌تواند هویت خودش را تأیید کند.");
      return true;
    }
    try {
      await deps.tg.call<boolean>("restrictChatMember", {
        chat_id: chatId,
        user_id: targetId,
        permissions: ALLOW_ALL,
      });
      if (messageId) {
        await deps.tg.editMessageText(
          chatId,
          messageId,
          "✅ هویت تأیید شد. خوش آمدی! حالا می‌توانی پیام بفرستی.",
        );
      }
      await answer(deps, cq, "✅ تأیید شد.");
    } catch (error) {
      await deps.log.warn("verify approve failed", {
        chatId,
        error: (error as Error).message,
      });
      await answer(deps, cq, failureHint("تأیید هویت"));
    }
    return true;
  }

  // بستن پنل/کارت برای همه آزاد است تا دکمهٔ بازگشت همیشه جواب بدهد.
  if (action === "close") {
    if (messageId) {
      try {
        await deps.tg.editMessageText(
          chatId,
          messageId,
          "✅ پنل بسته شد. هر زمان خواستی با /panel بازش کن.",
          {
            markup: keyboard([[{
              text: "🛡 باز کردن پنل",
              callback_data: "gp:p:1",
              style: "success",
            }]]),
          },
        );
        await answer(deps, cq, "پنل بسته شد.");
        return true;
      } catch {
        try {
          await deps.tg.deleteMessage(chatId, messageId);
        } catch {
          // اگر ویرایش و حذف هر دو نشد، فقط پاسخ دکمه کافی است
        }
      }
    }
    await answer(deps, cq, "پنل بسته شد.");
    return true;
  }

  if (!(await isGroupAdmin(deps, chatId, cq.from.id))) {
    await answer(deps, cq, "⛔ این پنل فقط برای مدیران گروه است.");
    return true;
  }

  if (action === "p") {
    const page = Math.min(Math.max(Number(parts[2]) || 1, 1), 3);
    await renderPanel(deps, chatId, page, messageId);
    await answer(deps, cq, `صفحه ${faNum(page)}`);
    return true;
  }

  if (action === "l") {
    const key = parts[2] ?? "";
    const settings = await loadGroupSettings(deps, chatId);
    const locks = normalizeLocks(settings.locks);

    if (key === "reset") {
      await saveGroupSettings(deps, chatId, { locks: {} });
      try {
        await applyLockPermissions(deps, chatId, {});
      } catch (error) {
        await deps.log.warn("lock reset failed", { chatId, error: (error as Error).message });
      }
      await renderPanel(deps, chatId, 3, messageId);
      await answer(deps, cq, "همهٔ قفل‌ها باز شد.");
      return true;
    }

    if (!(key in LOCK_LABELS)) {
      await answer(deps, cq, "این قفل شناخته نشد.");
      return true;
    }

    const next = { ...locks };
    if (next[key]) delete next[key];
    else next[key] = true;

    await saveGroupSettings(deps, chatId, { locks: next });
    try {
      await applyLockPermissions(deps, chatId, next);
    } catch (error) {
      await deps.log.warn("lock apply failed", { chatId, error: (error as Error).message });
    }
    await renderPanel(deps, chatId, 3, messageId);
    await answer(deps, cq, `${LOCK_LABELS[key]}: ${next[key] ? "قفل شد 🔒" : "باز شد 🔓"}`);
    return true;
  }

  if (action === "t") {
    const field = parts[2] ?? "";
    if (!(field in TOGGLE_FIELDS)) {
      await answer(deps, cq, "این تنظیم شناخته نشد.");
      return true;
    }
    const settings = await loadGroupSettings(deps, chatId);
    const current = settings[field as keyof GroupSettingsRow] === true;
    await saveGroupSettings(deps, chatId, {
      [field]: !current,
    } as Partial<GroupSettingsRow>);
    await renderPanel(deps, chatId, 1, messageId);
    await answer(deps, cq, `${TOGGLE_FIELDS[field].label}: ${!current ? "روشن شد" : "خاموش شد"}`);
    return true;
  }

  if (action === "wa") {
    const settings = await loadGroupSettings(deps, chatId);
    const order: GroupSettingsRow["warn_action"][] = ["mute", "kick", "ban"];
    const next = order[(order.indexOf(settings.warn_action) + 1) % order.length];
    await saveGroupSettings(deps, chatId, { warn_action: next });
    await renderPanel(deps, chatId, 1, messageId);
    await answer(deps, cq, `اقدام اخطار: ${WARN_ACTION_LABELS[next] ?? next}`);
    return true;
  }

  if (action === "lock") {
    try {
      await applyLock(deps, chatId);
      await answer(deps, cq, "گروه قفل شد.");
      await renderPanel(deps, chatId, 2, messageId);
    } catch (error) {
      await deps.log.warn("panel lock failed", { chatId, error: (error as Error).message });
      await answer(deps, cq, failureHint("قفل کردن گروه"));
    }
    return true;
  }

  if (action === "unlock") {
    try {
      await applyUnlock(deps, chatId);
      await answer(deps, cq, "گروه باز شد.");
    } catch (error) {
      await deps.log.warn("panel unlock failed", { chatId, error: (error as Error).message });
      await answer(deps, cq, failureHint("باز کردن گروه"));
    }
    return true;
  }

  if (action === "temp") {
    try {
      await applyLock(deps, chatId, TEMP_LOCK_MINUTES);
      await answer(
        deps,
        cq,
        `گروه ${faNum(TEMP_LOCK_MINUTES)} دقیقه قفل شد؛ بعد از آن خودکار باز می‌شود.`,
      );
    } catch (error) {
      await deps.log.warn("temp lock failed", { chatId, error: (error as Error).message });
      await answer(deps, cq, failureHint("قفل موقت"));
    }
    return true;
  }

  if (action === "pin") {
    await answer(deps, cq, "روی پیام موردنظر ریپلای کن و /pin بزن.");
    return true;
  }

  if (action === "purge") {
    await answer(deps, cq, "روی پیام شروع ریپلای کن و /purge 20 بزن؛ بعد تأیید کن.");
    return true;
  }

  if (action === "tz") {
    const timeZone = await deps.settings.get("timezone").catch(() => "Asia/Tehran");
    await answer(deps, cq, `منطقه زمانی ربات: ${timeZone}`);
    return true;
  }

  if (action === "stats") {
    const [warnings, actions] = await Promise.all([
      countRows(deps.sb, "user_warnings", (q) => q.eq("group_id", chatId).eq("is_active", true)),
      countRows(deps.sb, "moderation_logs", (q) => q.eq("group_id", chatId)),
    ]);
    await answer(deps, cq, `اخطار فعال: ${faNum(warnings)} • اقدامات ثبت‌شده: ${faNum(actions)}`);
    return true;
  }

  if (action === "show") {
    const field = parts[2] ?? "";
    const settings = await loadGroupSettings(deps, chatId);
    const lines: Record<string, string> = {
      flood: `🌊 حد اسپم: ${faNum(settings.flood_limit)} پیام در ${
        faNum(settings.flood_window_seconds)
      } ثانیه`,
      warn: `⚠️ حد اخطار: ${faNum(settings.warn_limit)} • اقدام: ${
        WARN_ACTION_LABELS[settings.warn_action] ?? settings.warn_action
      }`,
      mute: `🔇 مدت سکوت: ${faNum(settings.mute_duration_minutes)} دقیقه`,
      welcome_text: `👋 متن خوش‌آمد:\n${truncate(settings.welcome_text, 300)}`,
      rules_text: `📜 قوانین:\n${truncate(settings.rules_text, 300)}`,
    };
    const text = lines[field] ?? "این مورد در پنل خصوصی ربات قابل تغییر است.";
    await reply(
      deps,
      chatId,
      `${text}\n\n<i>برای تغییر: چت خصوصی ربات → داشبورد → 👮 مدیریت گروه.</i>`,
    );
    await answer(deps, cq, "فرستادم.");
    return true;
  }

  await answer(deps, cq, "این دکمه معتبر نیست.");
  return true;
}
