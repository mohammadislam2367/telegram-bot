/**
 * 👮 مدیریت گروه و ضداسپم — Ban/Mute/اخطار/حذف/خوش‌آمد.
 * Ban گروهی کاملاً مستقل از مسدودسازی ربات (banned_users) است.
 */
import { countRows, insertRow, selectOne, selectRows, updateRows } from "../_shared/db.ts";
import { TelegramError } from "../_shared/telegram.ts";
import { keyboard } from "../_shared/keyboards.ts";
import { displayName, faDateTime, faNum } from "../_shared/texts.ts";
import { escapeHtml, normalizeDigits, truncate } from "../_shared/validation.ts";
import type {
  GroupRow,
  GroupSettingsRow,
  TgChatMemberUpdated,
  TgMessage,
  WarningRow,
} from "../_shared/types.ts";
import { answerCallback, askConfirm, type Ctx, deleteMessageSafe, send } from "./context.ts";
import { ensureGroupRecord, getGroupSettings, markGroupInactive } from "./groups.ts";

export interface GroupRuntime {
  group: GroupRow;
  settings: GroupSettingsRow;
}

const runtimeCache = new Map<number, { runtime: GroupRuntime; loadedAt: number }>();
const RUNTIME_TTL_MS = 30_000;

export async function loadGroupRuntime(
  ctx: Ctx,
  force = false,
): Promise<GroupRuntime | null> {
  const chat = ctx.update.message?.chat ??
    ctx.update.callback_query?.message?.chat ??
    ctx.update.chat_member?.chat ??
    ctx.update.my_chat_member?.chat;
  if (!chat) return null;

  const cached = runtimeCache.get(chat.id);
  if (!force && cached && Date.now() - cached.loadedAt < RUNTIME_TTL_MS) {
    return cached.runtime;
  }

  const group = await ensureGroupRecord(ctx, chat);
  if (!group) return null;
  const settings = await getGroupSettings(ctx, chat.id);
  const runtime = { group, settings };
  runtimeCache.set(chat.id, { runtime, loadedAt: Date.now() });
  return runtime;
}

export function parseGroupCommand(
  text: string,
  botUsername: string,
): { command: string; args: string } | null {
  const match = text.match(/^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{3,32}))?\s*([\s\S]*)$/);
  if (!match) return null;
  const [, command, mention, args] = match;
  if (mention && mention.toLowerCase() !== botUsername.toLowerCase()) return null;
  return { command: command.toLowerCase(), args: args.trim() };
}

export function containsLink(text: string, entities: { type: string }[] | undefined): boolean {
  if (/(https?:\/\/|www\.|t\.me\/|telegram\.me\/)/i.test(text)) return true;
  if (/(^|\s)@[A-Za-z][A-Za-z0-9_]{4,31}/.test(text)) return true;
  if (entities) {
    return entities.some((entity) => ["url", "text_link", "mention"].includes(entity.type));
  }
  return false;
}

async function isWhitelistedLink(ctx: Ctx, text: string): Promise<boolean> {
  const channelUrl = (await ctx.settings.get("channel_url")).toLowerCase();
  const groupUrl = (await ctx.settings.get("group_url")).toLowerCase();
  const lower = text.toLowerCase();
  if (channelUrl && lower.includes(channelUrl)) return true;
  if (groupUrl && lower.includes(groupUrl)) return true;
  return false;
}

async function isGroupAdmin(ctx: Ctx, userId: number): Promise<boolean> {
  if (!ctx.chatId) return false;
  const result = await ctx.groupAdmins.getMember(ctx.chatId, userId);
  return result.isAdmin;
}

async function logModeration(
  ctx: Ctx,
  runtime: GroupRuntime,
  action: string,
  targetUserId: number | null,
  reason: string | null,
  metadata: Record<string, unknown> = {},
  actorId = ctx.userId,
): Promise<void> {
  try {
    await insertRow(ctx.sb, "moderation_logs", {
      group_id: runtime.group.telegram_chat_id,
      target_user_id: targetUserId,
      actor_id: actorId,
      action,
      reason,
      metadata,
    });
  } catch (error) {
    await ctx.log.warn("moderation log failed", { error: (error as Error).message });
  }
}

async function sendGroupNotice(
  ctx: Ctx,
  text: string,
  replyTo?: number,
): Promise<void> {
  try {
    await ctx.tg.sendMessage(ctx.chatId, text, {
      preview: false,
      replyTo,
      silent: true,
    });
  } catch (error) {
    if (!(error instanceof TelegramError)) throw error;
  }
}

