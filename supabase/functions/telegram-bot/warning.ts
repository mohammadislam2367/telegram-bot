/**
 * ⚠️ سیستم اخطار — متن اخطار را صاحب ربات یک‌بار می‌نویسد و ربات همان متن را
 * به متخلف تحویل می‌دهد.
 *
 * روش نوشتن (فقط برای مالک ربات، در چت خصوصی):
 *   اخطار <متن دلخواه>
 *   /warning <متن دلخواه>
 *   /warning            → نمایش متن فعلی
 *   /warning reset      → بازگرداندن متن پیش‌فرض
 *
 * متغیرهای مجاز: {name} {count} {limit} {group} {bot}
 */
import { DEFAULT_SETTINGS } from "../_shared/settings.ts";
import { containsProfanity, isDirectedAtBot } from "../_shared/profanity.ts";
import { insertRow, selectOne } from "../_shared/db.ts";
import { keyboard } from "../_shared/keyboards.ts";
import { divider, faNum, sectionTitle } from "../_shared/texts.ts";
import { escapeHtml, sanitizeText } from "../_shared/validation.ts";
import { type Ctx, logAdminAction, send } from "./context.ts";

export const WARNING_SETTING_KEY = "group_warning_text";
export const WARNING_MIN_LENGTH = 10;
export const WARNING_MAX_LENGTH = 600;

export interface WarningValues {
  name: string;
  count?: number;
  limit?: number;
  group?: string;
  bot?: string;
}

export function isOwner(ctx: Ctx): boolean {
  return ctx.admin?.role === "owner";
}

/** نام کاربر به‌صورت منشن امن HTML. */
export function userNameLink(
  user?: {
    id?: number;
    first_name?: string | null;
    last_name?: string | null;
    username?: string | null;
  } | null,
): string {
  if (!user) return "کاربر";
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
    (user.username ? `@${user.username}` : "کاربر");
  if (!user.id) return escapeHtml(name);
  return `<a href="tg://user?id=${user.id}">${escapeHtml(name)}</a>`;
}

export function fillWarning(template: string, values: WarningValues): string {
  // متن مالک به‌صورت متن ساده ذخیره می‌شود تا HTML ناقص هرگز ارسال اخطار را نشکند؛
  // فقط مقادیر تزریقی (منشن کاربر) HTML دارند.
  return escapeHtml(template)
    .replace(/\{name\}/g, values.name)
    .replace(/\{count\}/g, values.count !== undefined ? faNum(values.count) : "—")
    .replace(/\{limit\}/g, values.limit !== undefined ? faNum(values.limit) : "—")
    .replace(/\{group\}/g, values.group ? escapeHtml(values.group) : "")
    .replace(/\{bot\}/g, values.bot ? `@${escapeHtml(values.bot)}` : "ربات");
}

/** متن اخطار آماده‌ی ارسال با مقادیر واقعی. */
export async function renderWarning(ctx: Ctx, values: WarningValues): Promise<string> {
  const template = await ctx.settings.get(WARNING_SETTING_KEY);
  return fillWarning(template || DEFAULT_SETTINGS[WARNING_SETTING_KEY], values);
}

function previewText(ctx: Ctx, template: string): string {
  return fillWarning(template, {
    name: userNameLink(ctx.user),
    count: 1,
    limit: 3,
    group: "گروه نمونه",
    bot: ctx.cfg.botUsername,
  });
}

const HELP_HINT = [
  "<i>متغیرهای مجاز:</i>",
  "<code>{name}</code> نام متخلف • <code>{count}</code> شماره اخطار • " +
  "<code>{limit}</code> سقف اخطار • <code>{group}</code> نام گروه • " +
  "<code>{bot}</code> یوزرنیم ربات",
].join("\n");

async function showWarning(ctx: Ctx): Promise<void> {
  const template = await ctx.settings.get(WARNING_SETTING_KEY);
  await send(
    ctx,
    [
      sectionTitle("⚠️ متن اخطار گروه‌ها"),
      divider(),
      "<b>متن فعلی:</b>",
      template,
      "",
      "<b>پیش‌نمایش:</b>",
      previewText(ctx, template),
      "",
      HELP_HINT,
      "",
      "برای تغییر، همین‌جا بنویس: <code>اخطار متن جدید…</code>",
      "برای بازگردانی پیش‌فرض: <code>/warning reset</code>",
    ].join("\n"),
    keyboard([
      [{ text: "🏠 منوی اصلی", callback_data: "u:m" }, { text: "🎛 داشبورد", callback_data: "a:h" }],
    ]),
  );
}

async function saveWarning(ctx: Ctx, raw: string): Promise<void> {
  const value = sanitizeText(raw, WARNING_MAX_LENGTH);
  if (value.length < WARNING_MIN_LENGTH) {
    await send(
      ctx,
      `⚠️ متن اخطار باید حداقل ${faNum(WARNING_MIN_LENGTH)} کاراکتر باشد.\n` +
        "مثال: <code>اخطار {name} عزیز، این اخطار {count} از {limit} است.</code>",
    );
    return;
  }

  await ctx.settings.set(WARNING_SETTING_KEY, value, ctx.userId);
  await logAdminAction(ctx, "group_warning_text_update", "setting", WARNING_SETTING_KEY, {
    length: value.length,
  });

  await send(
    ctx,
    [
      "✅ <b>متن اخطار ذخیره شد.</b>",
      divider(),
      "<b>پیش‌نمایش در گروه:</b>",
      previewText(ctx, value),
      "",
      HELP_HINT,
      "",
      "<i>از این به بعد هر وقت کسی در گروه یا چت خصوصی به ربات توهین کند، " +
      "ربات همین متن را خطاب به او می‌فرستد.</i>",
    ].join("\n"),
    keyboard([
      [{ text: "🏠 منوی اصلی", callback_data: "u:m" }, { text: "🎛 داشبورد", callback_data: "a:h" }],
    ]),
  );
}

