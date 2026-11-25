/**
 * مسیریاب اصلی آپدیت‌های تلگرام.
 * هر آپدیت: upsert کاربر → بررسی نگه‌داری/مسدودی → مسیردهی.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../_shared/config.ts";
import type { SupabaseClient as Sb } from "@supabase/supabase-js";
import type { TelegramApi } from "../_shared/telegram.ts";
import type { SettingsStore } from "../_shared/settings.ts";
import type { Logger } from "../_shared/logger.ts";
import type { GroupAdminChecker } from "../_shared/auth.ts";
import { getAdmin } from "../_shared/auth.ts";
import type { SlidingWindowLimiter } from "../_shared/rate_limit.ts";
import { callRpc } from "../_shared/db.ts";
import { offlineAnswer } from "../_shared/offline_brain.ts";
import { todayInZone } from "../_shared/validation.ts";
import { clearSession, getSession } from "../_shared/sessions.ts";
import { keyboard } from "../_shared/keyboards.ts";
import { statusLabel } from "../_shared/texts.ts";
import type { TgUpdate, UserRow } from "../_shared/types.ts";
import { answerCallback, createContext, type Ctx, editOrSend, send } from "./context.ts";
import { handlePrivateCommand, parsePrivateCommand } from "./commands.ts";
import { renderUserHome } from "./dashboard.ts";
import {
  handleAdminCallback,
  handleConfirmCallback,
  handleInputAction,
  handleWizardCallbackEntry,
} from "./admin.ts";
import { handleAnimeCallback } from "./anime.ts";
import { handleUserNewsCallback } from "./news.ts";
import { handleUserSelfCallback, isUserBanned } from "./users.ts";
import { handleUserAiMessage, startUserChat } from "./ai.ts";
import {
  handleChatMemberUpdate,
  handleGroupMessage,
  handleMyChatMemberUpdate,
} from "./moderation.ts";
import { handleWizardInput } from "./wizard_flow.ts";
import {
  handleGroupInsult,
  handleOwnerWarningCommand,
  handlePrivateInsult,
  tryOwnerWarningKeyword,
} from "./warning.ts";

export interface RouterDeps {
  cfg: AppConfig;
  sb: SupabaseClient;
  tg: TelegramApi;
  settings: SettingsStore;
  log: Logger;
  groupAdmins: GroupAdminChecker;
  limiter: SlidingWindowLimiter;
}

function extractChatAndUser(update: TgUpdate): {
  chat: { id: number; type: "private" | "group" | "supergroup" | "channel" };
  from: {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
  };
  isMessage: boolean;
} | null {
  const message = update.message ?? update.edited_message;
  const callback = update.callback_query;
  const member = update.chat_member ?? update.my_chat_member;

  const from = message?.from ?? callback?.from ?? member?.from;
  const chat = message?.chat ?? callback?.message?.chat ?? member?.chat;
  if (!from || !chat) return null;

  return {
    chat: { id: chat.id, type: chat.type },
    from,
    isMessage: Boolean(update.message),
  };
}

export async function processUpdate(deps: RouterDeps, update: TgUpdate): Promise<void> {
  const extracted = extractChatAndUser(update);
  if (!extracted) return;
  if (extracted.from.is_bot) return;

  const { chat, from } = extracted;
  const timeZone = await deps.settings.get("timezone");

  const rawUser = await callRpc<UserRow | UserRow[]>(deps.sb, "touch_user", {
    p_telegram_id: from.id,
    p_username: from.username ?? null,
    p_first_name: from.first_name ?? null,
    p_last_name: from.last_name ?? null,
    p_language_code: from.language_code ?? null,
    p_is_premium: from.is_premium === true,
    p_is_bot: from.is_bot,
    p_count_message: extracted.isMessage,
    p_day: todayInZone(timeZone),
  });
  const user = Array.isArray(rawUser) ? rawUser[0] : rawUser;

  if (!user) {
    await deps.log.warn("touch_user returned no row", { userId: from.id });
    return;
  }

  const admin = await getAdmin(deps.sb, from.id, deps.cfg.superAdminIds);

  const ctx = createContext({
    cfg: deps.cfg,
    sb: deps.sb,
    tg: deps.tg,
    settings: deps.settings,
    log: deps.log,
    update,
    user,
    admin,
    groupAdmins: deps.groupAdmins,
    limiter: deps.limiter,
    now: new Date(),
    userId: from.id,
    chatId: chat.id,
    chatType: chat.type,
  });

  await guardMaintenanceAndBans(ctx);

  if (update.callback_query) {
    try {
      await handleCallback(ctx);
    } finally {
      await answerCallback(ctx);
    }
    return;
  }

  if (update.my_chat_member) {
    await handleMyChatMemberUpdate(ctx, update.my_chat_member);
    return;
  }

  if (update.chat_member) {
    await handleChatMemberUpdate(ctx, update.chat_member);
    return;
  }

  if (update.message) {
    if (chat.type === "private") await handlePrivateMessage(ctx);
    else if (chat.type === "group" || chat.type === "supergroup") {
      // توهین مستقیم به ربات → متن اخطار نوشته‌شده توسط صاحب ربات
      if (await handleGroupInsult(ctx)) return;
      await handleGroupMessage(ctx);
    }
    return;
  }
}

async function guardMaintenanceAndBans(ctx: Ctx): Promise<void> {
  const isOwner = ctx.admin?.role === "owner";

  // مسدودسازی سطح ربات (مستقل از Ban گروه)
  const ban = await isUserBanned(ctx, ctx.userId);
  if (ban.banned && !isOwner) {
    if (ctx.update.callback_query) {
      await answerCallback(ctx, "⛔ دسترسی شما به ربات مسدود شده است.", true);
      throw new HandledUpdate();
    }
    if (ctx.chatType === "private") {
      const once = ctx.limiter.hit(`ban-notice:${ctx.userId}`, 1, 3_600_000);
      if (once.allowed) {
        await send(
          ctx,
          "⛔ دسترسی شما به این ربات مسدود شده است.\nبرای پیگیری با پشتیبانی تماس بگیرید.",
        );
      }
    }
    throw new HandledUpdate();
  }

  const maintenance = await ctx.settings.get("maintenance_mode");
  if (!maintenance || isOwner) return;

  if (ctx.update.callback_query) {
    await answerCallback(ctx, "🛠 ربات در حال به‌روزرسانی است.", true);
    throw new HandledUpdate();
  }
  if (ctx.chatType === "private") {
    const once = ctx.limiter.hit(`maintenance:${ctx.userId}`, 1, 300_000);
    if (once.allowed) {
      await send(ctx, await ctx.settings.get("maintenance_text"));
    }
  }
  // حالت تعمیر برای گروه‌ها هم اعمال می‌شود (به‌جز مالک اصلی)
  throw new HandledUpdate();
}

export class HandledUpdate extends Error {
  constructor() {
    super("handled");
    this.name = "HandledUpdate";
  }
}

async function handlePrivateMessage(ctx: Ctx): Promise<void> {
  const message = ctx.update.message!;
  const text = message.text ?? message.caption ?? "";

  if (text.startsWith("/")) {
    const parsed = parsePrivateCommand(text, ctx.cfg.botUsername);
    if (parsed) {
      await handlePrivateCommand(ctx, parsed);
      return;
    }
  }

  // صاحب ربات: «اخطار <متن>» متن اخطار گروه‌ها را ثبت می‌کند
  if (await tryOwnerWarningKeyword(ctx, text)) return;

  // توهین به ربات در چت خصوصی → همان متن اخطار
  if (await handlePrivateInsult(ctx, text)) return;

  const session = await getSession(ctx.sb, ctx.userId, ctx.chatId);

  if (session) {
    if (session.state.startsWith("wizard:")) {
      await handleWizardInput(ctx, session.state.slice("wizard:".length), text);
      return;
    }

    if (session.state.startsWith("input:")) {
      const action = session.state.slice("input:".length);
      const args = (session.payload.args ?? {}) as Record<string, unknown>;
      await clearSession(ctx.sb, ctx.userId, ctx.chatId);
      if (text.trim().length === 0) {
        await send(ctx, "⚠️ متن خالی است. دوباره تلاش کنید یا /cancel بزنید.");
        return;
      }
      const handled = await handleInputAction(ctx, action, args, text);
      if (!handled) {
        await send(ctx, "⚠️ این مرحله منقضی شده است. از منو دوباره شروع کنید.");
      }
      return;
    }

    if (session.state === "confirm") {
      await send(
        ctx,
        "برای ادامه یکی از دکمه‌های تأیید/انصراف را بزنید یا /cancel را بفرستید.",
        keyboard([
          [{ text: "❌ لغو", callback_data: "u:m" }],
        ]),
      );
      return;
    }

    if (session.state === "ai_chat") {
      if (text.trim().length === 0) {
        await send(ctx, "یک سوال متنی بفرستید.");
        return;
      }
      await handleUserAiMessage(ctx, text);
      return;
    }
  }

  if (text.trim().length === 0) {
    await send(
      ctx,
      "فقط پیام متنی پشتیبانی می‌شود. از منو استفاده کنید.",
      keyboard([
        [{ text: "🏠 منوی اصلی", callback_data: "u:m" }],
      ]),
    );
    return;
  }

  // دو حالت ربات: اگر ماژول AI و کلید فعال‌سازی هر دو روشن باشند، پاسخ هوشمند
  // (با نشانگر تایپ) می‌آید؛ در غیر این صورت پاسخ فوری و حرفه‌ای داخلی، بدون فکر کردن.
  const [aiFeature, aiOn] = await Promise.all([
    ctx.settings.get("feature_ai"),
    ctx.settings.get("ai_enabled"),
  ]);
  if (aiFeature && aiOn) {
    await handleUserAiMessage(ctx, text);
    return;
  }

  const timeZone = await ctx.settings.get("timezone");
  const quick = offlineAnswer(text, {
    timeZone,
    now: ctx.now,
    botUsername: ctx.cfg.botUsername,
  });
  if (quick) {
    await send(
      ctx,
      quick.text,
      keyboard([
        [{ text: "🏠 منوی اصلی", callback_data: "u:m", style: "success" }],
      ]),
    );
    return;
  }

  await renderUserHome(ctx);
}

async function handleCallback(ctx: Ctx): Promise<void> {
  const data = ctx.update.callback_query?.data ?? "";
  if (data.length === 0) {
    await answerCallback(ctx, "");
    return;
  }

  if (data === "noop") {
    await answerCallback(ctx, "به‌روزرسانی شد.");
    return;
  }

  const parts = data.split(":");
  const namespace = parts[0];

  if (namespace === "a") {
    await handleAdminCallback(ctx, parts);
    return;
  }

  if (namespace === "x") {
    await handleConfirmCallback(ctx, parts[1] ?? "", parts[2] ?? "");
    return;
  }

  if (namespace === "w") {
    await handleWizardCallbackEntry(ctx, parts);
    return;
  }

  if (namespace === "u") {
    const action = parts[1];

    if (action === "m" || action === "hl") {
      const { handleUserCallback } = await import("./dashboard.ts");
      if (await handleUserCallback(ctx, parts)) return;
    }

    if (["pr", "tg", "mm", "dl", "dly", "dln"].includes(action ?? "")) {
      if (await handleUserSelfCallback(ctx, parts)) return;
    }

    if (action === "an") {
      if (await handleAnimeCallback(ctx, parts)) return;
    }

    if (action === "nw") {
      if (await handleUserNewsCallback(ctx, parts)) return;
    }

    if (action === "ai") {
      await startUserChat(ctx);
      return;
    }

    if (action === "st") {
      await send(ctx, "🔕 برای توقف پیام‌ها دستور /stop را بفرستید.");
      return;
    }

    if (action === "wn") {
      await handleOwnerWarningCommand(ctx, "");
      return;
    }

    // دکمهٔ قدیمی/ناشناخته: به‌جای پیام خطا، منوی اصلی دوباره باز می‌شود.
    await renderUserHome(ctx);
    await answerCallback(ctx, "منوی اصلی باز شد.");
    return;
  }

  await answerCallback(ctx, "این دکمه معتبر نیست.", true);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

export async function runWithErrorHandling(
  deps: RouterDeps,
  update: TgUpdate,
): Promise<void> {
  try {
    await processUpdate(deps, update);
  } catch (error) {
    if (error instanceof HandledUpdate) return;
    await deps.log.error("update processing failed", {
      updateId: update.update_id,
      error: (error as Error).message,
      stack: (error as Error).stack?.split("\n").slice(0, 3).join(" | "),
    });
    const text = "⚠️ خطایی رخ داد. لطفاً دوباره تلاش کنید.";
    try {
      const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
      const callbackId = update.callback_query?.id;
      if (callbackId) await deps.tg.answerCallback(callbackId, text, true);
      else if (chatId) await deps.tg.sendMessage(chatId, text);
    } catch {
      // ignore secondary failure
    }
  }
}

export async function replyMainMenu(ctx: Ctx): Promise<void> {
  await editOrSend(
    ctx,
    statusLabel("ai", "ok"),
    keyboard([
      [{ text: "🏠 منوی اصلی", callback_data: "u:m" }],
    ]),
  );
}

export type { Sb };
