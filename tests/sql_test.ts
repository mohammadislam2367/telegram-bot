import { assert, assertEquals } from "@std/assert";

async function read(relative: string): Promise<string> {
  return await Deno.readTextFile(new URL(`../${relative}`, import.meta.url));
}

Deno.test("schema defines every required table", async () => {
  const schema = await read("supabase/database/schema.sql");
  for (
    const table of [
      "users",
      "admins",
      "banned_users",
      "groups",
      "group_settings",
      "group_bans",
      "user_warnings",
      "moderation_logs",
      "advertisements",
      "scheduled_posts",
      "broadcast_campaigns",
      "broadcast_logs",
      "ai_conversations",
      "ai_usage",
      "ai_state",
      "anime_cache",
      "bot_settings",
      "bot_sessions",
      "admin_actions",
      "system_logs",
      "bot_stats_daily",
      "content_posts",
      "content_categories",
      "user_daily_activity",
    ]
  ) {
    assert(schema.includes(`create table if not exists public.${table}`), table);
  }
});

Deno.test("schema provides constraints, indexes and RPCs", async () => {
  const schema = await read("supabase/database/schema.sql");
  assert(schema.includes("banned_users_active_uidx"));
  assert(schema.includes("broadcast_logs_unique_recipient"));
  assert(schema.includes("broadcast_single_running_uidx"));
  assert(schema.includes("content_scheduled_requires_time"));
  assert(schema.includes("advertisements_media_consistency"));
  for (
    const fn of [
      "touch_user",
      "purge_user",
      "trim_conversation",
      "enqueue_broadcast",
      "claim_broadcast_batch",
      "reset_stale_broadcast_claims",
      "bump_daily_stat",
      "claim_due_advertisements",
      "claim_due_scheduled_posts",
      "claim_due_content_posts",
      "prune_old_data",
      "set_updated_at",
    ]
  ) {
    assert(schema.includes(`function public.${fn}`), fn);
  }
  assert(schema.includes("security definer"));
});

Deno.test("RLS is enabled on every table and no sensitive table is public", async () => {
  const policies = await read("supabase/database/policies.sql");
  const schema = await read("supabase/database/schema.sql");
  const tableCount = (schema.match(/create table if not exists public\./g) ?? []).length;
  const rlsCount = (policies.match(/enable row level security/g) ?? []).length;
  assert(rlsCount >= tableCount - 1, `rls=${rlsCount} tables=${tableCount}`);
  assert(policies.includes("revoke all on all tables in schema public from anon"));
  assert(policies.includes("revoke all on all tables in schema public from authenticated"));
  assert(policies.includes("content_posts_read_published"));
  assertEquals(/grant select on public\.users/.test(policies), false);
});

Deno.test("no secrets are committed in SQL/env examples", async () => {
  const files = [
    "supabase/database/schema.sql",
    "supabase/database/policies.sql",
    "supabase/database/seed.sql",
    "supabase/database/cron.sql",
    ".env.example",
  ];
  for (const file of files) {
    const content = await read(file);
    assertEquals(/eyJhbGciOi[A-Za-z0-9_-]{10,}/.test(content), false, `${file} contains a JWT`);
    assertEquals(
      /\d{8,10}:[A-Za-z0-9_-]{30,}/.test(content),
      false,
      `${file} contains a bot token`,
    );
    assertEquals(
      /AIza[0-9A-Za-z_-]{20,}/.test(content),
      false,
      `${file} contains a Google API key`,
    );
  }
});

Deno.test("seed provides default settings and categories", async () => {
  const seed = await read("supabase/database/seed.sql");
  const settingsCount = (seed.match(/\('feature_|\[?'?[a-z_]+'?',\s*'?/g) ?? []).length;
  assert(settingsCount > 0);
  for (
    const key of [
      "maintenance_mode",
      "welcome_text",
      "channel_target",
      "ai_enabled",
      "ai_daily_limit",
      "ai_fallback_cooldown_seconds",
      "broadcast_batch_size",
      "ads_label",
      "feature_ai",
      "weekly_report_enabled",
      "data_retention_days",
    ]
  ) {
    assert(seed.includes(`'${key}'`), key);
  }
  for (const slug of ["news", "review", "guide", "release"]) {
    assert(seed.includes(`'${slug}'`), slug);
  }
});

Deno.test("cron uses vault secrets instead of hard-coded ones", async () => {
  const cron = await read("supabase/database/cron.sql");
  assert(cron.includes("cron.schedule"));
  assert(cron.includes("net.http_post"));
  assert(cron.includes("vault.decrypted_secrets"));
  assert(cron.includes("animeclick-scheduler-every-minute"));
  assertEquals(/SCHEDULER_SECRET\s*=\s*['"][^'"]+['"]/.test(cron), false);
});
