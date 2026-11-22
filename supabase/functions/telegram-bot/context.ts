/**
 * Ctx — همه‌ی ماژول‌ها فقط از طریق این ساختار به Telegram/DB/تنظیمات دسترسی دارند.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../_shared/config.ts";
import type { TelegramApi } from "../_shared/telegram.ts";
import { TelegramError } from "../_shared/telegram.ts";
import type { SettingsStore } from "../_shared/settings.ts";
import type { Logger } from "../_shared/logger.ts";
import type { AdminIdentity, GroupAdminChecker, Permission } from "../_shared/auth.ts";
import { hasPermission } from "../_shared/auth.ts";
import type { SlidingWindowLimiter } from "../_shared/rate_limit.ts";
import { clearSession, startSession } from "../_shared/sessions.ts";
import type { TgInlineKeyboardMarkup, TgMessage, TgUpdate, UserRow } from "../_shared/types.ts";
import { insertRow } from "../_shared/db.ts";
import { escapeHtml } from "../_shared/validation.ts";

export interface Ctx {
  cfg: AppConfig;
  sb: SupabaseClient;
  tg: TelegramApi;
  settings: SettingsStore;
  log: Logger;
  update: TgUpdate;
  user: UserRow;
  admin: AdminIdentity | null;
  groupAdmins: GroupAdminChecker;
  limiter: SlidingWindowLimiter;
  now: Date;
  userId: number;
  chatId: number;
  chatType: "private" | "group" | "supergroup" | "channel";
}

export function createContext(input: {
  cfg: AppConfig;
  sb: SupabaseClient;
  tg: TelegramApi;
  settings: SettingsStore;
  log: Logger;
  update: TgUpdate;
  user: UserRow;
  admin: AdminIdentity | null;
  groupAdmins: GroupAdminChecker;
  limiter: SlidingWindowLimiter;
  now?: Date;
  userId: number;
  chatId: number;
  chatType: "private" | "group" | "supergroup" | "channel";
}): Ctx {
  return { ...input, now: input.now ?? new Date() };
}

export function isPrivate(ctx: Ctx): boolean {
  return ctx.chatType === "private";
}

/** ارسال پیام با مدیریت خطا (بدون پرتاب استثنا به router). */
export async function send(
  ctx: Ctx,
  text: string,
  markup?: TgInlineKeyboardMarkup,
): Promise<TgMessage | null> {
  try {
    return await ctx.tg.sendMessage(ctx.chatId, text, { markup, preview: false });
  } catch (error) {
    if (error instanceof TelegramError && error.isNotModified) return null;
    await ctx.log.warn("sendMessage failed", {
      chatId: ctx.chatId,
      error: (error as Error).message,
    });
    return null;
  }
}

export async function sendTo(
  ctx: Ctx,
  chatId: number | string,
  text: string,
  markup?: TgInlineKeyboardMarkup,
): Promise<TgMessage | null> {
  try {
    return await ctx.tg.sendMessage(chatId, text, { markup, preview: false });
  } catch (error) {
    await ctx.log.warn("sendMessage(chat) failed", {
      chatId,
      error: (error as Error).message,
    });
    return null;
  }
}

/** ویرایش پیام callback؛ اگر پیام موجود نبود، پیام جدید می‌فرستد. */
export async function editOrSend(
  ctx: Ctx,
  text: string,
  markup?: TgInlineKeyboardMarkup,
): Promise<void> {
  const message = ctx.update.callback_query?.message;
  if (!message) {
    await send(ctx, text, markup);
    return;
  }
  try {
    await ctx.tg.editMessageText(ctx.chatId, message.message_id, text, { markup });
  } catch (error) {
    if (error instanceof TelegramError && error.isNotModified) return;
    if (error instanceof TelegramError && /message to edit not found/i.test(error.description)) {
      await send(ctx, text, markup);
      return;
    }
    await ctx.log.warn("editMessageText failed", { error: (error as Error).message });
    await send(ctx, text, markup);
  }
}

export async function answerCallback(
  ctx: Ctx,
  text?: string,
  alert = false,
): Promise<void> {
  const id = ctx.update.callback_query?.id;
  if (!id) return;
  try {
    await ctx.tg.answerCallback(id, text, alert);
  } catch (error) {
    console.warn("answerCallback failed:", (error as Error).message);
  }
}

export async function deleteMessageSafe(ctx: Ctx, messageId: number): Promise<boolean> {
  try {
    return await ctx.tg.deleteMessage(ctx.chatId, messageId);
  } catch (error) {
    if (error instanceof TelegramError) return false;
    return false;
  }
}

export async function notifyError(ctx: Ctx, message: string): Promise<void> {
  await send(ctx, `⚠️ ${message}`);
}

// ─── admin guards ────────────────────────────────────────────────────────────