async function activeWarnings(
  ctx: Ctx,
  runtime: GroupRuntime,
  userId: number,
): Promise<WarningRow[]> {
  return await selectRows<WarningRow>(
    ctx.sb,
    "user_warnings",
    (q) =>
      q.eq("group_id", runtime.group.telegram_chat_id)
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("created_at", { ascending: true }),
  );
}

async function applyWarnAction(
  ctx: Ctx,
  runtime: GroupRuntime,
  targetId: number,
  action: GroupSettingsRow["warn_action"],
): Promise<string> {
  const until = action === "mute"
    ? new Date(Date.now() + runtime.settings.mute_duration_minutes * 60_000)
    : undefined;

  if (action === "mute") {
    await ctx.tg.restrictChatMember(ctx.chatId, targetId, until);
    await upsertGroupBan(ctx, runtime, targetId, "mute", "رسیدن به حد اخطار", until);
    return `به مدت ${faNum(runtime.settings.mute_duration_minutes)} دقیقه سکوت شد`;
  }
  if (action === "kick") {
    await ctx.tg.banChatMember(ctx.chatId, targetId);
    await ctx.tg.unbanChatMember(ctx.chatId, targetId);
    return "از گروه اخراج شد";
  }
  await ctx.tg.banChatMember(ctx.chatId, targetId);
  await upsertGroupBan(ctx, runtime, targetId, "ban", "رسیدن به حد اخطار");
  return "از گروه مسدود شد";
}

async function upsertGroupBan(
  ctx: Ctx,
  runtime: GroupRuntime,
  targetId: number,
  kind: "ban" | "mute",
  reason: string,
  expiresAt?: Date,
): Promise<void> {
  const existing = await selectOne<{ id: number }>(
    ctx.sb,
    "group_bans",
    (q) =>
      q.eq("group_id", runtime.group.telegram_chat_id)
        .eq("user_id", targetId)
        .eq("kind", kind)
        .eq("is_active", true),
  );
  if (existing) {
    await updateRows(ctx.sb, "group_bans", {
      expires_at: expiresAt ? expiresAt.toISOString() : null,
      reason,
    }, { id: existing.id });
    return;
  }
  await insertRow(ctx.sb, "group_bans", {
    group_id: runtime.group.telegram_chat_id,
    user_id: targetId,
    kind,
    reason,
    expires_at: expiresAt ? expiresAt.toISOString() : null,
    created_by: ctx.userId,
  });
}

export async function issueWarning(
  ctx: Ctx,
  runtime: GroupRuntime,
  targetId: number,
  reason: string,
  options: { actorId?: number; sourceMessageId?: number; auto?: boolean } = {},
): Promise<{ count: number; escalated: boolean; message: string }> {
  const actorId = options.auto ? 0 : (options.actorId ?? ctx.userId);
  await insertRow(ctx.sb, "user_warnings", {
    group_id: runtime.group.telegram_chat_id,
    user_id: targetId,
    warned_by: actorId,
    reason,
  });
  await logModeration(
    ctx,
    runtime,
    options.auto ? "auto_action" : "warn",
    targetId,
    reason,
    { auto: options.auto === true, source: options.sourceMessageId ?? null },
    actorId,
  );

  const warnings = await activeWarnings(ctx, runtime, targetId);
  const limit = runtime.settings.warn_limit;

  if (warnings.length >= limit) {
    let actionMessage = "";
    try {
      actionMessage = await applyWarnAction(ctx, runtime, targetId, runtime.settings.warn_action);
      await logModeration(
        ctx,
        runtime,
        runtime.settings.warn_action === "mute"
          ? "mute"
          : runtime.settings.warn_action === "kick"
          ? "kick"
          : "ban",
        targetId,
        "رسیدن به حد اخطار",
        { auto: true, warnings: warnings.length },
        0,
      );
    } catch (error) {
      await sendGroupNotice(ctx, `⚠️ اعمال محدودیت ممکن نشد: ${(error as Error).message}`);
    }
    await updateRows(ctx.sb, "user_warnings", {
      is_active: false,
      revoked_at: new Date().toISOString(),
      revoked_by: 0,
    }, {
      group_id: runtime.group.telegram_chat_id,
      user_id: targetId,
      is_active: true,
    });

    await sendGroupNotice(
      ctx,
      `🚨 کاربر <code>${targetId}</code> به حد اخطار رسید و ${actionMessage}.`,
    );
    return { count: warnings.length, escalated: true, message: actionMessage };
  }

  await sendGroupNotice(
    ctx,
    `⚠️ کاربر <code>${targetId}</code> اخطار گرفت (${faNum(warnings.length)} از ${
      faNum(limit)
    }).\nدلیل: ${escapeHtml(reason)}`,
    options.sourceMessageId,
  );

  return { count: warnings.length, escalated: false, message: "" };
}