async function resetWarning(ctx: Ctx): Promise<void> {
  await ctx.settings.set(
    WARNING_SETTING_KEY,
    DEFAULT_SETTINGS[WARNING_SETTING_KEY],
    ctx.userId,
  );
  await logAdminAction(ctx, "group_warning_text_reset", "setting", WARNING_SETTING_KEY);
  await send(ctx, "♻️ متن اخطار به حالت پیش‌فرض بازگشت.");
  await showWarning(ctx);
}

/** دستور /warning با آرگومان‌هایش. فقط مالک ربات. */
export async function handleOwnerWarningCommand(ctx: Ctx, args: string): Promise<boolean> {
  if (!isOwner(ctx)) {
    await send(ctx, "⛔ تنظیم متن اخطار فقط در اختیار صاحب ربات است.");
    return true;
  }
  const value = args.trim();
  if (value.length === 0) {
    await showWarning(ctx);
    return true;
  }
  if (["reset", "default", "پیش‌فرض", "بازگردانی"].includes(value.toLowerCase())) {
    await resetWarning(ctx);
    return true;
  }
  await saveWarning(ctx, value);
  return true;
}

/**
 * توهین مستقیم به ربات در گروه (ریپلای یا منشن) → همان متن اخطار صاحب ربات.
 * اگر پیام به ربات نباشد یا فحش نداشته باشد، false برمی‌گرداند تا مسیر
 * عادی مدیریت گروه ادامه پیدا کند.
 */
export async function handleGroupInsult(ctx: Ctx): Promise<boolean> {
  const message = ctx.update.message;
  if (!message?.from || message.from.is_bot) return false;

  const text = message.text ?? message.caption ?? "";
  if (text.length === 0) return false;
  if (!isDirectedAtBot(message, ctx.cfg.botUsername)) return false;
  if (!containsProfanity(text)) return false;

  const decision = ctx.limiter.hit(
    `bot-insult:${ctx.chatId}:${message.from.id}`,
    1,
    15_000,
    ctx.now.getTime(),
  );
  if (!decision.allowed) return true;

  const settings = await selectOne<{ warn_limit: number; delete_warn_messages: boolean }>(
    ctx.sb,
    "group_settings",
    (q) => q.eq("group_id", ctx.chatId),
  );
  const group = await selectOne<{ title: string | null }>(
    ctx.sb,
    "groups",
    (q) => q.eq("telegram_chat_id", ctx.chatId),
  );

  const warning = await renderWarning(ctx, {
    name: userNameLink(message.from),
    count: 1,
    limit: settings?.warn_limit ?? 3,
    group: group?.title ?? "",
    bot: ctx.cfg.botUsername,
  });

  try {
    await ctx.tg.sendMessage(ctx.chatId, warning, {
      preview: false,
      replyTo: message.message_id,
      silent: true,
    });
  } catch {
    // اگر ربات نتوانست پاسخ دهد، مسیر عادی ادامه می‌یابد
  }

  if (settings?.delete_warn_messages) {
    try {
      await ctx.tg.deleteMessage(ctx.chatId, message.message_id);
    } catch {
      // بدون دسترسی حذف، فقط اخطار ارسال می‌شود
    }
  }

  try {
    await insertRow(ctx.sb, "moderation_logs", {
      group_id: ctx.chatId,
      target_user_id: message.from.id,
      actor_id: ctx.userId,
      action: "bot_warning",
      reason: "توهین به ربات",
      metadata: { messageId: message.message_id },
    });
  } catch {
    // لاگ اختیاری است
  }

  return true;
}

/** توهین به ربات در چت خصوصی → همان متن اخطار صاحب ربات. */
export async function handlePrivateInsult(ctx: Ctx, text: string): Promise<boolean> {
  if (!containsProfanity(text)) return false;
  const decision = ctx.limiter.hit(`insult:${ctx.userId}`, 1, 10 * 60_000, ctx.now.getTime());
  if (!decision.allowed) return false;

  const warning = await renderWarning(ctx, {
    name: userNameLink(ctx.user),
    count: 1,
    limit: 3,
    group: "چت خصوصی",
    bot: ctx.cfg.botUsername,
  });
  await send(ctx, warning, keyboard([[{ text: "🏠 منوی اصلی", callback_data: "u:m" }]]));
  return true;
}

/**
 * پیام ساده‌ی صاحب ربات که با «اخطار» یا «هشدار» شروع می‌شود.
 * برای بقیه‌ی کاربران false برمی‌گرداند تا پیام عادی به AI برود.
 */
export async function tryOwnerWarningKeyword(ctx: Ctx, text: string): Promise<boolean> {
  if (!isOwner(ctx)) return false;
  const match = text.match(/^\s*(?:اخطار|هشدار)(?:\s+([\s\S]*))?$/);
  if (!match) return false;

  const value = (match[1] ?? "").trim();
  if (value.length === 0) {
    await showWarning(ctx);
    return true;
  }
  if (["حذف", "پاک", "reset", "پیش‌فرض"].includes(value.toLowerCase())) {
    await resetWarning(ctx);
    return true;
  }
  await saveWarning(ctx, value);
  return true;
}
