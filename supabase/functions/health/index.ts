/**
 * Health check — بدون هیچ داده حساس.
 * ?deep=1 اتصال Telegram را هم بررسی می‌کند (نیازمند توکن معتبر).
 */
import { ConfigError, loadConfig } from "../_shared/config.ts";
import { getSupabase, pingDatabase } from "../_shared/db.ts";
import { TelegramApi } from "../_shared/telegram.ts";
import { jsonResponse } from "../_shared/http.ts";

const SERVICE = "anime-click-ultimate-health";

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "GET") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  const url = new URL(request.url);
  const deep = url.searchParams.get("deep") === "1";

  let cfg;
  try {
    cfg = loadConfig();
  } catch (error) {
    const missing = error instanceof ConfigError ? error.missing : ["unknown"];
    return jsonResponse({ ok: false, service: SERVICE, error: "config", missing }, 503);
  }

  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  let databaseOk = false;

  try {
    databaseOk = await pingDatabase(getSupabase(cfg));
    checks.database = { ok: databaseOk };
  } catch (error) {
    checks.database = { ok: false, detail: (error as Error).message.slice(0, 120) };
  }

  if (deep) {
    try {
      const me = await new TelegramApi(cfg.botToken).getMe();
      checks.telegram = { ok: true, detail: `@${me.username ?? me.id}` };
    } catch (error) {
      checks.telegram = { ok: false, detail: (error as Error).message.slice(0, 120) };
    }
  }

  const ok = databaseOk && (!deep || checks.telegram?.ok === true);
  return jsonResponse({
    ok,
    service: SERVICE,
    version: "1.0.0",
    time: new Date().toISOString(),
    checks,
  }, ok ? 200 : 503);
});