async function deleteIfNeeded(ctx: Ctx, runtime: GroupRuntime, messageId: number): Promise<void> {
  if (!runtime.settings.delete_warn_messages) return;
  await deleteMessageSafe(ctx, messageId);
}

/**
 * ⚖️ حالت سختگیرانه: اولین تخلف مستقیماً سکوت می‌شود، بدون صبر کردن برای
 * رسیدن به حد اخطار. اگر حالت سختگیرانه خاموش باشد false برمی‌گرداند تا
 * مسیر عادی اخطار اجرا شود.
 */
async function strictPunish(
  ctx: Ctx,
  runtime: GroupRuntime,
  targetId: number,
  reason: string,
): Promise<boolean> {
  if (runtime.settings.strict_mode !== true) return false;
  const until = new Date(Date.now() + runtime.settings.mute_duration_minutes * 60_000);
  try {
    await ctx.tg.restrictChatMember(ctx.chatId, targetId, until);
    await upsertGroupBan(ctx, runtime, targetId, "mute", reason, until);
    await logModeration(ctx, runtime, "auto_action", targetId, reason, {
      auto: true,
      strict: true,
    }, 0);
    await sendGroupNotice(
      ctx,
      `⚖️ حالت سختگیرانه: کاربر <code>${targetId}</code> برای ${
        faNum(runtime.settings.mute_duration_minutes)
      } دقیقه سکوت شد.\nدلیل: ${escapeHtml(reason)}`,
    );
  } catch (error) {
    await ctx.log.warn("strict punish failed", { error: (error as Error).message });
  }
  return true;
}

/** ورودی همه‌ی پیام‌های گروه (شامل دستورات). */
export async function handleGroupMessage(ctx: Ctx): Promise<void> {
  const message = ctx.update.message;
  if (!message || !message.from || message.from.is_bot) return;

  const runtime = await loadGroupRuntime(ctx);
  if (!runtime) return;

  const text = message.text ?? message.caption ?? "";
  const command = text.startsWith("/") ? parseGroupCommand(text, ctx.cfg.botUsername) : null;
  if (command) {
    await handleGroupCommand(ctx, message, command, runtime);
    return;
  }

  if (!runtime.group.is_active || !runtime.group.bot_is_admin) return;
  if (await isGroupAdmin(ctx, ctx.userId)) return;

  const targetId = message.from.id;

  // ضدلینک
  if (runtime.settings.antilink_enabled && containsLink(text, message.entities)) {
    if (!(await isWhitelistedLink(ctx, text))) {
      await deleteIfNeeded(ctx, runtime, message.message_id);
      if (await strictPunish(ctx, runtime, targetId, "ارسال لینک ناخواسته")) return;
      await issueWarning(ctx, runtime, targetId, "ارسال لینک ناخواسته", {
        sourceMessageId: message.message_id,
        auto: true,
      });
      return;
    }
  }

  // جلوگیری از فوروارد
  if (
    runtime.settings.block_forwards &&
    (message.forward_origin || message.forward_date) &&
    !message.is_automatic_forward
  ) {
    await deleteIfNeeded(ctx, runtime, message.message_id);
    if (await strictPunish(ctx, runtime, targetId, "ارسال پیام فوروارد")) return;
    await issueWarning(ctx, runtime, targetId, "ارسال پیام فوروارد", {
      sourceMessageId: message.message_id,
      auto: true,
    });
    return;
  }

  // ضداسپم (پنجره‌ی لغزان)
  if (runtime.settings.antispam_enabled) {
    const decision = ctx.limiter.hit(
      `flood:${ctx.chatId}:${targetId}`,
      runtime.settings.flood_limit,
      runtime.settings.flood_window_seconds * 1000,
      ctx.now.getTime(),
    );
    if (!decision.allowed) {
      const cooldown = ctx.limiter.hit(`warned:${ctx.chatId}:${targetId}`, 1, 30_000);
      await deleteMessageSafe(ctx, message.message_id);
      if (cooldown.allowed && await strictPunish(ctx, runtime, targetId, "ارسال پیام سریع/اسپم")) {
        return;
      }
      if (cooldown.allowed) {
        await issueWarning(ctx, runtime, targetId, "ارسال پیام سریع/اسپم", {
          sourceMessageId: message.message_id,
          auto: true,
        });
      }
      return;
    }
  }
}

