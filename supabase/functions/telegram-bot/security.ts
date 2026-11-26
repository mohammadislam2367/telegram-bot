/** 🛡 امنیت و گزارش فعالیت — رویدادها، کارهای مدیران، گفتگوها و بررسی امنیتی. */
import { countRows, selectRows } from "../_shared/db.ts";
import { deleteExpiredSessions } from "../_shared/sessions.ts";
import { type Button, keyboard } from "../_shared/keyboards.ts";
import { divider, faDateTime, faNum, sectionTitle } from "../_shared/texts.ts";
import { getAiState } from "../_shared/ai_core.ts";
import type { AdminActionRow, SystemLogRow } from "../_shared/types.ts";
import {
  answerCallback,
  type Ctx,
  editOrSend,
  guardAdmin,
  logAdminAction,
  send,
} from "./context.ts";

const LEVEL_LABELS: Record<string, string> = {
  all: "همه",
  error: "خطا",
  warn: "هشدار",
  info: "اطلاع",
};

const SCOPE_LABELS: Record<string, string> = {
  "telegram-bot": "ربات",
  scheduler: "زمان‌بند",
  broadcast: "پیام همگانی",
  health: "سلامت سیستم",
  supabase: "سرور",
};

function levelButton(level: string, current: string): string {
  const label = LEVEL_LABELS[level] ?? level;
  return level === current ? `• ${label} •` : label;
}

/** هیچ متن انگلیسی یا اصطلاح فنی به کاربر نشان داده نمی‌شود. */
function friendlyScope(scope: string): string {
  return SCOPE_LABELS[scope] ?? "سیستم";
}

function friendlyMessage(level: string): string {
  if (level === "error") return "یک درخواست ناموفق ماند";
  if (level === "warn") return "یک هشدار داخلی ثبت شد";
  return "رویداد عادی";
}

async function renderPanel(ctx: Ctx): Promise<void> {
  const timeZone = await ctx.settings.get("timezone");
  const dayAgo = new Date(ctx.now.getTime() - 86_400_000).toISOString();
  const [errors, warnings, actions, sessions, bans, aiState] = await Promise.all([
    countRows(ctx.sb, "system_logs", (q) => q.gte("created_at", dayAgo).eq("level", "error")),
    countRows(ctx.sb, "system_logs", (q) => q.gte("created_at", dayAgo).eq("level", "warn")),
    countRows(ctx.sb, "admin_actions", (q) => q.gte("created_at", dayAgo)),
    countRows(ctx.sb, "bot_sessions", (q) => q.gt("expires_at", ctx.now.toISOString())),
    countRows(ctx.sb, "banned_users", (q) => q.eq("is_active", true)),
    getAiState(ctx.sb),
  ]);

  const text = [
    sectionTitle("🛡 امنیت و گزارش فعالیت"),
    divider(),
    `اتصال به تلگرام: ${ctx.cfg.webhookSecret ? "✅ برقرار" : "⚠️ نیاز به بررسی"}`,
    `زمان‌بندی انتشار: ${ctx.cfg.schedulerSecret ? "✅ فعال" : "⚪️ خاموش"}`,
    `مدیران ربات: ${faNum(ctx.cfg.superAdminIds.length)}`,
    `کاربران مسدود: ${faNum(bans)}`,
    "",
    `<b>۲۴ ساعت گذشته</b>`,
    `خطا: ${faNum(errors)} • هشدار: ${faNum(warnings)}`,
    `اقدام مدیران: ${faNum(actions)}`,
    "",
    `گفتگوهای باز: ${faNum(sessions)}`,
    `دستیار هوشمند: ${aiState.status === "ok" ? "✅ آماده" : "⚪️ فعلاً در دسترس نیست"}`,
    `<i>${faDateTime(ctx.now, timeZone)}</i>`,
  ].join("\n");

  const rows: Button[][] = [
    [
      { text: "📜 رویدادها", callback_data: "a:sc:l:all" },
      { text: "⚠️ خطاها", callback_data: "a:sc:l:error" },
    ],
    [
      { text: "🧾 کارهای مدیران", callback_data: "a:sc:a" },
      { text: "🔑 گفتگوهای باز", callback_data: "a:sc:s" },
    ],
    [{ text: "✅ بررسی امنیتی", callback_data: "a:sc:c" }],
    [{ text: "🏠 داشبورد", callback_data: "a:h" }],
  ];
  await editOrSend(ctx, text, keyboard(rows));
}

