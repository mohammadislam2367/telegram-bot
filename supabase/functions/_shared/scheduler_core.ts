/**
 * وظایف زمان‌بندی‌شده — چون Edge Functions اجرای دائمی ندارند، pg_cron هر دقیقه
 * تابع scheduler را صدا می‌زند و این ماژول کارهای دوره‌ای را انجام می‌دهد.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "./config.ts";
import { callRpc, insertRow, selectOne, updateRows } from "./db.ts";
import type { TelegramApi } from "./telegram.ts";
import { splitMessage, TelegramError } from "./telegram.ts";
import { SettingsStore } from "./settings.ts";
import type { Logger } from "./logger.ts";
import { publishAdvertisement, publishContentPost, publishScheduledPost } from "./publishers.ts";
import { runBroadcastTick } from "./broadcast_runner.ts";
import { getAiState, testAiConnection } from "./ai_core.ts";
import { deleteExpiredSessions } from "./sessions.ts";
import { aggregateDay, shiftDay, weeklyReport } from "./stats_core.ts";
import { todayInZone } from "./validation.ts";
import { truncate } from "./validation.ts";
import type { AdRow, ContentPostRow, ScheduledPostRow } from "./types.ts";

export interface SchedulerDeps {
  sb: SupabaseClient;
  tg: TelegramApi;
  settings: SettingsStore;
  cfg: AppConfig;
  logger?: Logger;
}

export interface SchedulerSummary {
  startedAt: string;
  finishedAt: string;
  ads: { sent: number; failed: number; postponed: number };
  scheduledPosts: { sent: number; failed: number; repeated: number };
  content: { published: number; failed: number };
  broadcast: { campaignId: string | null; sent: number; failed: number; remaining: number };
  aiHealth: { checked: boolean; ok: boolean; message: string };
  stats: { aggregated: boolean; weeklyReport: boolean };
  cleanup: { sessions: number };
}

function nextOccurrence(interval: string, from: Date): Date | null {
  switch (interval) {
    case "daily":
      return new Date(from.getTime() + 86_400_000);
    case "weekly":
      return new Date(from.getTime() + 7 * 86_400_000);
    case "monthly":
      return new Date(from.getTime() + 30 * 86_400_000);
    default:
      return null;
  }
}

async function publishDueAds(deps: SchedulerDeps, now: Date): Promise<SchedulerSummary["ads"]> {
  const nowIso = now.toISOString();
  // claim اتمی: هر اجرا فقط ردیف‌هایی را می‌گیرد که اجرای دیگری قفل نکرده است
  const due = await callRpc<AdRow[]>(deps.sb, "claim_due_advertisements", { p_limit: 3 });
  if (due.length === 0) return { sent: 0, failed: 0, postponed: 0 };

  // فاصله‌ی حداقلی بین تبلیغات کانال
  const minInterval = Math.max(await deps.settings.get("ads_min_interval_minutes"), 0);
  const last = await selectOne<Pick<AdRow, "last_sent_at">>(
    deps.sb,
    "advertisements",
    (q) => q.not("last_sent_at", "is", null).order("last_sent_at", { ascending: false }),
  );
  if (minInterval > 0 && last?.last_sent_at) {
    const elapsedMin = (now.getTime() - new Date(last.last_sent_at).getTime()) / 60_000;
    if (elapsedMin < minInterval) {
      const next = new Date(new Date(last.last_sent_at).getTime() + minInterval * 60_000);
      for (const ad of due) {
        await updateRows(deps.sb, "advertisements", {
          scheduled_at: next.toISOString(),
          claimed_at: null,
          updated_at: nowIso,
        }, { id: ad.id });
      }
      return { sent: 0, failed: 0, postponed: due.length };
    }
  }

  let sent = 0;
  let failed = 0;
  for (const ad of due) {
    const result = await publishAdvertisement(deps, ad);
    if (result.ok) {
      sent++;
      const next = nextOccurrence(ad.repeat_interval, now);
      await updateRows(deps.sb, "advertisements", {
        sent_count: ad.sent_count + 1,
        last_sent_at: nowIso,
        last_error: null,
        claimed_at: null,
        scheduled_at: next ? next.toISOString() : null,
        updated_at: nowIso,
      }, { id: ad.id });
      await callRpc(deps.sb, "bump_daily_stat", {
        p_day: nowIso.slice(0, 10),
        p_field: "ads_sent",
        p_amount: 1,
      }).catch(() => undefined);
      await deps.logger?.info("ad published", { adId: ad.id, target: result.target });
    } else {
      failed++;
      const permanent = result.permanent === true;
      await updateRows(deps.sb, "advertisements", {
        error_count: ad.error_count + 1,
        last_error: truncate(result.error ?? "unknown", 500),
        status: permanent ? "paused" : "active",
        claimed_at: null,
        updated_at: nowIso,
        ...(permanent ? {} : { scheduled_at: new Date(now.getTime() + 10 * 60_000).toISOString() }),
      }, { id: ad.id });
      await deps.logger?.warn("ad publish failed", {
        adId: ad.id,
        error: result.error,
        permanent,
      });
    }
  }
  return { sent, failed, postponed: 0 };
}

async function publishDueScheduledPosts(
  deps: SchedulerDeps,
  now: Date,
): Promise<SchedulerSummary["scheduledPosts"]> {
  const nowIso = now.toISOString();
  const due = await callRpc<ScheduledPostRow[]>(deps.sb, "claim_due_scheduled_posts", {
    p_limit: 5,
  });
  let sent = 0;
  let failed = 0;
  let repeated = 0;

  for (const post of due) {
    const result = await publishScheduledPost(deps, post);
    if (result.ok) {
      sent++;
      await updateRows(deps.sb, "scheduled_posts", {
        status: "sent",
        sent_message_id: result.messageId ?? null,
        sent_at: nowIso,
        attempts: post.attempts + 1,
        last_error: null,
        claimed_at: null,
        updated_at: nowIso,
      }, { id: post.id });

      const next = nextOccurrence(post.repeat_interval, new Date(post.scheduled_at));
      if (next) {
        repeated++;
        await insertRow(deps.sb, "scheduled_posts", {
          title: post.title,
          body: post.body,
          media_type: post.media_type,
          media_file_id: post.media_file_id,
          buttons: post.buttons,
          target_chat: post.target_chat,
          scheduled_at: next.toISOString(),
          repeat_interval: post.repeat_interval,
          status: "pending",
          created_by: post.created_by,
        });
      }
      await callRpc(deps.sb, "bump_daily_stat", {
        p_day: nowIso.slice(0, 10),
        p_field: "posts_sent",
        p_amount: 1,
      }).catch(() => undefined);
    } else {
      failed++;
      const attempts = post.attempts + 1;
      await updateRows(deps.sb, "scheduled_posts", {
        attempts,
        last_error: truncate(result.error ?? "unknown", 500),
        status: attempts >= 3 ? "failed" : "pending",
        claimed_at: null,
        scheduled_at: attempts >= 3
          ? post.scheduled_at
          : new Date(now.getTime() + 10 * 60_000).toISOString(),
        updated_at: nowIso,
      }, { id: post.id });
    }
  }
  return { sent, failed, repeated };
}

async function publishDueContent(
  deps: SchedulerDeps,
  now: Date,
): Promise<SchedulerSummary["content"]> {
  const nowIso = now.toISOString();
  const due = await callRpc<ContentPostRow[]>(deps.sb, "claim_due_content_posts", {
    p_limit: 5,
  });
  let published = 0;
  let failed = 0;

  for (const post of due) {
    const result = await publishContentPost(deps, post);
    if (result.ok) {
      published++;
      await updateRows(deps.sb, "content_posts", {
        status: "published",
        published_at: nowIso,
        telegram_message_id: result.messageId ?? null,
        publish_attempts: post.publish_attempts + 1,
        last_error: null,
        claimed_at: null,
        updated_at: nowIso,
      }, { id: post.id });
    } else {
      failed++;
      const attempts = post.publish_attempts + 1;
      await updateRows(deps.sb, "content_posts", {
        publish_attempts: attempts,
        last_error: truncate(result.error ?? "unknown", 500),
        status: attempts >= 3 ? "draft" : "scheduled",
        claimed_at: null,
        updated_at: nowIso,
      }, { id: post.id });
    }
  }
  return { published, failed };
}

async function maybeRetryAi(deps: SchedulerDeps, now: Date): Promise<SchedulerSummary["aiHealth"]> {
  const state = await getAiState(deps.sb);
  if (state.status === "ok" || state.status === "disabled") {
    return { checked: false, ok: state.status === "ok", message: "" };
  }
  if (state.next_retry_at && new Date(state.next_retry_at).getTime() > now.getTime()) {
    return { checked: false, ok: false, message: "هنوز زمان تلاش مجدد نرسیده است." };
  }

  const result = await testAiConnection(deps);
  if (!result.ok) {
    // جلوگیری از تلاش پرتکرار: افزایش تدریجی cooldown
    const cooldown = Math.min(
      Math.max(await deps.settings.get("ai_fallback_cooldown_seconds"), 300) * 2,
      21_600,
    );
    await updateRows(deps.sb, "ai_state", {
      next_retry_at: new Date(now.getTime() + cooldown * 1000).toISOString(),
      updated_at: now.toISOString(),
    }, { id: 1 });
  }
  return { checked: true, ok: result.ok, message: result.message };
}

async function maybeAggregateAndReport(
  deps: SchedulerDeps,
  now: Date,
): Promise<SchedulerSummary["stats"]> {
  const timeZone = await deps.settings.get("timezone");
  const today = todayInZone(timeZone, now);
  let aggregated = false;
  let weeklySent = false;

  const aggregationKey = "last_aggregation_date";
  const stored = await selectOne<{ value: unknown }>(
    deps.sb,
    "bot_settings",
    (q) => q.eq("key", aggregationKey),
  );
  if (stored?.value !== today) {
    try {
      await aggregateDay(deps.sb, shiftDay(today, -1), timeZone);
      await aggregateDay(deps.sb, today, timeZone);
      await deps.settings.set(aggregationKey, today);
      aggregated = true;
    } catch (error) {
      await deps.logger?.warn("daily aggregation failed", { error: (error as Error).message });
    }
  }

  const weeklyEnabled = await deps.settings.get("weekly_report_enabled");
  if (weeklyEnabled) {
    const reportDay = await deps.settings.get("weekly_report_day");
    const reportHour = await deps.settings.get("weekly_report_hour");
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const weekdayLabel = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayLabel);

    const lastReport = await selectOne<{ value: unknown }>(
      deps.sb,
      "bot_settings",
      (q) => q.eq("key", "last_weekly_report_date"),
    );

    if (weekday === reportDay && hour === reportHour && lastReport?.value !== today) {
      const text = await weeklyReport(deps.sb, timeZone, now);
      for (const adminId of deps.cfg.superAdminIds) {
        for (const chunk of splitMessage(text, 3800)) {
          try {
            await deps.tg.sendMessage(adminId, chunk);
          } catch (error) {
            if (!(error instanceof TelegramError)) throw error;
          }
        }
      }
      await deps.settings.set("last_weekly_report_date", today);
      weeklySent = true;
    }
  }

  return { aggregated, weeklyReport: weeklySent };
}

export async function runScheduler(
  deps: SchedulerDeps,
  options: { now?: Date; skipBroadcast?: boolean } = {},
): Promise<SchedulerSummary> {
  const now = options.now ?? new Date();
  const startedAt = new Date().toISOString();

  const ads = await publishDueAds(deps, now);
  const scheduledPosts = await publishDueScheduledPosts(deps, now);
  const content = await publishDueContent(deps, now);

  let broadcast: SchedulerSummary["broadcast"] = {
    campaignId: null,
    sent: 0,
    failed: 0,
    remaining: 0,
  };
  if (!options.skipBroadcast) {
    try {
      const tick = await runBroadcastTick(deps, { now });
      broadcast = {
        campaignId: tick.campaignId,
        sent: tick.sent,
        failed: tick.failed,
        remaining: tick.remaining,
      };
    } catch (error) {
      await deps.logger?.error("broadcast tick failed", { error: (error as Error).message });
    }
  }

  const aiHealth = await maybeRetryAi(deps, now);
  const stats = await maybeAggregateAndReport(deps, now);

  const sessions = await deleteExpiredSessions(deps.sb, now);

  // پاک‌سازی دوره‌ای داده‌های قدیمی (روزی یک‌بار، ساعت ۳ بامداد UTC)
  if (now.getUTCHours() === 3 && now.getUTCMinutes() === 17) {
    await callRpc(deps.sb, "prune_old_data", {
      p_days: await deps.settings.get("data_retention_days"),
    }).catch(() => undefined);
  }

  const failedSteps = ads.failed + scheduledPosts.failed + content.failed + broadcast.failed;
  if (failedSteps > 0) {
    await deps.logger?.warn("scheduler finished with failures", { failedSteps });
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    ads,
    scheduledPosts,
    content,
    broadcast,
    aiHealth,
    stats,
    cleanup: { sessions },
  };
}
