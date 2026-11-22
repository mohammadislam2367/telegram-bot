/**
 * Runtime configuration for Anime Click Ultimate.
 * همه‌ی مقادیر محرمانه فقط از Supabase Secrets خوانده می‌شوند.
 */

export interface AppConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  botToken: string;
  webhookSecret: string;
  schedulerSecret: string;
  superAdminIds: number[];
  geminiApiKey: string;
  geminiModel: string;
  botUsername: string;
  timezone: string;
  environment: "production" | "development" | "test";
}

export class ConfigError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(`تنظیمات ناقص است: ${missing.join(", ")}`);
    this.name = "ConfigError";
    this.missing = missing;
  }
}

export type EnvSource = Record<string, string | undefined>;

export function readEnv(): EnvSource {
  const deno = (globalThis as { Deno?: { env?: { toObject(): Record<string, string> } } }).Deno;
  if (deno?.env) return deno.env.toObject();
  return {};
}

function parseSuperAdmins(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => /^\d{3,20}$/.test(part))
    .map((part) => Number(part))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

export function loadConfig(env: EnvSource = readEnv()): AppConfig {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TELEGRAM_BOT_TOKEN"] as const;
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length > 0) throw new ConfigError([...missing]);

  const superAdminIds = parseSuperAdmins(env.SUPER_ADMIN_IDS);
  if (superAdminIds.length === 0) throw new ConfigError(["SUPER_ADMIN_IDS"]);

  return {
    supabaseUrl: env.SUPABASE_URL!.trim().replace(/\/$/, ""),
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    botToken: env.TELEGRAM_BOT_TOKEN!.trim(),
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "",
    schedulerSecret: env.SCHEDULER_SECRET?.trim() ?? "",
    superAdminIds,
    geminiApiKey: env.GEMINI_API_KEY?.trim() ?? "",
    geminiModel: env.GEMINI_MODEL?.trim() || "gemini-2.0-flash",
    botUsername: (env.BOT_USERNAME?.trim() || "Spixle_bot").replace(/^@/, ""),
    timezone: env.APP_TIMEZONE?.trim() || "Asia/Tehran",
    environment: env.DENO_ENV === "test"
      ? "test"
      : env.DENO_DEPLOYMENT_ID
      ? "production"
      : "development",
  };
}

/** برای بررسی زودهنگام در deploy بدون پرینت مقدار */
export function describeConfig(cfg: AppConfig): Record<string, string | number | boolean> {
  return {
    supabaseUrl: cfg.supabaseUrl,
    botUsername: cfg.botUsername,
    superAdminCount: cfg.superAdminIds.length,
    hasWebhookSecret: cfg.webhookSecret.length > 0,
    hasSchedulerSecret: cfg.schedulerSecret.length > 0,
    aiProviderConfigured: cfg.geminiApiKey.length > 0,
    aiModel: cfg.geminiModel,
    timezone: cfg.timezone,
    environment: cfg.environment,
  };
}
