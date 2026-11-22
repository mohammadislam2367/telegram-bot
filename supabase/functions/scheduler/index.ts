/**
 * Scheduler — با pg_cron هر دقیقه فراخوانی می‌شود.
 * فقط با X-Scheduler-Secret یا Bearer مجاز است.
 */
import { ConfigError, loadConfig } from "../_shared/config.ts";
import { getSupabase } from "../_shared/db.ts";
import { createLogger } from "../_shared/logger.ts";
import { SettingsStore } from "../_shared/settings.ts";
import { TelegramApi } from "../_shared/telegram.ts";
import { verifySchedulerSecret } from "../_shared/auth.ts";
import { runScheduler } from "../_shared/scheduler_core.ts";
import { jsonResponse } from "../_shared/http.ts";

const SERVICE = "anime-click-ultimate-scheduler";

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "GET") {
    return jsonResponse({ ok: true, service: SERVICE, note: "POST with scheduler secret" });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  let cfg;
  try {
    cfg = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      return jsonResponse(
        { ok: false, error: "server_not_configured", missing: error.missing },
        500,
      );
    }
    throw error;
  }

  if (!cfg.schedulerSecret) {
    return jsonResponse({ ok: false, error: "scheduler_secret_not_configured" }, 500);
  }

  const provided = request.headers.get("x-scheduler-secret") ??
    request.headers.get("authorization");
  if (!verifySchedulerSecret(provided, cfg.schedulerSecret)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const sb = getSupabase(cfg);
  const tg = new TelegramApi(cfg.botToken);
  const log = createLogger(sb, "scheduler");
  const settings = new SettingsStore(sb);

  try {
    const summary = await runScheduler({ sb, tg, settings, cfg, logger: log });
    await log.info("scheduler run", {
      ads: summary.ads,
      posts: summary.scheduledPosts,
      content: summary.content,
      broadcast: summary.broadcast,
    });
    return jsonResponse({ ok: true, summary });
  } catch (error) {
    await log.error("scheduler failed", { error: (error as Error).message });
    return jsonResponse({
      ok: false,
      error: "scheduler_failed",
      message: (error as Error).message,
    }, 500);
  }
});
