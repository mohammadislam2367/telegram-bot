/**
 * آمار و گزارش‌ها — محاسبه از جداول واقعی + تجمیع روزانه + گزارش هفتگی متنی.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { countRows, selectRows, upsertRow } from "./db.ts";
import { startOfDayIso } from "./rate_limit.ts";
import { daysAgoIso, todayInZone, zonedTimeToUtc } from "./validation.ts";
import { barChart, divider, faNum, faPercent, statusLabel } from "./texts.ts";
import type { StatsRow } from "./types.ts";

export interface OverviewStats {
  totalUsers: number;
  newUsersToday: number;
  active7d: number;
  activeToday: number;
  blockedUsers: number;
  groups: number;
  admins: number;
  messagesToday: number;
  messagesYesterday: number;
  aiRequestsToday: number;
  aiFallbacksToday: number;
  aiQuotaToday: number;
  aiErrorsToday: number;
  errorsToday: number;
  adsSent: number;
  adsActive: number;
  postsPublished: number;
  campaignsActive: number;
  pendingBroadcastRows: number;
  scheduledPending: number;
  warningsActive: number;
  moderation24h: number;
  generatedAt: string;
}

export function dayBounds(dayIso: string, timeZone: string): { start: string; end: string } {
  const [year, month, day] = dayIso.split("-").map(Number);
  const start = zonedTimeToUtc(year, month, day, 0, 0, timeZone);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const end = zonedTimeToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    0,
    0,
    timeZone,
  );
  return { start: start.toISOString(), end: end.toISOString() };
}

export function shiftDay(dayIso: string, deltaDays: number): string {
  const [year, month, day] = dayIso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return date.toISOString().slice(0, 10);
}

export async function collectOverview(
  sb: SupabaseClient,
  timeZone: string,
  now = new Date(),
): Promise<OverviewStats> {
  const today = todayInZone(timeZone, now);
  const { start: todayStart } = dayBounds(today, timeZone);
  const yesterday = shiftDay(today, -1);
  const sevenDaysAgo = daysAgoIso(7, now);
  const dayAgo = daysAgoIso(1, now);

  const [
    totalUsers,
    newUsersToday,
    active7d,
    activeToday,
    blockedUsers,
    groups,
    admins,
    messagesTodayRow,
    messagesYesterdayRow,
    aiToday,
    aiFallbacks,
    aiQuota,
    aiErrors,
    errorsToday,
    moderation24h,
    warningsActive,
    pendingBroadcastRows,
    scheduledPending,
    postsPublished,
    campaignsRunning,
    campaignsQueued,
    adsActive,
  ] = await Promise.all([
    countRows(sb, "users"),
    countRows(sb, "users", (q) => q.gte("created_at", todayStart)),
    countRows(sb, "users", (q) => q.gte("last_seen_at", sevenDaysAgo)),
    countRows(sb, "user_daily_activity", (q) => q.eq("day", today)),
    countRows(sb, "banned_users", (q) => q.eq("is_active", true)),
    countRows(sb, "groups", (q) => q.eq("is_active", true)),
    countRows(sb, "admins", (q) => q.eq("is_active", true)),
    countRows(sb, "bot_stats_daily", (q) => q.eq("day", today)),
    countRows(sb, "bot_stats_daily", (q) => q.eq("day", yesterday)),
    countRows(
      sb,
      "ai_usage",
      (q) => q.gte("created_at", todayStart).in("status", ["success", "fallback"]),
    ),
    countRows(sb, "ai_usage", (q) => q.gte("created_at", todayStart).eq("status", "fallback")),
    countRows(
      sb,
      "ai_usage",
      (q) => q.gte("created_at", todayStart).in("status", ["quota", "rate_limited"]),
    ),
    countRows(sb, "ai_usage", (q) => q.gte("created_at", todayStart).eq("status", "error")),
    countRows(sb, "system_logs", (q) => q.gte("created_at", todayStart).eq("level", "error")),
    countRows(sb, "moderation_logs", (q) => q.gte("created_at", dayAgo)),
    countRows(sb, "user_warnings", (q) => q.eq("is_active", true)),
    countRows(sb, "broadcast_logs", (q) => q.eq("status", "pending")),
    countRows(sb, "scheduled_posts", (q) => q.eq("status", "pending")),
    countRows(sb, "content_posts", (q) => q.eq("status", "published")),
    countRows(sb, "broadcast_campaigns", (q) => q.eq("status", "running")),
    countRows(sb, "broadcast_campaigns", (q) => q.eq("status", "queued")),
    countRows(sb, "advertisements", (q) => q.eq("status", "active")),
  ]);

  const statsRows = await selectRows<Pick<StatsRow, "day" | "messages">>(
    sb,
    "bot_stats_daily",
    (q) => q.in("day", [today, yesterday]),
  );
  const messagesToday = statsRows.find((row) => row.day === today)?.messages ?? messagesTodayRow;
  const messagesYesterday = statsRows.find((row) => row.day === yesterday)?.messages ??
    messagesYesterdayRow;

  const adsSentRows = await selectRows<{ sent_count: number }>(sb, "advertisements");
  const adsSent = adsSentRows.reduce((sum, row) => sum + (row.sent_count ?? 0), 0);

  return {
    totalUsers,
    newUsersToday,
    active7d,
    activeToday,
    blockedUsers,
    groups,
    admins,
    messagesToday,
    messagesYesterday,
    aiRequestsToday: aiToday,
    aiFallbacksToday: aiFallbacks,
    aiQuotaToday: aiQuota,
    aiErrorsToday: aiErrors,
    errorsToday,
    adsSent,
    adsActive,
    postsPublished,
    campaignsActive: campaignsRunning + campaignsQueued,
    pendingBroadcastRows,
    scheduledPending,
    warningsActive,
    moderation24h,
    generatedAt: new Date().toISOString(),
  };
}

export function renderOverview(stats: OverviewStats): string {
  const trend = stats.messagesToday - stats.messagesYesterday;
  const trendText = stats.messagesYesterday === 0
    ? "—"
    : `${trend >= 0 ? "▲" : "▼"} ${faPercent(Math.abs(trend), stats.messagesYesterday)}`;

  return [
    "<b>📊 آمار کلی</b>",
    divider(),
    "<b>👥 کاربران</b>",
    `کل: ${faNum(stats.totalUsers)}  •  امروز: ${faNum(stats.newUsersToday)}`,
    `فعال امروز: ${faNum(stats.activeToday)}  •  فعال ۷ روز: ${faNum(stats.active7d)}`,
    `مسدود (ربات): ${faNum(stats.blockedUsers)}`,
    "",
    "<b>📨 فعالیت امروز</b>",
    `پیام‌ها: ${faNum(stats.messagesToday)}  (${trendText})`,
    `${barChart(stats.messagesToday, Math.max(stats.messagesToday, stats.messagesYesterday, 1))}`,
    `درخواست AI: ${faNum(stats.aiRequestsToday)}  •  پاسخ جایگزین: ${
      faNum(stats.aiFallbacksToday)
    }`,
    `خطای AI: ${faNum(stats.aiErrorsToday)}  •  سهمیه: ${faNum(stats.aiQuotaToday)}`,
    `خطاهای سیستم: ${faNum(stats.errorsToday)}`,
    "",
    "<b>📢 محتوا</b>",
    `تبلیغات فعال: ${faNum(stats.adsActive)} (مجموع ارسال: ${faNum(stats.adsSent)})`,
    `پست منتشرشده: ${faNum(stats.postsPublished)}`,
    `کمپین همگانی فعال: ${faNum(stats.campaignsActive)}  •  صف: ${
      faNum(stats.pendingBroadcastRows)
    }`,
    `زمان‌بندی در انتظار: ${faNum(stats.scheduledPending)}`,
    "",
    "<b>👮 گروه‌ها</b>",
    `گروه‌های فعال: ${faNum(stats.groups)}  •  اخطار فعال: ${faNum(stats.warningsActive)}`,
    `اقدامات ۲۴ ساعت: ${faNum(stats.moderation24h)}`,
    `مدیران فعال: ${faNum(stats.admins)}`,
  ].join("\n");
}

export async function collectSeries(
  sb: SupabaseClient,
  days: number,
  timeZone: string,
  now = new Date(),
): Promise<StatsRow[]> {
  const today = todayInZone(timeZone, now);
  const from = shiftDay(today, -(days - 1));
  const rows = await selectRows<StatsRow>(
    sb,
    "bot_stats_daily",
    (q) => q.gte("day", from).order("day", { ascending: true }),
  );
  const map = new Map(rows.map((row) => [row.day, row]));
  const result: StatsRow[] = [];
  for (let i = 0; i < days; i++) {
    const day = shiftDay(from, i);
    const existing = map.get(day);
    result.push(
      existing ?? {
        day,
        new_users: 0,
        active_users: 0,
        messages: 0,
        ai_requests: 0,
        ai_fallbacks: 0,
        ads_sent: 0,
        posts_sent: 0,
        errors: 0,
        blocked_users: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    );
  }
  return result;
}

export function renderSeries(rows: StatsRow[]): string {
  if (rows.length === 0) return "<i>داده‌ای برای نمایش نیست.</i>";
  const maxMessages = Math.max(...rows.map((row) => row.messages), 1);
  const lines = rows.map((row) => {
    const dayLabel = row.day.slice(5).replace("-", "/");
    return `${dayLabel}  ${barChart(row.messages, maxMessages, 8)}  ${faNum(row.messages)} پیام`;
  });
  const totalNew = rows.reduce((sum, row) => sum + row.new_users, 0);
  const totalMessages = rows.reduce((sum, row) => sum + row.messages, 0);
  const totalAi = rows.reduce((sum, row) => sum + row.ai_requests, 0);
  const totalFallback = rows.reduce((sum, row) => sum + row.ai_fallbacks, 0);
  const totalErrors = rows.reduce((sum, row) => sum + row.errors, 0);

  return [
    ...lines,
    divider(),
    `👥 کاربر جدید: ${faNum(totalNew)}`,
    `📨 پیام: ${faNum(totalMessages)}`,
    `🤖 درخواست AI: ${faNum(totalAi)} (جایگزین: ${faNum(totalFallback)})`,
    `⚠️ خطا: ${faNum(totalErrors)}`,
  ].join("\n");
}

/** تجمیع یک روز مشخص در bot_stats_daily (messages حفظ می‌شود). */
export async function aggregateDay(
  sb: SupabaseClient,
  dayIso: string,
  timeZone: string,
): Promise<StatsRow> {
  const { start, end } = dayBounds(dayIso, timeZone);

  const [newUsers, activeUsers, aiRequests, aiFallbacks, errors, ads, posts, blocked] =
    await Promise.all([
      countRows(sb, "users", (q) => q.gte("created_at", start).lt("created_at", end)),
      countRows(sb, "user_daily_activity", (q) => q.eq("day", dayIso)),
      countRows(
        sb,
        "ai_usage",
        (q) =>
          q.gte("created_at", start).lt("created_at", end).in("status", ["success", "fallback"]),
      ),
      countRows(
        sb,
        "ai_usage",
        (q) => q.gte("created_at", start).lt("created_at", end).eq("status", "fallback"),
      ),
      countRows(
        sb,
        "system_logs",
        (q) => q.gte("created_at", start).lt("created_at", end).eq("level", "error"),
      ),
      countRows(sb, "advertisements", (q) => q.gte("last_sent_at", start).lt("last_sent_at", end)),
      countRows(sb, "scheduled_posts", (q) => q.gte("sent_at", start).lt("sent_at", end)),
      countRows(sb, "banned_users", (q) => q.eq("is_active", true).lt("created_at", end)),
    ]);

  await upsertRow(sb, "bot_stats_daily", {
    day: dayIso,
    new_users: newUsers,
    active_users: activeUsers,
    ai_requests: aiRequests,
    ai_fallbacks: aiFallbacks,
    errors,
    ads_sent: ads,
    posts_sent: posts,
    blocked_users: blocked,
    updated_at: new Date().toISOString(),
  }, "day");

  const row = await selectRows<StatsRow>(sb, "bot_stats_daily", (q) => q.eq("day", dayIso));
  return row[0];
}

