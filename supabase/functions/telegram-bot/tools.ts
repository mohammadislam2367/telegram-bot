/** 🧰 ابزارهای سیستم — بررسی سلامت، webhook، اجرای scheduler و نگه‌داری. */
import { callRpc, countRows, pingDatabase } from "../_shared/db.ts";
import { runScheduler } from "../_shared/scheduler_core.ts";
import { testAiConnection } from "../_shared/ai_core.ts";
import { type Button, keyboard } from "../_shared/keyboards.ts";
import { divider, faDateTime, faNum, sectionTitle } from "../_shared/texts.ts";
import { describeConfig } from "../_shared/config.ts";
import { escapeHtml, truncate } from "../_shared/validation.ts";
import {
  answerCallback,
  askConfirm,
  type Ctx,
  editOrSend,
  guardAdmin,
  logAdminAction,
  send,
} from "./context.ts";

const BOT_COMMANDS = [
  { command: "start", description: "شروع و منوی اصلی" },
  { command: "ai", description: "پرسش از هوش مصنوعی" },
  { command: "anime", description: "جستجوی انیمه" },
  { command: "news", description: "آخرین اخبار" },
  { command: "profile", description: "پروفایل من" },
  { command: "privacy", description: "حریم خصوصی" },
  { command: "stop", description: "توقف پیام‌های همگانی" },
  { command: "help", description: "راهنما" },
  { command: "admin", description: "داشبورد مدیریت" },
];

async function renderPanel(ctx: Ctx): Promise<void> {
  const [dbOk, version, timeZone] = await Promise.all([
    pingDatabase(ctx.sb).catch(() => false),
    ctx.settings.get("bot_version"),
    ctx.settings.get("timezone"),
  ]);

  const text = [
    sectionTitle("🧰 ابزارهای سیستم"),
    divider(),
    `نسخه: ${version} • محیط: ${ctx.cfg.environment}`,
    `دیتابیس: ${dbOk ? "✅ سالم" : "❌ خطا"}`,
    `ربات: @${ctx.cfg.botUsername}`,
    `زمان: ${faDateTime(ctx.now, timeZone)}`,
    `AI: ${ctx.cfg.geminiApiKey ? "کلید تنظیم شده" : "بدون کلید (Smart Fallback)"}`,
    "",
    "<i>ابزارهای تشخیصی فقط برای مدیران مجاز و با ثبت در Audit.</i>",
  ].join("\n");

  const rows: Button[][] = [
    [
      { text: "🤖 اطلاعات ربات", callback_data: "a:tl:me" },
      { text: "🔗 Webhook", callback_data: "a:tl:wh" },
    ],
    [
      { text: "📋 ثبت دستورات", callback_data: "a:tl:cmd" },
      { text: "⚙️ اجرای scheduler", callback_data: "a:tl:run" },
    ],
    [
      { text: "🧪 تست AI", callback_data: "a:tl:ai" },
      { text: "🗄 شمارش دیتابیس", callback_data: "a:tl:db" },
    ],
    [
      { text: "🧹 پاک‌سازی داده", callback_data: "a:tl:pr" },
      { text: "🔑 Sessionها", callback_data: "a:tl:ses" },
    ],
    [{ text: "ℹ️ تنظیمات محیط", callback_data: "a:tl:v" }],
    [{ text: "🏠 داشبورد", callback_data: "a:h" }],
  ];
  await editOrSend(ctx, text, keyboard(rows));
}

function backRow(callback = "a:tl"): Button[] {
  return [
    { text: "🔄 به‌روزرسانی", callback_data: callback },
    { text: "🏠 داشبورد", callback_data: "a:h" },
  ];
}