// ─── group commands ──────────────────────────────────────────────────────────

function targetFromMessage(
  message: TgMessage,
  args: string,
): { targetId: number | null; rest: string } {
  const reply = message.reply_to_message?.from;
  if (reply && !reply.is_bot) return { targetId: reply.id, rest: args };

  const match = normalizeDigits(args).match(/^(\d{3,20})\s*([\s\S]*)$/);
  if (match) return { targetId: Number(match[1]), rest: match[2].trim() };
  return { targetId: null, rest: args };
}

async function requireBotAdmin(ctx: Ctx, runtime: GroupRuntime): Promise<boolean> {
  if (runtime.group.bot_is_admin) return true;
  await sendGroupNotice(ctx, "⛔ برای انجام این اقدام، ربات باید در گروه ادمین باشد.");
  return false;
}

async function requireGroupAdmin(ctx: Ctx): Promise<boolean> {
  if (await isGroupAdmin(ctx, ctx.userId)) return true;
  await sendGroupNotice(ctx, "⛔ این دستور فقط برای ادمین‌های گروه است.");
  return false;
}

export async function handleGroupCommand(
  ctx: Ctx,
  message: TgMessage,
  command: { command: string; args: string },
  runtime: GroupRuntime,
): Promise<void> {
  const { command: name, args } = command;
  const chatId = runtime.group.telegram_chat_id;

  if (name === "rules") {
    await sendGroupNotice(ctx, `<b>📜 قوانین گروه</b>\n${escapeHtml(runtime.settings.rules_text)}`);
    return;
  }

  if (name === "id") {
    await sendGroupNotice(
      ctx,
      `🆔 گروه: <code>${chatId}</code>\n👤 شما: <code>${ctx.userId}</code>`,
      message.message_id,
    );
    return;
  }

  if (name === "report") {
    const reply = message.reply_to_message;
    if (!reply?.from) {
      await sendGroupNotice(
        ctx,
        "برای گزارش، روی پیام متخلف ریپلای کنید و /report بزنید.",
        message.message_id,
      );
      return;
    }
    const reportTarget = runtime.settings.log_channel_id;
    const reportText = [
      "🚨 <b>گزارش تخلف</b>",
      `گروه: ${escapeHtml(runtime.group.title ?? String(chatId))}`,
      `گزارش‌دهنده: <code>${ctx.userId}</code>`,
      `متخلف: <code>${reply.from.id}</code>`,
      `دلیل: ${escapeHtml(args || "—")}`,
      `پیام: ${escapeHtml(truncate(reply.text ?? reply.caption ?? "[مدیا]", 300))}`,
    ].join("\n");

    if (reportTarget) {
      try {
        await ctx.tg.sendMessage(reportTarget, reportText);
      } catch {
        // اگر ارسال نشد، برای مالکان می‌فرستیم
      }
    } else {
      for (const owner of ctx.cfg.superAdminIds) {
        try {
          await ctx.tg.sendMessage(owner, reportText);
        } catch {
          // ignore
        }
      }
    }
    await logModeration(ctx, runtime, "report", reply.from.id, args || null);
    await sendGroupNotice(ctx, "✅ گزارش شما ثبت و برای مدیران ارسال شد.", message.message_id);
    return;
  }

  if (name === "settings" || name === "panel") {
    if (!(await requireGroupAdmin(ctx))) return;
    await sendGroupNotice(
      ctx,
      "⚙️ تنظیمات این گروه از داشبورد خصوصی ربات انجام می‌شود.",
      message.message_id,
    );
    try {
      await ctx.tg.sendMessage(
        ctx.chatId,
        `⚙️ <a href="https://t.me/${ctx.cfg.botUsername}?start=admin">باز کردن داشبورد مدیریت</a>`,
        { preview: false, replyTo: message.message_id },
      );
    } catch {
      // ignore
    }
    return;
  }

  if (
    !["warn", "warns", "unwarn", "ban", "unban", "kick", "mute", "unmute", "del", "purge"].includes(
      name,
    )
  ) {
    return;
  }

  if (!(await requireGroupAdmin(ctx))) return;

  if (name === "warns") {
    const { targetId } = targetFromMessage(message, args);
    const userId = targetId ?? ctx.userId;
    const warnings = await activeWarnings(ctx, runtime, userId);
    if (warnings.length === 0) {
      await sendGroupNotice(
        ctx,
        `کاربر <code>${userId}</code> اخطار فعالی ندارد.`,
        message.message_id,
      );
      return;
    }
    const lines = warnings.slice(-5).map((warning, index) =>
      `${faNum(index + 1)}. ${escapeHtml(warning.reason ?? "—")} — ${
        faDateTime(warning.created_at)
      }`
    );
    await sendGroupNotice(
      ctx,
      `⚠️ اخطارهای <code>${userId}</code> (${faNum(warnings.length)}/${
        faNum(runtime.settings.warn_limit)
      }):\n${lines.join("\n")}`,
      message.message_id,
    );
    return;
  }

  if (!(await requireBotAdmin(ctx, runtime))) return;

  if (name === "warn") {
    const { targetId, rest } = targetFromMessage(message, args);
    if (!targetId) {
      await sendGroupNotice(
        ctx,
        "روی پیام کاربر ریپلای کنید یا شناسه بدهید: <code>/warn 123456 دلیل</code>",
        message.message_id,
      );
      return;
    }
    await deleteIfNeeded(ctx, runtime, message.message_id);
    await issueWarning(ctx, runtime, targetId, rest || "تخلف از قوانین", {
      sourceMessageId: message.message_id,
    });
    return;
  }

  if (name === "unwarn") {
    const { targetId } = targetFromMessage(message, args);
    if (!targetId) {
      await sendGroupNotice(ctx, "کاربر را ریپلای یا شناسه را وارد کنید.", message.message_id);
      return;
    }
    const warnings = await activeWarnings(ctx, runtime, targetId);
    const last = warnings[warnings.length - 1];
    if (!last) {
      await sendGroupNotice(ctx, "اخطار فعالی برای حذف وجود ندارد.", message.message_id);
      return;
    }
    await updateRows(ctx.sb, "user_warnings", {
      is_active: false,
      revoked_at: new Date().toISOString(),
      revoked_by: ctx.userId,
    }, { id: last.id });
    await logModeration(ctx, runtime, "unwarn", targetId, null);
    await sendGroupNotice(
      ctx,
      `✅ یک اخطار از <code>${targetId}</code> حذف شد.`,
      message.message_id,
    );
    return;
  }

  if (name === "ban" || name === "kick") {
    const { targetId, rest } = targetFromMessage(message, args);
    if (!targetId) {
      await sendGroupNotice(ctx, "کاربر را ریپلای کنید یا شناسه بدهید.", message.message_id);
      return;
    }
    if (await isGroupAdmin(ctx, targetId)) {
      await sendGroupNotice(ctx, "⛔ نمی‌توان ادمین گروه را بن/کیک کرد.", message.message_id);
      return;
    }
    await askConfirm(
      ctx,
      [
        `${name === "ban" ? "🚫 <b>تأیید Ban</b>" : "👢 <b>تأیید اخراج</b>"}`,
        `گروه: ${escapeHtml(runtime.group.title ?? String(chatId))}`,
        `کاربر: <code>${targetId}</code>`,
        rest ? `دلیل: ${escapeHtml(rest)}` : "",
        "این اقدام در لاگ گروه ثبت می‌شود.",
      ].filter(Boolean).join("\n"),
      name === "ban" ? "group_ban" : "group_kick",
      { chatId, targetId, reason: rest || null },
      "a:h",
    );
    return;
  }

  if (name === "unban") {
    const { targetId } = targetFromMessage(message, args);
    if (!targetId) {
      await sendGroupNotice(ctx, "شناسه یا ریپلای کاربر را بفرستید.", message.message_id);
      return;
    }
    try {
      await ctx.tg.unbanChatMember(ctx.chatId, targetId);
      await updateRows(ctx.sb, "group_bans", {
        is_active: false,
        lifted_at: new Date().toISOString(),
        lifted_by: ctx.userId,
      }, { group_id: chatId, user_id: targetId, is_active: true });
      await logModeration(ctx, runtime, "unban", targetId, null);
      await sendGroupNotice(
        ctx,
        `✅ کاربر <code>${targetId}</code> رفع مسدودی شد.`,
        message.message_id,
      );
    } catch (error) {
      await sendGroupNotice(
        ctx,
        `⚠️ رفع مسدودی ناموفق: ${(error as Error).message}`,
        message.message_id,
      );
    }
    return;
  }

  if (name === "mute") {
    const { targetId, rest } = targetFromMessage(message, args);
    if (!targetId) {
      await sendGroupNotice(ctx, "کاربر را ریپلای کنید یا شناسه بدهید.", message.message_id);
      return;
    }
    const minutes = Number(normalizeDigits(rest).replace(/[^\d]/g, "")) ||
      runtime.settings.mute_duration_minutes;
    const until = new Date(Date.now() + Math.min(Math.max(minutes, 1), 525600) * 60_000);
    try {
      await ctx.tg.restrictChatMember(ctx.chatId, targetId, until);
      await upsertGroupBan(ctx, runtime, targetId, "mute", "دستور ادمین", until);
      await logModeration(ctx, runtime, "mute", targetId, `مدت ${minutes} دقیقه`);
      await sendGroupNotice(
        ctx,
        `🔇 کاربر <code>${targetId}</code> برای ${faNum(minutes)} دقیقه سکوت شد.`,
        message.message_id,
      );
    } catch (error) {
      await sendGroupNotice(ctx, `⚠️ سکوت ناموفق: ${(error as Error).message}`, message.message_id);
    }
    return;
  }

  if (name === "unmute") {
    const { targetId } = targetFromMessage(message, args);
    if (!targetId) {
      await sendGroupNotice(ctx, "کاربر را ریپلای کنید یا شناسه بدهید.", message.message_id);
      return;
    }
    try {
      await ctx.tg.unrestrictChatMember(ctx.chatId, targetId);
      await updateRows(ctx.sb, "group_bans", {
        is_active: false,
        lifted_at: new Date().toISOString(),
        lifted_by: ctx.userId,
      }, { group_id: chatId, user_id: targetId, kind: "mute", is_active: true });
      await logModeration(ctx, runtime, "unmute", targetId, null);
      await sendGroupNotice(
        ctx,
        `🔊 کاربر <code>${targetId}</code> از سکوت خارج شد.`,
        message.message_id,
      );
    } catch (error) {
      await sendGroupNotice(ctx, `⚠️ ناموفق: ${(error as Error).message}`, message.message_id);
    }
    return;
  }

  if (name === "del") {
    if (!message.reply_to_message) {
      await sendGroupNotice(ctx, "روی پیامی که می‌خواهید حذف شود ریپلای کنید.", message.message_id);
      return;
    }
    await deleteMessageSafe(ctx, message.reply_to_message.message_id);
    await logModeration(
      ctx,
      runtime,
      "delete_message",
      message.reply_to_message.from?.id ?? null,
      null,
      {
        messageId: message.reply_to_message.message_id,
      },
    );
    await deleteMessageSafe(ctx, message.message_id);
    return;
  }

  if (name === "purge") {
    const count = Math.min(
      Math.max(Number(normalizeDigits(args).replace(/[^\d]/g, "")) || 10, 1),
      50,
    );
    const fromId = message.reply_to_message?.message_id ?? message.message_id;
    await askConfirm(
      ctx,
      `🧹 <b>پاک‌سازی ${
        faNum(count)
      } پیام</b>\nاز پیام <code>${fromId}</code> به بعد حذف می‌شود (حداکثر ۵۰).`,
      "group_purge",
      { chatId, fromMessageId: fromId, count },
      "a:h",
    );
    return;
  }
}