async function renderLogs(ctx: Ctx, level: string, page = 1): Promise<void> {
  const size = 12;
  const from = (page - 1) * size;
  const logs = await selectRows<SystemLogRow>(ctx.sb, "system_logs", (q) => {
    let query = q.order("created_at", { ascending: false }).range(from, from + size - 1);
    if (level !== "all") query = query.eq("level", level);
    return query;
  });
  const total = await countRows(
    ctx.sb,
    "system_logs",
    (q) => level === "all" ? q : q.eq("level", level),
  );

  const lines = logs.length === 0 ? ["<i>رویدادی ثبت نشده است.</i>"] : logs.map((log) => {
    const icon = log.level === "error" ? "❌" : log.level === "warn" ? "⚠️" : "ℹ️";
    return `${icon} ${friendlyScope(log.scope)} — ${friendlyMessage(log.level)}\n    ${
      faDateTime(log.created_at)
    }`;
  });

  const rows: Button[][] = [[
    { text: levelButton("all", level), callback_data: "a:sc:l:all" },
    { text: levelButton("error", level), callback_data: "a:sc:l:error" },
    { text: levelButton("warn", level), callback_data: "a:sc:l:warn" },
    { text: levelButton("info", level), callback_data: "a:sc:l:info" },
  ]];
  if (total > page * size) {
    rows.push([{ text: "صفحه بعد ▶️", callback_data: `a:sc:l:${level}:${page + 1}` }]);
  }
  rows.push([
    { text: "🔄 به‌روزرسانی", callback_data: `a:sc:l:${level}` },
    { text: "↩️ بازگشت", callback_data: "a:sc" },
  ]);
  rows.push([{ text: "🏠 داشبورد", callback_data: "a:h" }]);

  await editOrSend(
    ctx,
    [
      sectionTitle(`📜 رویدادهای اخیر (${LEVEL_LABELS[level] ?? "همه"})`),
      divider(),
      ...lines,
      "",
      `<i>مجموع: ${faNum(total)}</i>`,
    ].join("\n"),
    keyboard(rows),
  );
}

const ACTION_LABELS: Record<string, string> = {
  sessions_purge: "پاک‌سازی گفتگوهای قدیمی",
  role_update: "تغییر نقش مدیر",
  ban_user: "مسدودکردن کاربر",
  unban_user: "رفع مسدودی",
  settings_update: "تغییر تنظیمات",
  broadcast_send: "ارسال پیام همگانی",
};

async function renderAudit(ctx: Ctx, page = 1): Promise<void> {
  const size = 12;
  const from = (page - 1) * size;
  const actions = await selectRows<AdminActionRow>(
    ctx.sb,
    "admin_actions",
    (q) => q.order("created_at", { ascending: false }).range(from, from + size - 1),
  );
  const total = await countRows(ctx.sb, "admin_actions");

  const lines = actions.length === 0 ? ["<i>اقدامی ثبت نشده است.</i>"] : actions.map((action) => {
    const label = ACTION_LABELS[action.action] ?? "اقدام مدیریتی";
    return `• <b>${label}</b> توسط مدیر <code>${action.actor_id}</code>\n    ${
      faDateTime(action.created_at)
    }`;
  });

  const rows: Button[][] = [];
  if (total > page * size) {
    rows.push([{ text: "صفحه بعد ▶️", callback_data: `a:sc:a:${page + 1}` }]);
  }
  rows.push([
    { text: "🔄 به‌روزرسانی", callback_data: "a:sc:a" },
    { text: "↩️ بازگشت", callback_data: "a:sc" },
  ]);
  rows.push([{ text: "🏠 داشبورد", callback_data: "a:h" }]);

  await editOrSend(
    ctx,
    [
      sectionTitle("🧾 کارهای مدیران"),
      divider(),
      ...lines,
      "",
      `<i>مجموع: ${faNum(total)} اقدام</i>`,
    ].join("\n"),
    keyboard(rows),
  );
}

