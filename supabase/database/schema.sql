-- =============================================================================
-- Anime Click Ultimate — Database Schema
-- PostgreSQL 15+ (Supabase)
-- Apply order: schema.sql → policies.sql → seed.sql → cron.sql
-- Idempotent: safe to re-run.
-- =============================================================================
begin;

create extension if not exists pgcrypto;

-- ─── shared trigger: updated_at ──────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =============================================================================
-- users — یکی برای هر کاربر تلگرام که با ربات/گروه تعامل داشته است
-- حداقل داده‌ی لازم ذخیره می‌شود: محتوای پیام‌ها ذخیره نمی‌شود.
-- =============================================================================
create table if not exists public.users (
  telegram_id          bigint primary key,
  username             text,
  first_name           text,
  last_name            text,
  language_code        text,
  is_premium           boolean not null default false,
  is_bot               boolean not null default false,
  ai_memory_enabled    boolean not null default true,
  broadcast_opt_in     boolean not null default true,
  broadcast_opt_in_at  timestamptz,
  notes                text,
  first_seen_at        timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  message_count        integer not null default 0,
  ai_request_count     integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint users_id_positive check (telegram_id > 0),
  constraint users_message_count_non_negative check (message_count >= 0),
  constraint users_ai_count_non_negative check (ai_request_count >= 0)
);

create index if not exists users_last_seen_idx on public.users (last_seen_at desc);
create index if not exists users_created_idx on public.users (created_at desc);
create index if not exists users_username_lower_idx on public.users (lower(username));
create index if not exists users_opt_in_idx on public.users (broadcast_opt_in) where broadcast_opt_in;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at before update on public.users
for each row execute function public.set_updated_at();

-- فعالیت روزانه‌ی کاربران (برای آمار واقعی active_users هر روز)
create table if not exists public.user_daily_activity (
  telegram_id bigint not null references public.users(telegram_id) on delete cascade,
  day         date not null,
  created_at  timestamptz not null default now(),
  primary key (telegram_id, day)
);

create index if not exists user_daily_activity_day_idx on public.user_daily_activity (day);

-- =============================================================================
-- admins — سطوح دسترسی داخل ربات (مستقل از ادمین‌بودن در گروه تلگرام)
-- =============================================================================