// ─── welcome / goodbye ───────────────────────────────────────────────────────

function fillTemplate(
  template: string,
  values: { name: string; username: string; group: string },
): string {
  return template
    .replace(/\{name\}/g, values.name)
    .replace(/\{username\}/g, values.username)
    .replace(/\{group\}/g, values.group);
}

export async function handleChatMemberUpdate(ctx: Ctx, update: TgChatMemberUpdated): Promise<void> {
  const runtime = await loadGroupRuntime(ctx, true);
  if (!runtime) return;

  const oldStatus = update.old_chat_member.status;
  const newStatus = update.new_chat_member.status;
  const user = update.new_chat_member.user;
  const groupTitle = runtime.group.title ?? String(runtime.group.telegram_chat_id);

  // 🔍 تأیید هویت: عضو تازه تا زدن دکمه، محدود می‌شود (فقط اگر مدیر روشن کرده باشد).
  if (["left", "kicked"].includes(oldStatus) && newStatus === "member" && !user.is_bot) {
    const gate = ctx.limiter.hit(`verify:${ctx.chatId}:${user.id}`, 1, 120_000);
    if (runtime.settings.verify_enabled === true && gate.allowed) {
      const mention = `<a href="tg://user?id=${user.id}">${escapeHtml(displayName(user))}</a>`;
      try {
        await ctx.tg.call<boolean>("restrictChatMember", {
          chat_id: ctx.chatId,
          user_id: user.id,
          permissions: {
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
          },
        });
        await ctx.tg.sendMessage(
          ctx.chatId,
          [
            `🔍 ${mention} عزیز، خوش آمدی!`,
            "برای اینکه بتوانی در گروه پیام بفرستی، روی دکمهٔ زیر بزن و هویتت را تأیید کن.",
          ].join("\n"),
          {
            preview: false,
            markup: keyboard([[
              { text: "✅ تأیید هویت", callback_data: `gp:v:${user.id}`, style: "success" },
            ]]),
          },
        );
      } catch (error) {
        await ctx.log.warn("verify prompt failed", {
          chatId: ctx.chatId,
          error: (error as Error).message,
        });
      }
    }
  }

  if (["left", "kicked"].includes(oldStatus) && ["member", "restricted"].includes(newStatus)) {
    const dedupe = ctx.limiter.hit(`welcome:${ctx.chatId}:${user.id}`, 1, 60_000);
    if (!dedupe.allowed || !runtime.settings.welcome_enabled) return;

    const name = displayName(user);
    const mention = `<a href="tg://user?id=${user.id}">${escapeHtml(name)}</a>`;
    let text = fillTemplate(runtime.settings.welcome_text, {
      name: mention,
      username: user.username ? `@${user.username}` : name,
      group: escapeHtml(groupTitle),
    });
    // اگر متن دلخواه اسم عضو را نداشت، با نام همان عضو سلام می‌کنیم.
    if (!runtime.settings.welcome_text.includes("{name}")) {
      text = `👋 ${mention} عزیز، خوش آمدی!\n\n${text}`;
    }
    await send(ctx, text);
    return;
  }

  if (
    ["member", "restricted", "administrator", "creator"].includes(oldStatus) &&
    ["left", "kicked"].includes(newStatus)
  ) {
    const dedupe = ctx.limiter.hit(`goodbye:${ctx.chatId}:${user.id}`, 1, 60_000);
    if (!dedupe.allowed || !runtime.settings.goodbye_enabled) return;

    const name = displayName(user);
    const text = fillTemplate(runtime.settings.goodbye_text, {
      name: escapeHtml(name),
      username: user.username ? `@${user.username}` : name,
      group: escapeHtml(groupTitle),
    });
    await send(ctx, text);
  }
}