export async function handleToolsCallback(ctx: Ctx, parts: string[]): Promise<boolean> {
  if (parts[1] !== "tl") return false;
  if (!(await guardAdmin(ctx, "tools.use"))) return true;

  const sub = parts[2];
  if (!sub) {
    await renderPanel(ctx);
    return true;
  }

  if (sub === "me") {
    try {
      const me = await ctx.tg.getMe();
      await editOrSend(
        ctx,
        [
          sectionTitle("🤖 اطلاعات ربات"),
          divider(),
          `نام: ${escapeHtml(me.first_name)}`,
          `یوزرنیم: @${escapeHtml(me.username ?? "—")}`,
          `شناسه: <code>${me.id}</code>`,
          `ربات: ${me.is_bot ? "بله" : "خیر"}`,
        ].join("\n"),
        keyboard([backRow("a:tl:me")]),
      );
    } catch (error) {
      await answerCallback(ctx, `خطا: ${(error as Error).message}`, true);
    }
    return true;
  }

  if (sub === "wh") {
    try {
      const info = await ctx.tg.getWebhookInfo();
      const url = String(info.url ?? "");
      const pending = Number(info.pending_update_count ?? 0);
      const lastError = info.last_error_message ? String(info.last_error_message) : "";
      await editOrSend(
        ctx,
        [
          sectionTitle("🔗 وضعیت Webhook"),
          divider(),
          `URL: <code>${escapeHtml(url || "تنظیم نشده")}</code>`,
          `Secret Token: ${ctx.cfg.webhookSecret ? "✅" : "❌"}`,
          `آپدیت‌های در انتظار: ${faNum(pending)}`,
          lastError ? `⚠️ آخرین خطا: ${escapeHtml(truncate(lastError, 200))}` : "",
        ].filter(Boolean).join("\n"),
        keyboard([backRow("a:tl:wh")]),
      );
    } catch (error) {
      await answerCallback(ctx, `خطا: ${(error as Error).message}`, true);
    }
    return true;
  }

  if (sub === "cmd") {
    try {
      await ctx.tg.setMyCommands(BOT_COMMANDS);
      await logAdminAction(ctx, "set_commands", "bot");
      await answerCallback(ctx, "دستورات ثبت شد.");
      await editOrSend(
        ctx,
        [
          sectionTitle("📋 دستورات ثبت‌شده"),
          divider(),
          ...BOT_COMMANDS.map((command) => `/${command.command} — ${command.description}`),
        ].join("\n"),
        keyboard([backRow("a:tl:cmd")]),
      );
    } catch (error) {
      await answerCallback(ctx, `خطا: ${(error as Error).message}`, true);
    }
    return true;
  }

  if (sub === "run") {
    try {
      const summary = await runScheduler({
        sb: ctx.sb,
        tg: ctx.tg,
        settings: ctx.settings,
        cfg: ctx.cfg,
        logger: ctx.log,
      });
      await logAdminAction(ctx, "scheduler_run", "system");
      const text = [
        sectionTitle("⚙️ نتیجه اجرای دستی scheduler"),
        divider(),
        `📢 تبلیغ: ${faNum(summary.ads.sent)} ارسال • ${faNum(summary.ads.failed)} خطا • ${
          faNum(summary.ads.postponed)
        } تعویق`,
        `📅 پست زمان‌بندی: ${faNum(summary.scheduledPosts.sent)} ارسال • ${
          faNum(summary.scheduledPosts.repeated)
        } تکرار`,
        `📝 محتوا: ${faNum(summary.content.published)} منتشر • ${
          faNum(summary.content.failed)
        } خطا`,
        `📨 همگانی: ${faNum(summary.broadcast.sent)} ارسال • باقی ${
          faNum(summary.broadcast.remaining)
        }`,
        `🤖 AI: ${
          summary.aiHealth.checked ? (summary.aiHealth.ok ? "سالم" : "خطا") : "بررسی لازم نبود"
        }`,
        `📊 تجمیع آمار: ${summary.stats.aggregated ? "انجام شد" : "قبلاً انجام شده"}`,
        `🧹 session حذف‌شده: ${faNum(summary.cleanup.sessions)}`,
        "",
        `<i>شروع: ${summary.startedAt} — پایان: ${summary.finishedAt}</i>`,
      ].join("\n");
      await editOrSend(ctx, text, keyboard([backRow("a:tl:run")]));
    } catch (error) {
      await answerCallback(ctx, "اجرای scheduler ناموفق بود.", true);
      await ctx.log.error("manual scheduler failed", { error: (error as Error).message });
    }
    return true;
  }

  if (sub === "ai") {
    const result = await testAiConnection({
      sb: ctx.sb,
      settings: ctx.settings,
      cfg: ctx.cfg,
    });
    await logAdminAction(ctx, "ai_test", "ai", undefined, { ok: result.ok });
    await editOrSend(
      ctx,
      [
        sectionTitle("🧪 تست اتصال AI"),
        divider(),
        result.ok ? "✅ اتصال موفق" : "❌ اتصال ناموفق",
        result.message,
        `زمان پاسخ: ${faNum(result.latencyMs)}ms`,
      ].join("\n"),
      keyboard([backRow("a:tl:ai")]),
    );
    return true;
  }

  if (sub === "db") {
    const tables = [
      "users",
      "admins",
      "banned_users",
      "groups",
      "advertisements",
      "scheduled_posts",
      "content_posts",
      "broadcast_campaigns",
      "broadcast_logs",
      "ai_conversations",
      "ai_usage",
      "system_logs",
      "admin_actions",
      "bot_sessions",
    ];
    const counts = await Promise.all(tables.map((table) => countRows(ctx.sb, table)));
    await editOrSend(
      ctx,
      [
        sectionTitle("🗄 شمارش جداول"),
        divider(),
        ...tables.map((table, index) => `• <code>${table}</code>: ${faNum(counts[index])}`),
      ].join("\n"),
      keyboard([backRow("a:tl:db")]),
    );
    return true;
  }

  if (sub === "pr") {
    const days = await ctx.settings.get("data_retention_days");
    await askConfirm(
      ctx,
      `🧹 <b>پاک‌سازی داده‌های قدیمی</b>\nلاگ‌ها، مصرف AI، گفت‌وگوها، صف‌های قدیمی و sessionهای منقضی قدیمی‌تر از ${
        faNum(days)
      } روز حذف می‌شوند.`,
      "prune_data",
      { days },
      "a:tl",
    );
    return true;
  }

  if (sub === "ses") {
    const active = await countRows(
      ctx.sb,
      "bot_sessions",
      (q) => q.lte("expires_at", ctx.now.toISOString()),
    );
    await askConfirm(
      ctx,
      `🔑 پاک‌سازی ${faNum(active)} session منقضی؟`,
      "sessions_purge",
      {},
      "a:tl",
    );
    return true;
  }

  if (sub === "v") {
    const description = describeConfig(ctx.cfg);
    await editOrSend(
      ctx,
      [
        sectionTitle("ℹ️ تنظیمات محیط (بدون مقادیر محرمانه)"),
        divider(),
        ...Object.entries(description).map(([key, value]) =>
          `• <code>${key}</code>: ${escapeHtml(String(value))}`
        ),
      ].join("\n"),
      keyboard([backRow("a:tl:v")]),
    );
    return true;
  }

  await answerCallback(ctx, "ابزار ناشناخته است.", true);
  return true;
}

export async function runToolsConfirm(
  ctx: Ctx,
  action: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  if (action !== "prune_data") return false;
  if (!(await guardAdmin(ctx, "tools.use"))) return true;

  const days = Number(args.days ?? 90);
  try {
    const result = await callRpc<Record<string, number>>(ctx.sb, "prune_old_data", {
      p_days: days,
    });
    await logAdminAction(ctx, "prune_data", "system", undefined, result);
    const lines = Object.entries(result).map(([key, value]) => `• ${key}: ${faNum(Number(value))}`);
    await send(ctx, `🧹 پاک‌سازی انجام شد.\n${lines.join("\n")}`);
  } catch (error) {
    await send(ctx, `⚠️ پاک‌سازی ناموفق بود: ${escapeHtml((error as Error).message)}`);
  }
  return true;
}
