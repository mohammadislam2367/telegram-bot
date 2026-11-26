/**
 * bot_settings access — مقادیر پیش‌فرض در کد (هم‌راستا با seed.sql).
 * هر تغییر در داشبورد بلافاصله روی همین نمونه‌ی SettingsStore اثر می‌گذارد.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectRows, upsertRow } from "./db.ts";

const DEFAULT_WELCOME = `🌸 به <b>Anime Click Ultimate</b> خوش آمدی!

از منوی زیر می‌توانی چت هوشمند، جستجوی انیمه و آخرین خبرها را ببینی.`;

export const DEFAULT_SETTINGS = {
  maintenance_mode: false,
  maintenance_text: "🛠 ربات موقتاً در حال به‌روزرسانی است. لطفاً کمی بعد دوباره تلاش کنید.",
  welcome_text: DEFAULT_WELCOME,
  channel_target: "@clickanime128",
  channel_url: "https://t.me/clickanime128",
  group_url: "",
  support_username: "@Spixle_bot",
  ai_enabled: true,
  ai_persona:
    "تو «اسپیکسل» هستی، دستیار هوشمند فارسی‌زبان. قواعدت: (۱) کوتاه و روشن جواب بده و از پرحرفی پرهیز کن. (۲) اگر پرسش چند بخش دارد، با فهرست شماره‌دار جواب بده. (۳) زبان را با لحن کاربر هماهنگ کن: خودمانی برای سؤال خودمانی، رسمی برای سؤال رسمی. (۴) دربارهٔ انیمه، مانجا و اخبار فناوری اطلاعات دقیق بده. (۵) اگر مطمئن نیستی صریح بگو نمی‌دانم و حدس نزن. (۶) از تکرار سؤال کاربر و مقدمه‌چینی طولانی خودداری کن.",
  ai_model: "gemini-2.5-flash",
  ai_daily_limit: 40,
  ai_memory_messages: 16,
  ai_memory_enabled: true,
  ai_fallback_cooldown_seconds: 900,
  ai_max_retries: 2,
  ai_group_daily_limit: 8,
  ai_group_cooldown_seconds: 90,
  ai_anime_context: true,
  group_warning_text:
    "⚠️ {name} عزیز، این یک اخطار رسمی است ({count} از {limit}).\n\nادامه‌ی این رفتار باعث محدودیت در گروه «{group}» می‌شود.",
  feature_ai: true,
  feature_anime: true,
  feature_news: true,
  feature_ads: true,
  feature_broadcast: true,
  feature_content: true,
  feature_groups: true,
  feature_scheduling: true,
  broadcast_batch_size: 20,
  broadcast_delay_ms: 800,
  broadcast_max_fail_streak: 20,
  broadcast_require_confirm: true,
  ads_label: "تبلیغ",
  ads_default_target: "",
  ads_min_interval_minutes: 30,
  session_ttl_minutes: 30,
  user_rate_limit_per_minute: 20,
  admin_rate_limit_per_minute: 60,
  data_retention_days: 90,
  weekly_report_enabled: true,
  weekly_report_day: 5,
  weekly_report_hour: 20,
  daily_stats_enabled: true,
  timezone: "Asia/Tehran",
  bot_version: "1.0.0",
  last_weekly_report_date: "",
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof DEFAULT_SETTINGS)[K];

export class SettingsStore {
  private cache: Record<string, unknown> | null = null;
  private loadedAt = 0;

  constructor(
    private readonly sb: SupabaseClient,
    private readonly ttlMs = 60_000,
  ) {}

  private async load(force = false): Promise<Record<string, unknown>> {
    if (!force && this.cache && Date.now() - this.loadedAt < this.ttlMs) return this.cache;
    try {
      const rows = await selectRows<{ key: string; value: unknown }>(this.sb, "bot_settings");
      const map: Record<string, unknown> = { ...DEFAULT_SETTINGS };
      for (const row of rows) map[row.key] = row.value;
      this.cache = map;
      this.loadedAt = Date.now();
      return map;
    } catch (error) {
      console.warn("settings load failed, using defaults:", (error as Error).message);
      return { ...DEFAULT_SETTINGS };
    }
  }

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const map = await this.load();
    const raw = map[key];
    const fallback = DEFAULT_SETTINGS[key];
    if (typeof fallback === "boolean") {
      return (((raw ?? fallback) === true) as unknown) as SettingValue<K>;
    }
    if (typeof fallback === "number") {
      const value = Number(raw ?? fallback);
      return (Number.isFinite(value) ? value : fallback) as SettingValue<K>;
    }
    return (raw === undefined || raw === null ? fallback : String(raw)) as SettingValue<K>;
  }

  async all(): Promise<Record<string, unknown>> {
    return { ...(await this.load()) };
  }

  async set(key: string, value: unknown, updatedBy?: number): Promise<void> {
    await upsertRow(this.sb, "bot_settings", {
      key,
      value,
      updated_by: updatedBy ?? null,
      updated_at: new Date().toISOString(),
    }, "key");
    if (this.cache) this.cache[key] = value;
    else await this.load(true);
  }

  /** تنظیمات امنیتی/محرمانه هرگز از طریق UI نمایش داده نمی‌شوند. */
  static readonly EDITABLE_KEYS: SettingKey[] = [
    "maintenance_mode",
    "maintenance_text",
    "welcome_text",
    "channel_target",
    "channel_url",
    "group_url",
    "support_username",
    "ai_enabled",
    "ai_persona",
    "ai_model",
    "ai_daily_limit",
    "ai_memory_messages",
    "ai_memory_enabled",
    "ai_fallback_cooldown_seconds",
    "ai_group_daily_limit",
    "ai_group_cooldown_seconds",
    "ai_anime_context",
    "group_warning_text",
    "feature_ai",
    "feature_anime",
    "feature_news",
    "feature_ads",
    "feature_broadcast",
    "feature_content",
    "feature_groups",
    "feature_scheduling",
    "broadcast_batch_size",
    "broadcast_delay_ms",
    "broadcast_max_fail_streak",
    "broadcast_require_confirm",
    "ads_label",
    "ads_default_target",
    "ads_min_interval_minutes",
    "session_ttl_minutes",
    "user_rate_limit_per_minute",
    "admin_rate_limit_per_minute",
    "data_retention_days",
    "weekly_report_enabled",
    "weekly_report_day",
    "weekly_report_hour",
    "daily_stats_enabled",
    "timezone",
  ];
}