const PERMISSION_LABELS: Partial<Record<Permission, string>> = {
  "users.manage": "مدیریت کاربران",
  "bans.manage": "مدیریت مسدودسازی",
  "ads.manage": "مدیریت تبلیغات",
  "broadcast.manage": "ارسال همگانی",
  "schedule.manage": "زمان‌بندی انتشار",
  "ai.manage": "مدیریت هوش مصنوعی",
  "content.manage": "مدیریت محتوا",
  "groups.manage": "مدیریت گروه",
  "settings.manage": "تنظیمات ربات",
  "tools.use": "ابزارهای سیستم",
  "admins.manage": "مدیریت مدیران",
};

export interface GuardOptions {
  silent?: boolean;
  requirePrivate?: boolean;
}

/** بررسی مجدد دسترسی در هر callback/دستور مدیریتی. */
export async function guardAdmin(
  ctx: Ctx,
  permission: Permission,
  options: GuardOptions = {},
): Promise<boolean> {
  if (!ctx.admin) {
    if (!options.silent) {
      await answerCallback(ctx, "⛔ شما مدیر مجاز نیستید.", true);
      if (!ctx.update.callback_query) {
        await send(ctx, "⛔ این بخش فقط برای مدیران مجاز است.");
      }
    }
    return false;
  }

  if (!hasPermission(ctx.admin, permission)) {
    if (!options.silent) {
      const label = PERMISSION_LABELS[permission] ?? permission;
      await answerCallback(ctx, `⛔ دسترسی «${label}» ندارید.`, true);
      if (!ctx.update.callback_query) {
        await send(ctx, `⛔ دسترسی لازم را ندارید: <b>${escapeHtml(label)}</b>`);
      }
    }
    return false;
  }

  if (options.requirePrivate !== false && !isPrivate(ctx)) {
    if (!options.silent) {
      await send(ctx, "🔐 داشبورد مدیریت فقط در چت خصوصی ربات در دسترس است.", {
        inline_keyboard: [[{
          text: "🤖 ورود به داشبورد",
          url: `https://t.me/${ctx.cfg.botUsername}?start=admin`,
        }]],
      });
    }
    return false;
  }

  const limit = await ctx.settings.get("admin_rate_limit_per_minute");
  const decision = ctx.limiter.hit(`admin:${ctx.userId}`, limit, 60_000, ctx.now.getTime());
  if (!decision.allowed) {
    if (!options.silent) {
      await answerCallback(ctx, "⏳ تعداد اقدامات شما زیاد است؛ کمی صبر کنید.", true);
    }
    return false;
  }

  return true;
}

export async function logAdminAction(
  ctx: Ctx,
  action: string,
  targetType?: string,
  targetId?: string | number,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await insertRow(ctx.sb, "admin_actions", {
      actor_id: ctx.userId,
      action,
      target_type: targetType ?? null,
      target_id: targetId !== undefined ? String(targetId) : null,
      metadata,
    });
    await ctx.log.info(`admin:${action}`, { target: targetId, ...metadata });
  } catch (error) {
    console.warn("admin action log failed:", (error as Error).message);
  }
}

// ─── sessions ────────────────────────────────────────────────────────────────

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sessionTtl(ctx: Ctx): Promise<number> {
  return await ctx.settings.get("session_ttl_minutes");
}

/** شروع یک ورودی متنی تک‌مرحله‌ای. */
export async function askForInput(
  ctx: Ctx,
  action: string,
  prompt: string,
  args: Record<string, unknown> = {},
  returnTo = "a:h",
): Promise<void> {
  await startSession(
    ctx.sb,
    ctx.userId,
    ctx.chatId,
    `input:${action}`,
    { args, returnTo },
    await sessionTtl(ctx),
  );
  await send(ctx, `${prompt}\n\n<i>برای انصراف /cancel را بفرستید.</i>`);
}

export interface PendingConfirm {
  token: string;
  action: string;
  args: Record<string, unknown>;
}

/** عملیات حساس: ذخیره‌ی توکن تأیید در session (نه در callback_data). */
export async function askConfirm(
  ctx: Ctx,
  prompt: string,
  action: string,
  args: Record<string, unknown> = {},
  returnTo = "a:h",
): Promise<void> {
  const token = randomToken();
  await startSession(
    ctx.sb,
    ctx.userId,
    ctx.chatId,
    "confirm",
    { confirm: { token, action, args } satisfies PendingConfirm, returnTo },
    await sessionTtl(ctx),
  );
  await send(ctx, prompt, {
    inline_keyboard: [
      [{ text: "✅ تأیید و اجرا", callback_data: `x:y:${token}` }],
      [{ text: "❌ انصراف", callback_data: `x:n:${token}` }],
    ],
  });
}

export async function closeSession(ctx: Ctx): Promise<void> {
  await clearSession(ctx.sb, ctx.userId, ctx.chatId);
}

export function tokenMatches(expected: string, provided: string): boolean {
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}