export interface GroupActivity {
  groupId: number;
  title: string;
  actions: number;
}

export async function groupActivity(
  sb: SupabaseClient,
  days = 7,
): Promise<GroupActivity[]> {
  const since = daysAgoIso(days);
  const logs = await selectRows<{ group_id: number; action: string }>(
    sb,
    "moderation_logs",
    (q) => q.gte("created_at", since).limit(1000),
  );
  const counts = new Map<number, number>();
  for (const log of logs) counts.set(log.group_id, (counts.get(log.group_id) ?? 0) + 1);
  const groups = await selectRows<{ telegram_chat_id: number; title: string | null }>(
    sb,
    "groups",
    (q) => q.eq("is_active", true),
  );
  return groups
    .map((group) => ({
      groupId: group.telegram_chat_id,
      title: group.title ?? String(group.telegram_chat_id),
      actions: counts.get(group.telegram_chat_id) ?? 0,
    }))
    .sort((a, b) => b.actions - a.actions)
    .slice(0, 8);
}

export async function weeklyReport(
  sb: SupabaseClient,
  timeZone: string,
  now = new Date(),
): Promise<string> {
  const [overview, series, groups] = await Promise.all([
    collectOverview(sb, timeZone, now),
    collectSeries(sb, 7, timeZone, now),
    groupActivity(sb, 7),
  ]);

  const groupLines = groups.length === 0
    ? "<i>گروهی ثبت نشده است.</i>"
    : groups.map((group, index) =>
      `${faNum(index + 1)}. ${group.title} — ${faNum(group.actions)} اقدام`
    ).join("\n");

  return [
    "<b>📈 گزارش هفتگی Anime Click</b>",
    `<i>${new Intl.DateTimeFormat("fa-IR", { timeZone, dateStyle: "full" }).format(now)}</i>`,
    divider(),
    `<b>کاربران</b>: کل ${faNum(overview.totalUsers)} • فعال ۷ روز ${
      faNum(overview.active7d)
    } • جدید امروز ${faNum(overview.newUsersToday)}`,
    `<b>پیام‌ها</b>: امروز ${faNum(overview.messagesToday)}`,
    `<b>AI</b>: امروز ${faNum(overview.aiRequestsToday)} درخواست • ${
      faNum(overview.aiFallbacksToday)
    } پاسخ جایگزین`,
    `<b>خطاها</b>: امروز ${faNum(overview.errorsToday)} • AI ${faNum(overview.aiErrorsToday)}`,
    `<b>تبلیغات</b>: ${faNum(overview.adsActive)} فعال • مجموع ارسال ${faNum(overview.adsSent)}`,
    `<b>محتوای منتشرشده</b>: ${faNum(overview.postsPublished)}`,
    `<b>صف ارسال همگانی</b>: ${faNum(overview.pendingBroadcastRows)}`,
    `<b>زمان‌بندی در انتظار</b>: ${faNum(overview.scheduledPending)}`,
    "",
    "<b>۷ روز گذشته</b>",
    renderSeries(series),
    "",
    "<b>فعال‌ترین گروه‌ها</b>",
    groupLines,
    "",
    `<i>وضعیت کمپین‌ها: ${
      statusLabel("campaign", overview.campaignsActive > 0 ? "running" : "completed")
    }</i>`,
  ].join("\n");
}

export async function aiUsageSummary(
  sb: SupabaseClient,
  timeZone: string,
): Promise<
  { today: number; fallbacks: number; quota: number; errors: number; avgLatency: number }
> {
  const since = startOfDayIso(timeZone);
  const rows = await selectRows<{ status: string; latency_ms: number }>(
    sb,
    "ai_usage",
    (q) => q.gte("created_at", since),
  );
  const succeeded = rows.filter((row) => row.status === "success");
  const avgLatency = succeeded.length === 0
    ? 0
    : Math.round(succeeded.reduce((sum, row) => sum + row.latency_ms, 0) / succeeded.length);
  return {
    today: rows.filter((row) => row.status === "success" || row.status === "fallback").length,
    fallbacks: rows.filter((row) => row.status === "fallback").length,
    quota: rows.filter((row) => row.status === "quota" || row.status === "rate_limited").length,
    errors: rows.filter((row) => row.status === "error").length,
    avgLatency,
  };
}
