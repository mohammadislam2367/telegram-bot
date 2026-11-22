/** 🛡 امنیت و گزارش فعالیت — لاگ‌ها، Audit مدیران، sessionها و چک‌لیست. */
import { countRows, selectRows } from "../_shared/db.ts";
import { deleteExpiredSessions } from "../_shared/sessions.ts";
import { type Button, keyboard } from "../_shared/keyboards.ts";
import { divider, faDateTime, faNum, sectionTitle } from "../_shared/texts.ts";
import { escapeHtml, truncate } from "../_shared/validation.ts";
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

function levelButton(level: string, current: string): string {
  return level === current ? `• ${level} •` : level;
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
    `Webhook Secret: ${ctx.cfg.webhookSecret ? "✅ تنظیم شده" : "❌ تنظیم نشده"}`,
    `Scheduler Secret: ${ctx.cfg.schedulerSecret ? "✅ تنظیم شده" : "❌ تنظیم نشده"}`,
    `مدیران مجاز (env): ${faNum(ctx.cfg.superAdminIds.length)}`,
    `مسدودان ربات: ${faNum(bans)}`,
    "",
    `<b>۲۴ ساعت گذشته</b>`,
    `خطا: ${faNum(errors)} • هشدار: ${faNum(warnings)}`,
    `اقدام مدیران: ${faNum(actions)}`,
    "",
    `Sessionهای فعال: ${faNum(sessions)}`,
    `وضعیت AI: ${aiState.status}${
      aiState.last_error ? ` — ${escapeHtml(truncate(aiState.last_error, 80))}` : ""
    }`,
    `<i>${faDateTime(ctx.now, timeZone)}</i>`,
  ].join("\n");

  const rows: Button[][] = [
    [
      { text: "📜 لاگ سیستم", callback_data: "a:sc:l:all" },
      { text: "⚠️ خطاها", callback_data: "a:sc:l:error" },
    ],
    [
      { text: "🧾 Audit مدیران", callback_data: "a:sc:a" },
      { text: "🔑 Sessionها", callback_data: "a:sc:s" },
    ],
    [{ text: "✅ چک‌لیست امنیتی", callback_data: "a:sc:c" }],
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

  const lines = logs.length === 0 ? ["<i>لاگی ثبت نشده است.</i>"] : logs.map((log) => {
    const icon = log.level === "error" ? "❌" : log.level === "warn" ? "⚠️" : "ℹ️";
    return `${icon} <code>${escapeHtml(log.scope)}</code> — ${
      escapeHtml(truncate(log.message, 120))
    }\n    ${faDateTime(log.created_at)}`;
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
    { text: "🛡 امنیت", callback_data: "a:sc" },
  ]);
  rows.push([{ text: "🏠 داشبورد", callback_data: "a:h" }]);

  await editOrSend(
    ctx,
    [
      sectionTitle(`📜 لاگ سیستم (${level})`),
      divider(),
      ...lines,
      "",
      `<i>مجموع: ${faNum(total)}</i>`,
    ].join("\n"),
    keyboard(rows),
  );
}

async function renderAudit(ctx: Ctx, page = 1): Promise<void> {
  const size = 12;
  const from = (page - 1) * size;
  const actions = await selectRows<AdminActionRow>(
    ctx.sb,
    "admin_actions",
    (q) => q.order("created_at", { ascending: false }).range(from, from + size - 1),
  );
  const total = await countRows(ctx.sb, "admin_actions");

  const lines = actions.length === 0
    ? ["<i>اقدامی ثبت نشده است.</i>"]
    : actions.map((action) =>
      `• <b>${escapeHtml(action.action)}</b> توسط <code>${action.actor_id}</code>\n    ${
        action.target_type ?? "—"
      }: ${escapeHtml(action.target_id ?? "—")} • ${faDateTime(action.created_at)}`
    );

  const rows: Button[][] = [];
  if (total > page * size) {
    rows.push([{ text: "صفحه بعد ▶️", callback_data: `a:sc:a:${page + 1}` }]);
  }
  rows.push([
    { text: "🔄 به‌روزرسانی", callback_data: "a:sc:a" },
    { text: "🛡 امنیت", callback_data: "a:sc" },
  ]);
  rows.push([{ text: "🏠 داشبورد", callback_data: "a:h" }]);

  await editOrSend(
    ctx,
    [
      sectionTitle("🧾 Audit اقدامات مدیران"),
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
      sectionTitle("🔑 Sessionهای گفت‌وگو"),
      divider(),
      `فعال: ${faNum(active)}`,
      `منقضی‌شده (نیازمند پاک‌سازی): ${faNum(expired)}`,
      "",
      "<i>Sessionها فقط state گفت‌وگوهای چندمرحله‌ای را نگه می‌دارند و پس از انقضا خودکار حذف می‌شوند.</i>",
    ].join("\n"),
    keyboard([
      [{ text: "🧹 پاک‌سازی sessionهای منقضی", callback_data: "a:sc:sp" }],
      [{ text: "◀️ بازگشت", callback_data: "a:sc" }],
    ]),
  );
}

async function renderChecklist(ctx: Ctx): Promise<void> {
  const text = [
    sectionTitle("✅ چک‌لیست امنیتی"),
    divider(),
    `${
      ctx.cfg.webhookSecret ? "✅" : "❌"
    } <b>TELEGRAM_WEBHOOK_SECRET</b> تنظیم شده و در setWebhook استفاده می‌شود.`,
    `${
      ctx.cfg.schedulerSecret ? "✅" : "❌"
    } <b>SCHEDULER_SECRET</b> تنظیم شده و تابع scheduler فقط با آن اجرا می‌شود.`,
    `${
      ctx.cfg.superAdminIds.length > 0 ? "✅" : "❌"
    } <b>SUPER_ADMIN_IDS</b> فقط شامل مالک اصلی است.`,
    "✅ سرویس‌رول فقط در Edge Functions استفاده می‌شود؛ RLS روی همه جداول فعال است.",
    "✅ هر callback مدیریتی مجوز را دوباره بررسی و در admin_actions ثبت می‌کند.",
    "✅ عملیات حساس (حذف، مسدودسازی، ارسال همگانی) با توکن تأیید انجام می‌شود.",
    "✅ مالک اصلی از طریق کد/داشبورد قابل حذف نیست.",
    "✅ ورودی‌ها اعتبارسنجی و HTML آن‌ها escape می‌شود.",
    "",
    "<i>کلید API و Bot Token را هرگز در چت، کد یا فایل عمومی قرار ندهید؛ فقط Supabase Secrets.</i>",
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
    await answerCallback(ctx, `${faNum(removed)} session منقضی پاک شد.`);
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
  await send(ctx, `🧹 ${faNum(removed)} session منقضی پاک شد.`);
  return true;
}