export async function handleMyChatMemberUpdate(
  ctx: Ctx,
  update: TgChatMemberUpdated,
): Promise<void> {
  const chat = update.chat;
  const newStatus = update.new_chat_member.status;
  const oldStatus = update.old_chat_member.status;

  if (["left", "kicked"].includes(newStatus)) {
    await markGroupInactive(ctx, chat.id);
    runtimeCache.delete(chat.id);
    return;
  }

  const runtime = await loadGroupRuntime(ctx, true);
  if (!runtime) return;

  if (
    ["member", "administrator", "creator"].includes(newStatus) &&
    ["left", "kicked"].includes(oldStatus)
  ) {
    runtimeCache.delete(chat.id);
    const isAdmin = newStatus === "administrator" || newStatus === "creator";
    const adder = update.from;
    const adderName = displayName(adder);
    const adderMention = `<a href="tg://user?id=${adder.id}">${escapeHtml(adderName)}</a>`;
    const groupTitle = escapeHtml(chat.title ?? String(chat.id));
    await send(
      ctx,
      [
        `👋 سلام ${adderMention}، خوش آمدی!`,
        `ممنون که <b>Anime Click Ultimate</b> را به گروه «${groupTitle}» اضافه کردی.`,
        "",
        `وضعیت دسترسی مدیریت: ${isAdmin ? "✅ ادمین" : "❌ ادمین نیست"}`,
        isAdmin
          ? "ضدلینک، ضدتبچی، اخطار، قفل گروه و خوش‌آمدگویی آماده است."
          : "برای فعال‌شدن امکانات مدیریتی، ربات را ادمین کن.",
        "",
        "برای دیدن پنل گروه همین‌جا بنویس /panel یا دکمه‌های زیر را بزن.",
      ].join("\n"),
      keyboard([
        [
          { text: "🛡 پنل گروه", callback_data: "gp:p:1", style: "primary" },
          { text: "⚙️ تنظیمات کامل", url: `https://t.me/${ctx.cfg.botUsername}?start=admin` },
        ],
      ]),
    );
  }
}