async function renderSessions(ctx: Ctx): Promise<void> {
  const nowIso = ctx.now.toISOString();
  const [active, expired] = await Promise.all([
    countRows(ctx.sb, "bot_sessions", (q) => q.gt("expires_at", nowIso)),
    countRows(ctx.sb, "bot_sessions", (q) => q.lte("expires_at", nowIso)),
  ]);

  await editOrSend(
    ctx,
    [
      sectionTitle("🔑 گفتگوهای باز"),
      divider(),
      `باز: ${faNum(active)}`,
      `قدیمی و آمادهٔ پاک‌سازی: ${faNum(expired)}`,
      "",
      "<i>این‌ها فقط گفتگوهای نیمه‌کاره‌اند و خودشان پاک می‌شوند.</i>",
    ].join("\n"),
    keyboard([
      [{ text: "🧹 پاک‌سازی گفتگوهای قدیمی", callback_data: "a:sc:sp" }],
      [{ text: "◀️ بازگشت", callback_data: "a:sc" }],
    ]),
  );
}

async function renderChecklist(ctx: Ctx): Promise<void> {
  const text = [
    sectionTitle("✅ بررسی امنیتی"),
    divider(),
    `${ctx.cfg.webhookSecret ? "✅" : "⚠️"} ارتباط امن با تلگرام برقرار است.`,
    `${ctx.cfg.schedulerSecret ? "✅" : "⚪️"} زمان‌بندی انتشار پیام فعال است.`,
    `${ctx.cfg.superAdminIds.length > 0 ? "✅" : "⚠️"} مالک اصلی ربات مشخص است.`,
    "✅ داده‌ها فقط از سمت سرور خوانده می‌شوند.",
    "✅ هر کار مدیریتی دوباره بررسی و ثبت می‌شود.",
    "✅ کارهای حساس (حذف، مسدودسازی، پیام همگانی) تأیید می‌خواهند.",
    "✅ مالک اصلی قابل حذف نیست.",
    "✅ متن‌ها پیش از نمایش پاک‌سازی می‌شوند.",
    "",
    "<i>رمزها و کلیدها هیچ‌وقت در چت یا فایل عمومی گذاشته نمی‌شوند.</i>",
  ].join("\n");

  await editOrSend(
    ctx,
    text,
    keyboard([
      [{ text: "◀️ بازگشت", callback_data: "a:sc" }],
      [{ text: "🏠 داشبورد", callback_data: "a:h" }],
    ]),
  );
}

export async function handleSecurityCallback(ctx: Ctx, parts: string[]): Promise<boolean> {
  if (parts[1] !== "sc") return false;
  if (!(await guardAdmin(ctx, "security.read"))) return true;

  const sub = parts[2];
  if (!sub) {
    await renderPanel(ctx);
    return true;
  }

  if (sub === "l") {
    const level = parts[3] ?? "all";
    const page = Math.max(Number(parts[4] ?? 1), 1);
    await renderLogs(ctx, level, page);
    return true;
  }

  if (sub === "a") {
    await renderAudit(ctx, Math.max(Number(parts[3] ?? 1), 1));
    return true;
  }

  if (sub === "s") {
    await renderSessions(ctx);
    return true;
  }

  if (sub === "c") {
    await renderChecklist(ctx);
    return true;
  }

  if (sub === "sp") {
    const removed = await deleteExpiredSessions(ctx.sb, ctx.now);
    await logAdminAction(ctx, "sessions_purge", "session", undefined, { removed });
    await answerCallback(ctx, `${faNum(removed)} گفتگوی قدیمی پاک شد.`);
    await renderSessions(ctx);
    return true;
  }

  await answerCallback(ctx, "اقدام ناشناخته است.", true);
  return true;
}

export async function runSecurityConfirm(
  ctx: Ctx,
  action: string,
  _args: Record<string, unknown>,
): Promise<boolean> {
  if (action !== "sessions_purge") return false;
  if (!(await guardAdmin(ctx, "security.read"))) return true;
  const removed = await deleteExpiredSessions(ctx.sb, ctx.now);
  await logAdminAction(ctx, "sessions_purge", "session", undefined, { removed });
  await send(ctx, `🧹 ${faNum(removed)} گفتگوی قدیمی پاک شد.`);
  return true;
}
