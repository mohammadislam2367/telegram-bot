/** 📊 آمار و گزارش‌ها — نمودار متنی + گزارش روزانه/هفتگی. */
import { countRows, selectRows } from "../_shared/db.ts";
import {
  aggregateDay,
  aiUsageSummary,
  collectOverview,
  groupActivity,
  renderOverview,
  shiftDay,
  weeklyReport,
} from "../_shared/stats_core.ts";
import { todayInZone } from "../_shared/validation.ts";
import { divider, faNum, sectionTitle } from "../_shared/texts.ts";
import { keyboard } from "../_shared/keyboards.ts";
import { answerCallback, type Ctx, editOrSend, guardAdmin } from "./context.ts";

const BACK = keyboard([
  [{ text: "🔄 به‌روزرسانی", callback_data: "a:st" }],
  [{ text: "📈 گزارش هفتگی", callback_data: "a:st:w" }],
  [{ text: "🏠 داشبورد", callback_data: "a:h" }],
]);

function navKeyboard(current: "overview" | "daily" | "weekly" | "groups" | "ai") {
  const rows = [
    [
      { text: current === "overview" ? "• آمار کلی •" : "📊 کلی", callback_data: "a:st" },
      { text: current === "daily" ? "• گزارش روز •" : "📅 امروز", callback_data: "a:st:d" },
    ],
    [
      { text: current === "weekly" ? "• هفتگی •" : "📈 هفتگی", callback_data: "a:st:w" },
      { text: current === "groups" ? "• گروه‌ها •" : "👮 گروه‌ها", callback_data: "a:st:g" },
    ],
    [
      { text: current === "ai" ? "• مصرف AI •" : "🤖 مصرف AI", callback_data: "a:st:ai" },
    ],
    [{ text: "🏠 داشبورد", callback_data: "a:h" }],
  ];
  return keyboard(rows);
}

export async function handleStatsCallback(ctx: Ctx, parts: string[]): Promise<boolean> {
  if (parts[1] !== "st") return false;

  const sub = parts[2];
  const timeZone = await ctx.settings.get("timezone");

  if (!sub) {
    const overview = await collectOverview(ctx.sb, timeZone, ctx.now);
    await editOrSend(ctx, renderOverview(overview), navKeyboard("overview"));
    return true;
  }

  if (sub === "d") {
    if (!(await guardAdmin(ctx, "stats.read"))) return true;
    const today = todayInZone(timeZone, ctx.now);
    const row = await aggregateDay(ctx.sb, today, timeZone);
    const yesterday = await aggregateDay(ctx.sb, shiftDay(today, -1), timeZone);
    const text = [
      `<b>📅 گزارش ${row.day}</b>`,
      divider(),
      `👥 کاربر جدید: ${faNum(row.new_users)}`,
      `🟢 کاربران فعال: ${faNum(row.active_users)}`,
      `📨 پیام: ${faNum(row.messages)}`,
      `🤖 درخواست AI: ${faNum(row.ai_requests)} (جایگزین: ${faNum(row.ai_fallbacks)})`,
      `📢 تبلیغ ارسال‌شده: ${faNum(row.ads_sent)}`,
      `📝 پست ارسال‌شده: ${faNum(row.posts_sent)}`,
      `⚠️ خطا: ${faNum(row.errors)}`,
      divider(),
      `<b>دیروز (${yesterday.day})</b>`,
      `پیام ${faNum(yesterday.messages)} • کاربر جدید ${faNum(yesterday.new_users)} • AI ${
        faNum(yesterday.ai_requests)
      }`,
    ].join("\n");
    await editOrSend(ctx, text, navKeyboard("daily"));
    return true;
  }

  if (sub === "w") {
    if (!(await guardAdmin(ctx, "stats.read"))) return true;
    const text = await weeklyReport(ctx.sb, timeZone, ctx.now);
    await editOrSend(ctx, text, navKeyboard("weekly"));
    return true;
  }

  if (sub === "g") {
    if (!(await guardAdmin(ctx, "stats.read"))) return true;
    const [activity, groups, warnings, actions24] = await Promise.all([
      groupActivity(ctx.sb, 7),
      countRows(ctx.sb, "groups", (q) => q.eq("is_active", true)),
      countRows(ctx.sb, "user_warnings", (q) => q.eq("is_active", true)),
      countRows(
        ctx.sb,
        "moderation_logs",
        (q) => q.gte("created_at", new Date(ctx.now.getTime() - 86_400_000).toISOString()),
      ),
    ]);
    const lines = activity.length === 0
      ? ["<i>گروهی ثبت نشده است.</i>"]
      : activity.map((group, index) =>
        `${faNum(index + 1)}. <b>${group.title}</b> — ${faNum(group.actions)} اقدام (۷ روز)`
      );
    const text = [
      sectionTitle("👮 آمار فعالیت گروه‌ها"),
      divider(),
      `گروه‌های فعال: ${faNum(groups)}`,
      `اخطارهای فعال: ${faNum(warnings)}`,
      `اقدامات ۲۴ ساعت: ${faNum(actions24)}`,
      "",
      ...lines,
    ].join("\n");
    await editOrSend(ctx, text, navKeyboard("groups"));
    return true;
  }

  if (sub === "ai") {
    if (!(await guardAdmin(ctx, "ai.read"))) return true;
    const [summary, recent, state] = await Promise.all([
      aiUsageSummary(ctx.sb, timeZone),
      selectRows<{ status: string; latency_ms: number; created_at: string }>(
        ctx.sb,
        "ai_usage",
        (q) => q.order("created_at", { ascending: false }).limit(10),
      ),
      ctx.settings.get("ai_model"),
    ]);
    const lines = recent.length === 0
      ? ["<i>مصرفی ثبت نشده است.</i>"]
      : recent.map((row) => `• ${row.status} — ${faNum(row.latency_ms)}ms`);
    const text = [
      sectionTitle("🤖 مصرف هوش مصنوعی (امروز)"),
      divider(),
      `درخواست‌ها: ${faNum(summary.today)}`,
      `پاسخ جایگزین: ${faNum(summary.fallbacks)}`,
      `سهمیه/محدودیت: ${faNum(summary.quota)}`,
      `خطا: ${faNum(summary.errors)}`,
      `میانگین تأخیر موفق: ${faNum(summary.avgLatency)}ms`,
      `مدل: <code>${state}</code>`,
      "",
      "<b>۱۰ درخواست آخر</b>",
      ...lines,
    ].join("\n");
    await editOrSend(ctx, text, navKeyboard("ai"));
    return true;
  }

  await answerCallback(ctx, "بخش آماری ناشناخته است.", true);
  return true;
}

export { BACK };