// ─── group confirmations ─────────────────────────────────────────────────────

export async function runGroupConfirm(
  ctx: Ctx,
  action: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  if (!action.startsWith("group_")) return false;

  const chatId = Number(args.chatId ?? ctx.chatId);
  if (!Number.isSafeInteger(chatId) || chatId !== ctx.chatId) {
    await answerCallback(ctx, "این تأیید برای این گروه معتبر نیست.", true);
    return true;
  }
  if (!(await isGroupAdmin(ctx, ctx.userId))) {
    await answerCallback(ctx, "⛔ فقط ادمین‌های گروه می‌توانند تأیید کنند.", true);
    return true;
  }

  const runtime = await loadGroupRuntime(ctx, true);
  if (!runtime) {
    await answerCallback(ctx, "گروه پیدا نشد.", true);
    return true;
  }
  if (!runtime.group.bot_is_admin) {
    await answerCallback(ctx, "ربات در این گروه ادمین نیست.", true);
    return true;
  }

  if (action === "group_ban" || action === "group_kick") {
    const targetId = Number(args.targetId);
    const reason = args.reason ? String(args.reason) : null;
    if (!Number.isSafeInteger(targetId)) {
      await answerCallback(ctx, "شناسه کاربر نامعتبر است.", true);
      return true;
    }
    if (await isGroupAdmin(ctx, targetId)) {
      await answerCallback(ctx, "نمی‌توان ادمین گروه را محدود کرد.", true);
      return true;
    }

    try {
      await ctx.tg.banChatMember(chatId, targetId);
      if (action === "group_kick") {
        await ctx.tg.unbanChatMember(chatId, targetId);
        await logModeration(ctx, runtime, "kick", targetId, reason);
        await send(ctx, `👢 کاربر <code>${targetId}</code> اخراج شد.`);
      } else {
        await upsertGroupBan(ctx, runtime, targetId, "ban", reason ?? "دستور ادمین");
        await logModeration(ctx, runtime, "ban", targetId, reason);
        await send(ctx, `🚫 کاربر <code>${targetId}</code> مسدود شد.`);
      }
    } catch (error) {
      await send(ctx, `⚠️ اقدام ناموفق: ${(error as Error).message}`);
    }
    return true;
  }

  if (action === "group_purge") {
    const fromId = Number(args.fromMessageId);
    const count = Math.min(Math.max(Number(args.count ?? 10), 1), 50);
    let deleted = 0;
    for (let i = 0; i < count; i++) {
      const messageId = fromId + i;
      const ok = await deleteMessageSafe(ctx, messageId);
      if (ok) deleted++;
    }
    await logModeration(ctx, runtime, "purge", null, `${deleted} پیام`, {
      fromMessageId: fromId,
      requested: count,
    });
    await send(ctx, `🧹 ${faNum(deleted)} پیام پاک شد.`);
    return true;
  }

  return true;
}