-- =============================================================================
-- admins — سطوح دسترسی داخل ربات (مستقل از ادمین‌بودن در گروه تلگرام)
-- =============================================================================
create table if not exists public.admins (
  user_id     bigint primary key references public.users(telegram_id) on delete cascade,
  role        text not null default 'admin'
              check (role in ('owner', 'super_admin', 'admin', 'moderator')),
  permissions text[] not null default '{}',
  is_active   boolean not null default true,
  added_by    bigint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists admins_role_idx on public.admins (role) where is_active;

drop trigger if exists admins_set_updated_at on public.admins;
create trigger admins_set_updated_at before update on public.admins
for each row execute function public.set_updated_at();

-- =============================================================================
-- banned_users — مسدودسازی در سطح «ربات» (نه گروه)
-- =============================================================================
create table if not exists public.banned_users (
  id          uuid primary key default gen_random_uuid(),
  user_id     bigint not null references public.users(telegram_id) on delete cascade,
  banned_by   bigint not null,
  reason      text,
  is_active   boolean not null default true,
  expires_at  timestamptz,
  lifted_at   timestamptz,
  lifted_by   bigint,
  created_at  timestamptz not null default now()
);

create unique index if not exists banned_users_active_uidx
  on public.banned_users (user_id) where is_active;
create index if not exists banned_users_created_idx on public.banned_users (created_at desc);

-- =============================================================================
-- groups — گروه‌ها/کانال‌هایی که ربات در آن‌هاست
-- =============================================================================
create table if not exists public.groups (
  telegram_chat_id bigint primary key,
  title            text,
  username         text,
  type             text not null default 'group'
                   check (type in ('group', 'supergroup', 'channel')),
  is_active        boolean not null default true,
  bot_is_admin     boolean not null default false,
  member_count     integer,
  added_by         bigint,
  joined_at        timestamptz not null default now(),
  left_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists groups_active_idx on public.groups (is_active);
create index if not exists groups_username_idx on public.groups (lower(username));

drop trigger if exists groups_set_updated_at on public.groups;
create trigger groups_set_updated_at before update on public.groups
for each row execute function public.set_updated_at();

-- تنظیمات مستقل هر گروه
create table if not exists public.group_settings (
  group_id              bigint primary key references public.groups(telegram_chat_id) on delete cascade,
  welcome_enabled       boolean not null default true,
  welcome_text          text not null default '👋 {name} عزیز به {group} خوش آمدی!',
  goodbye_enabled       boolean not null default false,
  goodbye_text          text not null default '👋 {name} از {group} خارج شد.',
  rules_text            text not null default '۱. احترام به همه اعضا الزامی است.\n۲. تبلیغ و لینک ناخواسته ممنوع است.\n۳. اسپم و ارسال پیام تکراری ممنوع است.',
  antilink_enabled      boolean not null default true,
  antispam_enabled      boolean not null default true,
  block_forwards        boolean not null default false,
  delete_warn_messages  boolean not null default true,
  verify_enabled        boolean not null default false,
  strict_mode           boolean not null default false,
  locks                 jsonb not null default '{}'::jsonb,
  flood_limit           integer not null default 6 check (flood_limit between 2 and 60),
  flood_window_seconds  integer not null default 20 check (flood_window_seconds between 5 and 600),
  warn_limit            integer not null default 3 check (warn_limit between 1 and 10),
  warn_action           text not null default 'mute' check (warn_action in ('mute', 'kick', 'ban')),
  mute_duration_minutes integer not null default 60 check (mute_duration_minutes between 1 and 525600),
  log_channel_id        bigint,
  language              text not null default 'fa' check (language in ('fa', 'en')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- برای دیتابیس‌های موجود (جدول از قبل ساخته شده) — این ستون‌ها بعداً اضافه شدند
alter table public.group_settings add column if not exists verify_enabled boolean not null default false;
alter table public.group_settings add column if not exists strict_mode boolean not null default false;
alter table public.group_settings add column if not exists locks jsonb not null default '{}'::jsonb;

drop trigger if exists group_settings_set_updated_at on public.group_settings;
create trigger group_settings_set_updated_at before update on public.group_settings
for each row execute function public.set_updated_at();

-- =============================================================================
-- group_bans — وضعیت فعلی Ban/Mute در هر گروه (مستقل از مسدودسازی ربات)
-- =============================================================================
create table if not exists public.group_bans (
  id          bigserial primary key,
  group_id    bigint not null references public.groups(telegram_chat_id) on delete cascade,
  user_id     bigint not null references public.users(telegram_id) on delete cascade,
  kind        text not null default 'ban' check (kind in ('ban', 'mute')),
  reason      text,
  is_active   boolean not null default true,
  expires_at  timestamptz,
  created_by  bigint not null,
  created_at  timestamptz not null default now(),
  lifted_at   timestamptz,
  lifted_by   bigint
);

create unique index if not exists group_bans_active_uidx
  on public.group_bans (group_id, user_id, kind) where is_active;
create index if not exists group_bans_group_idx on public.group_bans (group_id, created_at desc);

-- =============================================================================
-- user_warnings — اخطارهای چندمرحله‌ای هر گروه
-- =============================================================================
create table if not exists public.user_warnings (
  id          bigserial primary key,
  group_id    bigint not null references public.groups(telegram_chat_id) on delete cascade,
  user_id     bigint not null references public.users(telegram_id) on delete cascade,
  warned_by   bigint not null,
  reason      text,
  is_active   boolean not null default true,
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  bigint
);

create index if not exists user_warnings_active_idx
  on public.user_warnings (group_id, user_id, created_at desc) where is_active;
create index if not exists user_warnings_user_idx on public.user_warnings (user_id, created_at desc);

-- =============================================================================
-- moderation_logs — گزارش کامل اقدامات مدیریتی گروه
-- =============================================================================
create table if not exists public.moderation_logs (
  id            bigserial primary key,
  group_id      bigint not null references public.groups(telegram_chat_id) on delete cascade,
  target_user_id bigint,
  actor_id      bigint not null,
  action        text not null check (action in (
                  'ban', 'unban', 'kick', 'mute', 'unmute', 'warn', 'unwarn',
                  'delete_message', 'purge', 'settings_update', 'report', 'auto_action'
                )),
  reason        text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists moderation_logs_group_idx
  on public.moderation_logs (group_id, created_at desc);
create index if not exists moderation_logs_target_idx
  on public.moderation_logs (target_user_id, created_at desc);

-- =============================================================================
-- advertisements
-- =============================================================================
create table if not exists public.advertisements (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (char_length(title) between 2 and 120),
  body            text not null check (char_length(body) between 2 and 4000),
  media_type      text not null default 'none'
                  check (media_type in ('none', 'photo', 'video', 'animation', 'document')),
  media_file_id   text,
  buttons         jsonb not null default '[]'::jsonb,
  target_chat     text,
  status          text not null default 'draft'
                  check (status in ('draft', 'active', 'paused', 'archived')),
  scheduled_at    timestamptz,
  repeat_interval text not null default 'none'
                  check (repeat_interval in ('none', 'daily', 'weekly', 'monthly')),
  label_enabled   boolean not null default true,
  sent_count      integer not null default 0 check (sent_count >= 0),
  error_count     integer not null default 0 check (error_count >= 0),
  last_sent_at    timestamptz,
  last_error      text,
  claimed_at      timestamptz,
  created_by      bigint,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint advertisements_media_consistency
    check (media_type = 'none' or media_file_id is not null)
);

alter table public.advertisements add column if not exists claimed_at timestamptz;

create index if not exists advertisements_status_idx on public.advertisements (status);
create index if not exists advertisements_due_idx
  on public.advertisements (scheduled_at) where status = 'active';

drop trigger if exists advertisements_set_updated_at on public.advertisements;
create trigger advertisements_set_updated_at before update on public.advertisements
for each row execute function public.set_updated_at();

-- =============================================================================
-- scheduled_posts — پست‌های زمان‌بندی‌شده (مستقل از محتوای سایت/دسته‌بندی)
-- =============================================================================
create table if not exists public.scheduled_posts (
  id              uuid primary key default gen_random_uuid(),
  title           text,
  body            text not null check (char_length(body) between 1 and 4000),
  media_type      text not null default 'none'
                  check (media_type in ('none', 'photo', 'video', 'animation', 'document')),
  media_file_id   text,
  buttons         jsonb not null default '[]'::jsonb,
  target_chat     text,
  scheduled_at    timestamptz not null,
  status          text not null default 'pending'
                  check (status in ('pending', 'sent', 'failed', 'cancelled')),
  repeat_interval text not null default 'none'
                  check (repeat_interval in ('none', 'daily', 'weekly', 'monthly')),
  attempts        integer not null default 0 check (attempts >= 0),
  last_error      text,
  claimed_at      timestamptz,
  sent_message_id bigint,
  sent_at         timestamptz,
  created_by      bigint,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.scheduled_posts add column if not exists claimed_at timestamptz;

create index if not exists scheduled_posts_due_idx
  on public.scheduled_posts (scheduled_at) where status = 'pending';

drop trigger if exists scheduled_posts_set_updated_at on public.scheduled_posts;
create trigger scheduled_posts_set_updated_at before update on public.scheduled_posts
for each row execute function public.set_updated_at();

-- =============================================================================
-- content — دسته‌بندی، خبرها و پست‌ها
-- =============================================================================
create table if not exists public.content_categories (
  id         serial primary key,
  slug       text not null unique check (slug ~ '^[a-z0-9_-]{2,40}$'),
  title      text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.content_posts (
  id                  uuid primary key default gen_random_uuid(),
  category_id         integer references public.content_categories(id) on delete set null,
  type                text not null default 'post' check (type in ('news', 'post', 'guide')),
  title               text not null check (char_length(title) between 2 and 200),
  body                text not null check (char_length(body) between 2 and 8000),
  media_type          text not null default 'none'
                      check (media_type in ('none', 'photo', 'video', 'animation', 'document')),
  media_file_id       text,
  buttons             jsonb not null default '[]'::jsonb,
  status              text not null default 'draft'
                      check (status in ('draft', 'scheduled', 'published', 'archived')),
  scheduled_at        timestamptz,
  target_chat         text,
  telegram_message_id bigint,
  views               integer not null default 0 check (views >= 0),
  is_pinned           boolean not null default false,
  publish_attempts    integer not null default 0 check (publish_attempts >= 0),
  last_error          text,
  claimed_at          timestamptz,
  published_at        timestamptz,
  created_by          bigint,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  search_vector       tsvector generated always as (
                        to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, ''))
                      ) stored,
  constraint content_scheduled_requires_time
    check (status <> 'scheduled' or scheduled_at is not null)
);

alter table public.content_posts add column if not exists claimed_at timestamptz;
alter table public.content_posts add column if not exists publish_attempts integer not null default 0;
alter table public.content_posts add column if not exists last_error text;

create index if not exists content_posts_status_idx on public.content_posts (status, published_at desc);
create index if not exists content_posts_type_idx on public.content_posts (type, created_at desc);
create index if not exists content_posts_category_idx on public.content_posts (category_id);

-- =============================================================================
-- claimهای اتمی زمان‌بند — جلوگیری از انتشار تکراری در اجراهای هم‌زمان
-- =============================================================================
create or replace function public.claim_due_advertisements(p_limit integer default 3)
returns setof public.advertisements
language sql
security definer
set search_path = public
as $$
  update public.advertisements a
  set claimed_at = now(), updated_at = now()
  where a.id in (
    select id from public.advertisements
    where status = 'active'
      and scheduled_at is not null
      and scheduled_at <= now()
      and (claimed_at is null or claimed_at < now() - interval '10 minutes')
    order by scheduled_at
    limit greatest(coalesce(p_limit, 3), 1)
    for update skip locked
  )
  returning a.*;
$$;

create or replace function public.claim_due_scheduled_posts(p_limit integer default 5)
returns setof public.scheduled_posts
language sql
security definer
set search_path = public
as $$
  update public.scheduled_posts p
  set claimed_at = now(), updated_at = now()
  where p.id in (
    select id from public.scheduled_posts
    where status = 'pending'
      and scheduled_at <= now()
      and (claimed_at is null or claimed_at < now() - interval '10 minutes')
    order by scheduled_at
    limit greatest(coalesce(p_limit, 5), 1)
    for update skip locked
  )
  returning p.*;
$$;

create or replace function public.claim_due_content_posts(p_limit integer default 5)
returns setof public.content_posts
language sql
security definer
set search_path = public
as $$
  update public.content_posts c
  set claimed_at = now(), updated_at = now()
  where c.id in (
    select id from public.content_posts
    where status = 'scheduled'
      and scheduled_at is not null
      and scheduled_at <= now()
      and (claimed_at is null or claimed_at < now() - interval '10 minutes')
    order by scheduled_at
    limit greatest(coalesce(p_limit, 5), 1)
    for update skip locked
  )
  returning c.*;
$$;
create index if not exists content_posts_search_idx on public.content_posts using gin (search_vector);
create index if not exists content_posts_due_idx
  on public.content_posts (scheduled_at) where status = 'scheduled';

drop trigger if exists content_posts_set_updated_at on public.content_posts;
create trigger content_posts_set_updated_at before update on public.content_posts
for each row execute function public.set_updated_at();

-- =============================================================================
-- broadcast — کمپین و صف ارسال
-- =============================================================================
create table if not exists public.broadcast_campaigns (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(title) between 2 and 120),
  message_type     text not null default 'text'
                   check (message_type in ('text', 'photo', 'video', 'animation', 'document')),
  text             text not null check (char_length(text) between 1 and 4000),
  media_file_id    text,
  buttons          jsonb not null default '[]'::jsonb,
  audience         text not null default 'opt_in'
                   check (audience in ('opt_in', 'active', 'all')),
  status           text not null default 'draft'
                   check (status in ('draft', 'queued', 'running', 'paused', 'completed', 'cancelled', 'failed')),
  total_recipients integer not null default 0 check (total_recipients >= 0),
  sent_count       integer not null default 0 check (sent_count >= 0),
  failed_count     integer not null default 0 check (failed_count >= 0),
  skipped_count    integer not null default 0 check (skipped_count >= 0),
  last_error       text,
  created_by       bigint,
  approved_by      bigint,
  started_at       timestamptz,
  finished_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint broadcast_media_consistency
    check (message_type = 'text' or media_file_id is not null)
);

create index if not exists broadcast_campaigns_status_idx
  on public.broadcast_campaigns (status, created_at desc);
-- فقط یک کمپین در حال اجرا در کل سیستم تا محدودیت Telegram API رعایت شود
create unique index if not exists broadcast_single_running_uidx
  on public.broadcast_campaigns ((true)) where status = 'running';

drop trigger if exists broadcast_campaigns_set_updated_at on public.broadcast_campaigns;
create trigger broadcast_campaigns_set_updated_at before update on public.broadcast_campaigns
for each row execute function public.set_updated_at();

create table if not exists public.broadcast_logs (
  id          bigserial primary key,
  campaign_id uuid not null references public.broadcast_campaigns(id) on delete cascade,
  user_id     bigint not null references public.users(telegram_id) on delete cascade,
  status      text not null default 'pending'
              check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  error       text,
  attempts    integer not null default 0 check (attempts >= 0),
  locked_at   timestamptz,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);

create unique index if not exists broadcast_logs_unique_recipient
  on public.broadcast_logs (campaign_id, user_id);
create index if not exists broadcast_logs_pending_idx
  on public.broadcast_logs (campaign_id, status, id);

-- =============================================================================
-- ai_conversations / ai_usage / ai_state / anime_cache
-- =============================================================================
create table if not exists public.ai_conversations (
  id         bigserial primary key,
  user_id    bigint not null references public.users(telegram_id) on delete cascade,
  role       text not null check (role in ('user', 'assistant', 'system')),
  content    text not null check (char_length(content) between 1 and 8000),
  model      text,
  source     text not null default 'gemini' check (source in ('gemini', 'fallback', 'cache', 'system')),
  tokens     integer,
  created_at timestamptz not null default now()
);

create index if not exists ai_conversations_user_idx
  on public.ai_conversations (user_id, created_at desc);

create table if not exists public.ai_usage (
  id                bigserial primary key,
  user_id           bigint references public.users(telegram_id) on delete set null,
  provider          text not null default 'gemini',
  model             text,
  request_type      text not null default 'chat' check (request_type in ('chat', 'anime', 'health', 'other')),
  prompt_tokens     integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  latency_ms        integer not null default 0 check (latency_ms >= 0),
  status            text not null default 'success'
                    check (status in ('success', 'fallback', 'error', 'quota', 'rate_limited')),
  error_code        text,
  created_at        timestamptz not null default now()
);

create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);
create index if not exists ai_usage_user_idx on public.ai_usage (user_id, created_at desc);
create index if not exists ai_usage_status_idx on public.ai_usage (status, created_at desc);

create table if not exists public.ai_state (
  id                    smallint primary key default 1 check (id = 1),
  provider              text not null default 'gemini',
  status                text not null default 'ok'
                        check (status in ('ok', 'degraded', 'quota_exhausted', 'disabled')),
  consecutive_failures  integer not null default 0 check (consecutive_failures >= 0),
  last_success_at       timestamptz,
  last_failure_at       timestamptz,
  last_error            text,
  last_http_status      integer,
  next_retry_at         timestamptz,
  updated_at            timestamptz not null default now()
);

insert into public.ai_state (id) values (1) on conflict (id) do nothing;

drop trigger if exists ai_state_set_updated_at on public.ai_state;
create trigger ai_state_set_updated_at before update on public.ai_state
for each row execute function public.set_updated_at();

create table if not exists public.anime_cache (
  query      text primary key,
  source     text not null default 'jikan',
  payload    jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '6 hours'
);

create index if not exists anime_cache_expires_idx on public.anime_cache (expires_at);

-- =============================================================================
-- bot_settings — تنظیمات قابل تغییر بدون کد
-- =============================================================================
create table if not exists public.bot_settings (
  key         text primary key check (key ~ '^[a-z0-9_]{2,64}$'),
  value       jsonb not null,
  description text,
  is_secret   boolean not null default false,
  updated_by  bigint,
  updated_at  timestamptz not null default now()
);

drop trigger if exists bot_settings_set_updated_at on public.bot_settings;
create trigger bot_settings_set_updated_at before update on public.bot_settings
for each row execute function public.set_updated_at();

-- =============================================================================
-- bot_sessions — حالت گفت‌وگوی چندمرحله‌ای (بدون state در حافظه)
-- =============================================================================
create table if not exists public.bot_sessions (
  id          bigserial primary key,
  telegram_id bigint not null,
  chat_id     bigint not null,
  state       text not null,
  payload     jsonb not null default '{}'::jsonb,
  expires_at  timestamptz not null default now() + interval '30 minutes',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (telegram_id, chat_id)
);

create index if not exists bot_sessions_expires_idx on public.bot_sessions (expires_at);

drop trigger if exists bot_sessions_set_updated_at on public.bot_sessions;
create trigger bot_sessions_set_updated_at before update on public.bot_sessions
for each row execute function public.set_updated_at();

-- =============================================================================
-- audit: admin_actions و system_logs
-- =============================================================================
create table if not exists public.admin_actions (
  id          bigserial primary key,
  actor_id    bigint not null,
  action      text not null,
  target_type text,
  target_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists admin_actions_actor_idx on public.admin_actions (actor_id, created_at desc);
create index if not exists admin_actions_created_idx on public.admin_actions (created_at desc);

create table if not exists public.system_logs (
  id               bigserial primary key,
  level            text not null default 'info' check (level in ('debug', 'info', 'warn', 'error')),
  scope            text not null,
  message          text not null,
  context          jsonb not null default '{}'::jsonb,
  telegram_user_id bigint,
  created_at       timestamptz not null default now()
);

create index if not exists system_logs_level_idx on public.system_logs (level, created_at desc);
create index if not exists system_logs_scope_idx on public.system_logs (scope, created_at desc);

-- =============================================================================
-- bot_stats_daily — آمار تجمیعی روزانه (برای گزارش و نمودار)
-- =============================================================================
create table if not exists public.bot_stats_daily (
  day           date primary key,
  new_users     integer not null default 0,
  active_users  integer not null default 0,
  messages      integer not null default 0,
  ai_requests   integer not null default 0,
  ai_fallbacks  integer not null default 0,
  ads_sent      integer not null default 0,
  posts_sent    integer not null default 0,
  errors        integer not null default 0,
  blocked_users integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists bot_stats_daily_set_updated_at on public.bot_stats_daily;
create trigger bot_stats_daily_set_updated_at before update on public.bot_stats_daily
for each row execute function public.set_updated_at();

-- =============================================================================
-- Helper functions (RPC)
-- =============================================================================

-- upsert کاربر و افزایش شمارنده‌ها در یک رفت‌وبرگشت
-- حذف نسخه‌ی قدیمی (۸ پارامتری) تا در ارتقا، overload ناامن باقی نماند
drop function if exists public.touch_user(bigint, text, text, text, text, boolean, boolean, boolean);

create or replace function public.touch_user(
  p_telegram_id   bigint,
  p_username      text default null,
  p_first_name    text default null,
  p_last_name     text default null,
  p_language_code text default null,
  p_is_premium    boolean default false,
  p_is_bot        boolean default false,
  p_count_message boolean default false,
  p_day           date default null
)
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.users;
begin
  insert into public.users (
    telegram_id, username, first_name, last_name, language_code,
    is_premium, is_bot, message_count, broadcast_opt_in_at
  )
  values (
    p_telegram_id, p_username, p_first_name, p_last_name, p_language_code,
    coalesce(p_is_premium, false), coalesce(p_is_bot, false),
    case when p_count_message then 1 else 0 end,
    case when p_count_message then now() else null end
  )
  on conflict (telegram_id) do update set
    username        = coalesce(excluded.username, users.username),
    first_name      = coalesce(excluded.first_name, users.first_name),
    last_name       = coalesce(excluded.last_name, users.last_name),
    language_code   = coalesce(excluded.language_code, users.language_code),
    is_premium      = excluded.is_premium,
    last_seen_at    = now(),
    message_count   = users.message_count + case when p_count_message then 1 else 0 end,
    updated_at      = now()
  returning * into result;

  -- پیام امروز + فعالیت روزانه، اتمیک با همان رفت‌وبرگشت
  if p_day is not null then
    insert into public.bot_stats_daily (day) values (p_day) on conflict (day) do nothing;
    update public.bot_stats_daily
    set messages = messages + case when p_count_message then 1 else 0 end,
        updated_at = now()
    where day = p_day;

    if p_count_message then
      insert into public.user_daily_activity (telegram_id, day)
      values (p_telegram_id, p_day)
      on conflict (telegram_id, day) do nothing;
    end if;
  end if;

  return result;
end;
$$;

-- حذف کامل داده‌های یک کاربر (درخواست کاربر / حق حذف داده)
create or replace function public.purge_user(p_telegram_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.bot_sessions where telegram_id = p_telegram_id;
  delete from public.users where telegram_id = p_telegram_id;
  return found;
end;
$$;

-- نگه‌داشتن آخرین N پیام در حافظه‌ی AI
create or replace function public.trim_conversation(p_user_id bigint, p_keep integer default 12)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted integer;
begin
  delete from public.ai_conversations
  where user_id = p_user_id
    and id not in (
      select id from public.ai_conversations
      where user_id = p_user_id
      order by created_at desc, id desc
      limit greatest(p_keep, 2)
    );
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

-- پر کردن صف کمپین بر اساس مخاطب
create or replace function public.enqueue_broadcast(
  p_campaign_id uuid,
  p_audience text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  audience text;
  inserted integer;
begin
  select coalesce(p_audience, c.audience) into audience
  from public.broadcast_campaigns c where c.id = p_campaign_id;

  if audience is null then
    raise exception 'campaign % not found', p_campaign_id;
  end if;

  insert into public.broadcast_logs (campaign_id, user_id, status)
  select p_campaign_id, u.telegram_id, 'pending'
  from public.users u
  where u.is_bot = false
    and not exists (
      select 1 from public.banned_users b
      where b.user_id = u.telegram_id
        and b.is_active
        and (b.expires_at is null or b.expires_at > now())
    )
    and (
      audience = 'all'
      or (audience = 'active' and u.last_seen_at > now() - interval '30 days')
      or (audience = 'opt_in' and u.broadcast_opt_in)
    )
  on conflict (campaign_id, user_id) do nothing;

  get diagnostics inserted = row_count;

  update public.broadcast_campaigns
  set total_recipients = (select count(*) from public.broadcast_logs where campaign_id = p_campaign_id),
      status = 'queued',
      updated_at = now()
  where id = p_campaign_id;

  return inserted;
end;
$$;

-- تصاحب اتمی یک دسته از صف ارسال همگانی (جلوگیری از ارسال تکراری)
create or replace function public.claim_broadcast_batch(
  p_campaign_id uuid,
  p_limit integer default 20
)
returns table (log_id bigint, user_id bigint)
language sql
security definer
set search_path = public
as $$
  with batch as (
    select l.id
    from public.broadcast_logs l
    where l.campaign_id = p_campaign_id and l.status = 'pending'
    order by l.id
    limit greatest(p_limit, 1)
    for update skip locked
  ), claimed as (
    update public.broadcast_logs l
    set status = 'sending', locked_at = now(), attempts = l.attempts + 1
    from batch
    where l.id = batch.id
    returning l.id, l.user_id
  )
  select claimed.id, claimed.user_id from claimed;
$$;

-- بازگرداندن ردیف‌های گیرکرده در وضعیت sending (مثلاً پس از crash)
create or replace function public.reset_stale_broadcast_claims(
  p_campaign_id uuid default null,
  p_minutes integer default 10
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
 declare
  changed integer;
begin
  update public.broadcast_logs
  set status = 'pending', locked_at = null
  where status = 'sending'
    and locked_at < now() - make_interval(mins => greatest(p_minutes, 1))
    and (p_campaign_id is null or campaign_id = p_campaign_id);
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- شمارنده‌ی روزانه (فقط messages؛ بقیه در تجمیع شبانه محاسبه می‌شود)
create or replace function public.bump_daily_stat(
  p_day date,
  p_field text default 'messages',
  p_amount integer default 1
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_field not in ('new_users', 'messages', 'ai_requests', 'ai_fallbacks', 'ads_sent', 'posts_sent', 'errors') then
    raise exception 'invalid stat field %', p_field;
  end if;

  insert into public.bot_stats_daily (day) values (p_day) on conflict (day) do nothing;

  update public.bot_stats_daily set
    new_users    = new_users    + case when p_field = 'new_users'    then p_amount else 0 end,
    messages     = messages     + case when p_field = 'messages'     then p_amount else 0 end,
    ai_requests  = ai_requests  + case when p_field = 'ai_requests'  then p_amount else 0 end,
    ai_fallbacks = ai_fallbacks + case when p_field = 'ai_fallbacks' then p_amount else 0 end,
    ads_sent     = ads_sent     + case when p_field = 'ads_sent'     then p_amount else 0 end,
    posts_sent   = posts_sent   + case when p_field = 'posts_sent'   then p_amount else 0 end,
    errors       = errors       + case when p_field = 'errors'       then p_amount else 0 end,
    updated_at   = now()
  where day = p_day;
end;
$$;

-- پاک‌سازی دوره‌ای (retention)
create or replace function public.prune_old_data(p_days integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb := '{}'::jsonb;
  n integer;
begin
  delete from public.system_logs where created_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count; result := result || jsonb_build_object('system_logs', n);

  delete from public.ai_usage where created_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count; result := result || jsonb_build_object('ai_usage', n);

  delete from public.moderation_logs where created_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count; result := result || jsonb_build_object('moderation_logs', n);

  delete from public.broadcast_logs where status <> 'pending' and created_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count; result := result || jsonb_build_object('broadcast_logs', n);

  delete from public.ai_conversations where created_at < now() - make_interval(days => greatest(p_days, 30));
  get diagnostics n = row_count; result := result || jsonb_build_object('ai_conversations', n);

  delete from public.bot_sessions where expires_at < now();
  get diagnostics n = row_count; result := result || jsonb_build_object('bot_sessions', n);

  delete from public.anime_cache where expires_at < now();
  get diagnostics n = row_count; result := result || jsonb_build_object('anime_cache', n);

  delete from public.user_daily_activity where day < current_date - greatest(p_days, 30);
  get diagnostics n = row_count; result := result || jsonb_build_object('user_daily_activity', n);

  return result;
end;
$$;

-- دسترسی‌ها: توابع فقط با service_role اجرا شوند
revoke all on function public.touch_user(bigint, text, text, text, text, boolean, boolean, boolean, date) from public;
revoke all on function public.claim_due_advertisements(integer) from public;
revoke all on function public.claim_due_scheduled_posts(integer) from public;
revoke all on function public.claim_due_content_posts(integer) from public;
revoke all on function public.purge_user(bigint) from public;
revoke all on function public.trim_conversation(bigint, integer) from public;
revoke all on function public.enqueue_broadcast(uuid, text) from public;
revoke all on function public.prune_old_data(integer) from public;
revoke all on function public.claim_broadcast_batch(uuid, integer) from public;
revoke all on function public.reset_stale_broadcast_claims(uuid, integer) from public;
revoke all on function public.bump_daily_stat(date, text, integer) from public;

commit;
