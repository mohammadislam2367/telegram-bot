/**
 * Broadcast runner — ارسال دسته‌ای با تصاحب اتمی صف، رعایت نرخ تلگرام،
 * توقف خودکار در خطاهای پیاپی و امکان توقف/ادامه توسط مدیر.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { callRpc, countRows, selectOne, selectRows, updateRows } from "./db.ts";
import { parseStoredButtons, sendRichMessage } from "./publishers.ts";
import { sleep } from "./http.ts";
import type { TelegramApi } from "./telegram.ts";
import type { SettingsStore } from "./settings.ts";
import type { BanRow, CampaignRow, UserRow } from "./types.ts";

export interface BroadcastDeps {
  sb: SupabaseClient;
  tg: TelegramApi;
  settings: SettingsStore;
}

export interface BroadcastTickResult {
  processed: boolean;
  campaignId: string | null;
  sent: number;
  failed: number;
  skipped: number;
  remaining: number;
  status: string;
  note?: string;
}

const IDLE: BroadcastTickResult = {
  processed: false,
  campaignId: null,
  sent: 0,
  failed: 0,
  skipped: 0,
  remaining: 0,
  status: "idle",
};

async function selectRunningCampaign(sb: SupabaseClient): Promise<CampaignRow | null> {
  return await selectOne<CampaignRow>(
    sb,
    "broadcast_campaigns",
    (q) => q.eq("status", "running").order("created_at", { ascending: true }).limit(1),
  );
}

/** یک تیک ارسال: حداکثر یک batch. */
export async function runBroadcastTick(
  deps: BroadcastDeps,
  options: { now?: Date } = {},
): Promise<BroadcastTickResult> {
  const { sb, tg, settings } = deps;
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();

  // 1) بازگرداندن claimهای گیرکرده
  try {
    await callRpc<number>(sb, "reset_stale_broadcast_claims", {
      p_campaign_id: null,
      p_minutes: 10,
    });
  } catch (error) {
    console.warn("reset stale claims failed:", (error as Error).message);
  }

  let campaign = await selectRunningCampaign(sb);

  if (!campaign) {
    const queued = await selectOne<CampaignRow>(
      sb,
      "broadcast_campaigns",
      (q) => q.eq("status", "queued").order("created_at", { ascending: true }).limit(1),
    );
    if (!queued) return IDLE;

    const started = await updateRows<CampaignRow>(
      sb,
      "broadcast_campaigns",
      { status: "running", started_at: queued.started_at ?? nowIso, last_error: null },
      { id: queued.id, status: "queued" },
    );
    campaign = started[0] ?? await selectRunningCampaign(sb);
    if (!campaign) {
      return { ...IDLE, note: "کمپین دیگری در حال اجراست." };
    }
  }

  const batchSize = Math.min(Math.max(await settings.get("broadcast_batch_size"), 1), 50);
  const delayMs = Math.min(Math.max(await settings.get("broadcast_delay_ms"), 0), 3000);
  const maxFailStreak = Math.max(await settings.get("broadcast_max_fail_streak"), 5);

  const claimed = await callRpc<{ log_id: number; user_id: number }[]>(
    sb,
    "claim_broadcast_batch",
    { p_campaign_id: campaign.id, p_limit: batchSize },
  );

  if (claimed.length === 0) {
    const remaining = await countRows(
      sb,
      "broadcast_logs",
      (q) => q.eq("campaign_id", campaign.id).eq("status", "pending"),
    );
    const status = remaining === 0 ? "completed" : "running";
    await updateRows(sb, "broadcast_campaigns", {
      status,
      finished_at: remaining === 0 ? nowIso : null,
      updated_at: nowIso,
    }, { id: campaign.id });
    return {
      processed: true,
      campaignId: campaign.id,
      sent: 0,
      failed: 0,
      skipped: 0,
      remaining,
      status,
    };
  }

  const userIds = [...new Set(claimed.map((row) => row.user_id))];
  const users = await selectRows<UserRow>(sb, "users", (q) => q.in("telegram_id", userIds));
  const bans = await selectRows<BanRow>(
    sb,
    "banned_users",
    (q) => q.in("user_id", userIds).eq("is_active", true),
  );

  const userMap = new Map(users.map((user) => [user.telegram_id, user]));
  const banned = new Set(
    bans
      .filter((ban) => !ban.expires_at || new Date(ban.expires_at).getTime() > now.getTime())
      .map((ban) => ban.user_id),
  );

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let stopRequested = false;
  const failMessages: string[] = [];

  for (const row of claimed) {
    if (stopRequested) break;

    const user = userMap.get(row.user_id);
    const freshCampaign = await selectOne<Pick<CampaignRow, "status">>(
      sb,
      "broadcast_campaigns",
      (q) => q.eq("id", campaign!.id),
    );
    if (
      !freshCampaign || freshCampaign.status === "paused" || freshCampaign.status === "cancelled"
    ) {
      stopRequested = true;
      // ردیف تصاحب‌شده به صف بازمی‌گردد
      await updateRows(sb, "broadcast_logs", { status: "pending", locked_at: null }, {
        id: row.log_id,
      });
      break;
    }

    if (!user || !user.broadcast_opt_in || banned.has(row.user_id)) {
      skipped++;
      await updateRows(sb, "broadcast_logs", {
        status: "skipped",
        error: !user ? "user_missing" : banned.has(row.user_id) ? "bot_banned" : "opted_out",
      }, { id: row.log_id });
      continue;
    }

    const result = await sendRichMessage(tg, user.telegram_id, {
      text: campaign.text,
      mediaType: campaign.message_type === "text" ? "none" : campaign.message_type,
      mediaFileId: campaign.media_file_id,
      buttons: parseStoredButtons(campaign.buttons),
    });

    if (result.ok) {
      sent++;
      await updateRows(sb, "broadcast_logs", {
        status: "sent",
        sent_at: new Date().toISOString(),
        error: null,
      }, { id: row.log_id });
    } else if (result.unreachable) {
      skipped++;
      await updateRows(sb, "broadcast_logs", {
        status: "skipped",
        error: result.error ?? "unreachable",
      }, { id: row.log_id });
      await updateRows(sb, "users", {
        broadcast_opt_in: false,
        updated_at: new Date().toISOString(),
      }, { telegram_id: row.user_id });
    } else {
      failed++;
      failMessages.push(result.error ?? "unknown");
      await updateRows(sb, "broadcast_logs", {
        status: "failed",
        error: result.error ?? "unknown",
      }, { id: row.log_id });
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  // شمارنده‌ها را از منبع اصلی بازمحاسبه می‌کنیم
  const [sentCount, failedCount, skippedCount, pendingCount] = await Promise.all([
    countRows(sb, "broadcast_logs", (q) => q.eq("campaign_id", campaign!.id).eq("status", "sent")),
    countRows(
      sb,
      "broadcast_logs",
      (q) => q.eq("campaign_id", campaign!.id).eq("status", "failed"),
    ),
    countRows(
      sb,
      "broadcast_logs",
      (q) => q.eq("campaign_id", campaign!.id).eq("status", "skipped"),
    ),
    countRows(
      sb,
      "broadcast_logs",
      (q) => q.eq("campaign_id", campaign!.id).eq("status", "pending"),
    ),
  ]);

  // توقف خودکار در خطاهای پیاپی (مثلاً ربات توسط همه بلاک شده)
  const recent = await selectRows<{ status: string }>(
    sb,
    "broadcast_logs",
    (q) => q.eq("campaign_id", campaign!.id).order("id", { ascending: false }).limit(maxFailStreak),
  );
  const failStreak = recent.length >= maxFailStreak &&
    recent.every((row) => row.status === "failed");

  if (failStreak) {
    await updateRows(sb, "broadcast_campaigns", {
      status: "paused",
      last_error: `توقف خودکار پس از ${maxFailStreak} خطای پیاپی: ${failMessages[0] ?? "unknown"}`,
      updated_at: nowIso,
      sent_count: sentCount,
      failed_count: failedCount,
      skipped_count: skippedCount,
    }, { id: campaign.id });
    return {
      processed: true,
      campaignId: campaign.id,
      sent,
      failed,
      skipped,
      remaining: pendingCount,
      status: "paused",
      note: "توقف خودکار به دلیل خطاهای پیاپی",
    };
  }

  const completed = pendingCount === 0 && !stopRequested;
  const status = stopRequested
    ? (await selectOne<Pick<CampaignRow, "status">>(
      sb,
      "broadcast_campaigns",
      (q) => q.eq("id", campaign!.id),
    ))?.status ??
      "paused"
    : completed
    ? "completed"
    : "running";

  await updateRows(sb, "broadcast_campaigns", {
    status,
    sent_count: sentCount,
    failed_count: failedCount,
    skipped_count: skippedCount,
    finished_at: completed ? nowIso : null,
    last_error: failMessages[0] ?? null,
    updated_at: nowIso,
  }, { id: campaign.id });

  return {
    processed: true,
    campaignId: campaign.id,
    sent,
    failed,
    skipped,
    remaining: pendingCount,
    status,
  };
}

export async function campaignProgress(
  sb: SupabaseClient,
  campaignId: string,
): Promise<{ sent: number; failed: number; skipped: number; pending: number; total: number }> {
  const [sent, failed, skipped, pending] = await Promise.all([
    countRows(sb, "broadcast_logs", (q) => q.eq("campaign_id", campaignId).eq("status", "sent")),
    countRows(sb, "broadcast_logs", (q) => q.eq("campaign_id", campaignId).eq("status", "failed")),
    countRows(sb, "broadcast_logs", (q) => q.eq("campaign_id", campaignId).eq("status", "skipped")),
    countRows(sb, "broadcast_logs", (q) => q.eq("campaign_id", campaignId).eq("status", "pending")),
  ]);
  return { sent, failed, skipped, pending, total: sent + failed + skipped + pending };
}

export async function startCampaign(
  sb: SupabaseClient,
  campaignId: string,
  actorId: number,
): Promise<CampaignRow | null> {
  const rows = await updateRows<CampaignRow>(sb, "broadcast_campaigns", {
    status: "queued",
    approved_by: actorId,
    updated_at: new Date().toISOString(),
    last_error: null,
  }, { id: campaignId, status: "draft" });
  if (rows.length > 0) return rows[0];
  const paused = await updateRows<CampaignRow>(sb, "broadcast_campaigns", {
    status: "queued",
    updated_at: new Date().toISOString(),
  }, { id: campaignId, status: "paused" });
  return paused[0] ?? null;
}

export async function pauseCampaign(sb: SupabaseClient, campaignId: string): Promise<void> {
  await updateRows(sb, "broadcast_campaigns", {
    status: "paused",
    updated_at: new Date().toISOString(),
  }, { id: campaignId, status: "running" });
}

export async function cancelCampaign(sb: SupabaseClient, campaignId: string): Promise<number> {
  await updateRows(sb, "broadcast_campaigns", {
    status: "cancelled",
    finished_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { id: campaignId });
  const pending = await selectRows<{ id: number }>(
    sb,
    "broadcast_logs",
    (q) => q.eq("campaign_id", campaignId).eq("status", "pending"),
  );
  if (pending.length > 0) {
    await updateRows(sb, "broadcast_logs", {
      status: "skipped",
      error: "campaign_cancelled",
    }, { campaign_id: campaignId, status: "pending" });
  }
  return pending.length;
}