export async function groupMemberCount(ctx: Ctx, chatId: number): Promise<number | null> {
  try {
    return await ctx.tg.getChatMemberCount(chatId);
  } catch {
    return null;
  }
}

export async function updateGroupMemberCount(ctx: Ctx): Promise<void> {
  const runtime = await loadGroupRuntime(ctx);
  if (!runtime) return;
  const count = await groupMemberCount(ctx, runtime.group.telegram_chat_id);
  if (count === null) return;
  await updateRows(ctx.sb, "groups", {
    member_count: count,
    updated_at: new Date().toISOString(),
  }, { telegram_chat_id: runtime.group.telegram_chat_id });
}

export async function groupStats(ctx: Ctx): Promise<void> {
  if (!(await isGroupAdmin(ctx, ctx.userId))) return;
  const warnings = await countRows(
    ctx.sb,
    "user_warnings",
    (q) => q.eq("group_id", ctx.chatId).eq("is_active", true),
  );
  const actions = await countRows(ctx.sb, "moderation_logs", (q) => q.eq("group_id", ctx.chatId));
  await send(
    ctx,
    [
      "<b>📊 آمار گروه</b>",
      `اخطارهای فعال: ${faNum(warnings)}`,
      `اقدامات ثبت‌شده: ${faNum(actions)}`,
    ].join("\n"),
  );
}
