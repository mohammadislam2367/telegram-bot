#!/usr/bin/env node
// =============================================================================
// Anime Click Ultimate — database verification (no Supabase account needed)
//
// اجرا:
//   npm install --no-save --no-package-lock @electric-sql/pglite
//   node scripts/verify-database.mjs
//
// این اسکریپت schema.sql + policies.sql + seed.sql را روی یک PostgreSQL واقعی
// (PGlite/WASM) اجرا می‌کند و ساختار، RLS، constraint ها و توابع RPC را می‌سنجد.
// فایل cron.sql اینجا اجرا نمی‌شود (به pg_cron/pg_net/Vault نیاز دارد).
// =============================================================================
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const root = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

let passed = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const db = new PGlite();
await db.waitReady;

// Supabase roles exist in production; create them for parity.
await db.exec(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  end $$;
`);

// gen_random_uuid() is built into PostgreSQL 13+; PGlite has no pgcrypto module.
const schema = read("supabase/database/schema.sql").replace(
  "create extension if not exists pgcrypto;",
  "-- pgcrypto not installed in PGlite harness (gen_random_uuid is builtin)",
);

try {
  await db.exec(schema);
  console.log("schema.sql applied");
  await db.exec(read("supabase/database/policies.sql"));
  console.log("policies.sql applied");
  await db.exec(read("supabase/database/seed.sql"));
  console.log("seed.sql applied\n");
} catch (err) {
  console.error("FATAL: SQL failed to apply:\n", err.message ?? err);
  process.exit(1);
}

console.log("── structure");
const requiredTables = [
  "users", "user_daily_activity", "admins", "banned_users", "groups", "group_settings", "group_bans",
  "user_warnings", "moderation_logs", "advertisements", "scheduled_posts",
  "broadcast_campaigns", "broadcast_logs", "ai_conversations", "ai_usage",
  "ai_state", "anime_cache", "bot_settings", "bot_sessions", "admin_actions",
  "system_logs", "bot_stats_daily", "content_posts", "content_categories",
];
const tables = await db.query(`
  select tablename from pg_tables where schemaname = 'public' order by tablename
`);
const tableNames = tables.rows.map((r) => r.tablename);
for (const t of requiredTables) check(`table ${t} exists`, tableNames.includes(t));

const noRls = await db.query(`
  select c.relname from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
`);
check("RLS enabled on every public table", noRls.rows.length === 0,
  noRls.rows.map((r) => r.relname).join(", "));

const settingCount = await db.query("select count(*)::int as n from public.bot_settings");
check("bot_settings seeded", settingCount.rows[0].n >= 30, `n=${settingCount.rows[0].n}`);

const catCount = await db.query("select count(*)::int as n from public.content_categories");
check("content categories seeded", catCount.rows[0].n === 4, `n=${catCount.rows[0].n}`);

const policies = await db.query(`
  select policyname from pg_policies where schemaname = 'public'
`);
check("content read policy installed",
  policies.rows.some((p) => p.policyname === "content_posts_read_published"));

const grants = await db.query(`
  select table_name, privilege_type from information_schema.role_table_grants
  where grantee = 'authenticated' and table_schema = 'public'
`);
check("authenticated has only select grants", grants.rows.every((g) => g.privilege_type === "SELECT"));
check("authenticated cannot read users",
  !grants.rows.some((g) => g.table_name === "users"));

console.log("\n── users & helper functions");
await db.query(
  `select public.touch_user(1001, 'alice', 'Alice', 'A', 'fa', false, false, true)`,
);
await db.query(
  `select public.touch_user(1001, null, null, null, null, false, false, true)`,
);
let u = await db.query("select * from public.users where telegram_id = 1001");
check("touch_user inserts and increments message_count", u.rows[0].message_count === 2,
  `count=${u.rows[0].message_count}`);
check("touch_user keeps existing username when new value is null",
  u.rows[0].username === "alice");

const settingsTouch = await db.query(
  `select * from public.touch_user(1002, 'bob', 'Bob', null, 'en', false, false, false)`,
);
check("touch_user returns a users row", settingsTouch.rows[0].telegram_id === 1002);

// پیام + فعالیت روزانه در همان RPC
await db.query(
  `select * from public.touch_user(3001, 'carol', 'Carol', null, 'fa', false, false, true, current_date)`,
);
await db.query(
  `select * from public.touch_user(3001, 'carol', 'Carol', null, 'fa', false, false, true, current_date)`,
);
const activity = await db.query(
  `select count(*)::int as n from public.user_daily_activity where telegram_id = 3001 and day = current_date`,
);
check("touch_user records daily activity once", activity.rows[0].n === 1);
const msgStat = await db.query(
  `select messages from public.bot_stats_daily where day = current_date`,
);
check("touch_user increments daily messages", msgStat.rows[0].messages >= 2, `messages=${msgStat.rows[0].messages}`);

await db.query(`insert into public.admins (user_id, role, permissions) values (1001, 'owner', '{}')`);
await db.query(`insert into public.admins (user_id, role, permissions) values (1002, 'moderator', '{broadcast.read}')`);
const roleCheck = await db.query(`select count(*)::int as n from public.admins`);
check("admins rows stored", roleCheck.rows[0].n === 2);

let constraintOk = false;
try {
  await db.query(`insert into public.admins (user_id, role) values (1001, 'god')`);
} catch {
  constraintOk = true;
}
check("invalid admin role rejected", constraintOk);

console.log("\n── bans");
await db.query(`insert into public.banned_users (user_id, banned_by, reason) values (1002, 1001, 'spam')`);
let banDup = false;
try {
  await db.query(`insert into public.banned_users (user_id, banned_by) values (1002, 1001)`);
} catch {
  banDup = true;
}
check("duplicate active ban rejected", banDup);
await db.query(`update public.banned_users set is_active = false where user_id = 1002`);
await db.query(`insert into public.banned_users (user_id, banned_by) values (1002, 1001)`);
check("ban after lift allowed", true);

// فقط 1001 مسدود می‌ماند تا صف ارسال یک گیرنده‌ی مجاز داشته باشد
await db.query(`update public.banned_users set is_active = false where user_id = 1002`);
await db.query(`insert into public.banned_users (user_id, banned_by) values (1001, 1002)`);

console.log("\n── broadcast queue");
const camp = await db.query(`
  insert into public.broadcast_campaigns (title, text, audience, created_by)
  values ('test', 'hello', 'opt_in', 1001) returning id
`);
const campaignId = camp.rows[0].id;
const enq = await db.query(`select public.enqueue_broadcast('${campaignId}') as n`);
check("enqueue skips banned users", enq.rows[0].n === 2, `n=${enq.rows[0].n}`);
const enqAgain = await db.query(`select public.enqueue_broadcast('${campaignId}') as n`);
check("enqueue is idempotent", enqAgain.rows[0].n === 0, `n=${enqAgain.rows[0].n}`);
const campRow = await db.query(`select * from public.broadcast_campaigns where id = '${campaignId}'`);
check("campaign total_recipients updated", campRow.rows[0].total_recipients === 2);
check("campaign queued", campRow.rows[0].status === "queued");

const claimed = await db.query(`select * from public.claim_broadcast_batch('${campaignId}', 10)`);
check("claim_broadcast_batch claims pending rows", claimed.rows.length === 2 && claimed.rows.some((r) => r.user_id === 1002));
const claimStatus = await db.query(`select status, attempts from public.broadcast_logs where campaign_id = '${campaignId}' order by id limit 1`);
check("claimed row marked sending", claimStatus.rows[0].status === "sending" && claimStatus.rows[0].attempts === 1);
const claimedAgain = await db.query(`select * from public.claim_broadcast_batch('${campaignId}', 10)`);
check("claimed row is not handed out twice", claimedAgain.rows.length === 0);
await db.query(`update public.broadcast_logs set locked_at = now() - interval '30 minutes' where campaign_id = '${campaignId}'`);
const resetStale = await db.query(`select public.reset_stale_broadcast_claims('${campaignId}', 10) as n`);
check("stale claims are recoverable", resetStale.rows[0].n === 2, `n=${resetStale.rows[0].n}`);

const messagesBefore = (await db.query(
  `select messages from public.bot_stats_daily where day = current_date`,
)).rows[0].messages;
await db.query(`select public.bump_daily_stat(current_date, 'messages', 5)`);
await db.query(`select public.bump_daily_stat(current_date, 'messages', 2)`);
const stat = await db.query(`select messages from public.bot_stats_daily where day = current_date`);
check("bump_daily_stat accumulates", stat.rows[0].messages === messagesBefore + 7,
  `messages=${stat.rows[0].messages} before=${messagesBefore}`);
let badStat = false;
try {
  await db.query(`select public.bump_daily_stat(current_date, 'active_users')`);
} catch {
  badStat = true;
}
check("bump_daily_stat rejects unknown field", badStat);

let singleRunning = false;
await db.query(`select set_config('test.skip', '1', true)`);
try {
  await db.query(`update public.broadcast_campaigns set status = 'running' where id = '${campaignId}'`);
  const camp2 = await db.query(`
    insert into public.broadcast_campaigns (title, text, status)
    values ('test2', 'hello2', 'running') returning id
  `);
  void camp2;
} catch {
  singleRunning = true;
}
check("only one running campaign allowed", singleRunning);

console.log("\n── ai");
for (let i = 0; i < 20; i++) {
  await db.query(
    `insert into public.ai_conversations (user_id, role, content) values (1001, 'user', 'msg ${i}')`,
  );
}
const trimmed = await db.query(`select public.trim_conversation(1001, 12) as n`);
const remaining = await db.query(
  `select count(*)::int as n from public.ai_conversations where user_id = 1001`,
);
check("trim_conversation keeps requested window",
  remaining.rows[0].n === 12 && trimmed.rows[0].n === 8,
  `remaining=${remaining.rows[0].n} deleted=${trimmed.rows[0].n}`);

await db.query(`insert into public.ai_usage (user_id, status, request_type) values (1001, 'fallback', 'chat')`);
const usage = await db.query(`select count(*)::int as n from public.ai_usage`);
check("ai_usage records fallback", usage.rows[0].n === 1);

const aiState = await db.query(`update public.ai_state set status = 'quota_exhausted' returning status`);
check("ai_state singleton updatable", aiState.rows[0].status === "quota_exhausted");

console.log("\n── content");
let scheduledGuard = false;
try {
  await db.query(`insert into public.content_posts (title, body, status) values ('x', 'y', 'scheduled')`);
} catch {
  scheduledGuard = true;
}
check("scheduled content requires scheduled_at", scheduledGuard);

const post = await db.query(`
  insert into public.content_posts (title, body, type, status, published_at)
  values ('انیمه جدید', 'جزئیات انیمه', 'news', 'published', now()) returning id
`);
const search = await db.query(`
  select id from public.content_posts where search_vector @@ plainto_tsquery('simple', 'انیمه')
`);
check("generated search_vector works", search.rows.some((r) => r.id === post.rows[0].id));

let adGuard = false;
try {
  await db.query(`insert into public.advertisements (title, body, media_type) values ('a', 'b', 'photo')`);
} catch {
  adGuard = true;
}
check("ad with media requires file_id", adGuard);

console.log("\n── atomic claims");
const dueAd = await db.query(`
  insert into public.advertisements (title, body, status, scheduled_at)
  values ('due ad', 'body', 'active', now() - interval '1 minute') returning id
`);
const adClaim1 = await db.query(`select * from public.claim_due_advertisements(5)`);
const adClaim2 = await db.query(`select * from public.claim_due_advertisements(5)`);
check("ad claim is atomic", adClaim1.rows.length === 1 && adClaim2.rows.length === 0,
  `first=${adClaim1.rows.length} second=${adClaim2.rows.length}`);

const duePost = await db.query(`
  insert into public.scheduled_posts (body, scheduled_at)
  values ('due post', now() - interval '1 minute') returning id
`);
const postClaim1 = await db.query(`select * from public.claim_due_scheduled_posts(5)`);
const postClaim2 = await db.query(`select * from public.claim_due_scheduled_posts(5)`);
check("scheduled post claim is atomic", postClaim1.rows.length === 1 && postClaim2.rows.length === 0,
  `first=${postClaim1.rows.length} second=${postClaim2.rows.length}`);

const dueContent = await db.query(`
  insert into public.content_posts (title, body, status, scheduled_at)
  values ('due content', 'body', 'scheduled', now() - interval '1 minute') returning id
`);
const contentClaim1 = await db.query(`select * from public.claim_due_content_posts(5)`);
const contentClaim2 = await db.query(`select * from public.claim_due_content_posts(5)`);
check("content claim is atomic", contentClaim1.rows.length === 1 && contentClaim2.rows.length === 0,
  `first=${contentClaim1.rows.length} second=${contentClaim2.rows.length}`);

await db.query(`delete from public.advertisements where id = '${dueAd.rows[0].id}'`);
await db.query(`delete from public.scheduled_posts where id = '${duePost.rows[0].id}'`);
await db.query(`delete from public.content_posts where id = '${dueContent.rows[0].id}'`);

console.log("\n── group settings & moderation");
await db.query(`
  insert into public.groups (telegram_chat_id, title, type, bot_is_admin)
  values (-100123456789, 'Test Group', 'supergroup', true)
`);
await db.query(`insert into public.group_settings (group_id) values (-100123456789)`);
const gs = await db.query(`select * from public.group_settings where group_id = -100123456789`);
check("group_settings defaults applied", gs.rows[0].warn_limit === 3 && gs.rows[0].antilink_enabled === true);

await db.query(`
  insert into public.user_warnings (group_id, user_id, warned_by, reason)
  values (-100123456789, 1001, 1002, 'test')
`);
const warnCount = await db.query(`
  select count(*)::int as n from public.user_warnings
  where group_id = -100123456789 and user_id = 1001 and is_active
`);
check("warning recorded", warnCount.rows[0].n === 1);

let warnLimit = false;
try {
  await db.query(`
    insert into public.user_warnings (group_id, user_id, warned_by) values
      (-100123456789, 1002, 1002), (-100123456789, 1002, 1002)
  `);
  await db.query(`update public.group_settings set warn_limit = 0 where group_id = -100123456789`);
} catch {
  warnLimit = true;
}
check("warn_limit constraint enforced", warnLimit);

console.log("\n── sessions & retention");
await db.query(`
  insert into public.bot_sessions (telegram_id, chat_id, state, expires_at)
  values (1001, 1001, 'ad_create', now() - interval '1 minute')
`);
const pruned = await db.query(`select public.prune_old_data(90) as result`);
check("prune_old_data removes expired sessions", pruned.rows[0].result.bot_sessions === 1,
  JSON.stringify(pruned.rows[0].result));

console.log("\n── user deletion");
await db.query(`
  insert into public.ai_usage (user_id, status) values (1001, 'success')
`);
const purged = await db.query(`select public.purge_user(1001) as ok`);
const afterPurge = await db.query(`select count(*)::int as n from public.users where telegram_id = 1001`);
const aiAfter = await db.query(`select count(*)::int as n from public.ai_conversations where user_id = 1001`);
check("purge_user deletes user", purged.rows[0].ok === true && afterPurge.rows[0].n === 0);
check("purge_user cascades conversations", aiAfter.rows[0].n === 0);
const usageAfter = await db.query(`select user_id from public.ai_usage where id = 2`);
check("ai_usage is anonymised on user delete", usageAfter.rows[0].user_id === null);

console.log(`\n${failures.length === 0 ? "✓ ALL CHECKS PASSED" : "✗ FAILURES"}: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.error(" - " + f);
  process.exit(1);
}
await db.close();
