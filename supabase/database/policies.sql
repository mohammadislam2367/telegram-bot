-- =============================================================================
-- Anime Click Ultimate — Row Level Security
-- پیش‌نیاز: Supabase roles ya موجودند (anon, authenticated, service_role).
-- مدل امنیتی: ربات فقط با service_role (در Edge Function) کار می‌کند.
-- کلاینت‌ها هیچ دسترسی‌ای به جداول مدیریتی/کاربران ندارند.
-- تنها استثنا: خواندن پست‌های منتشرشده برای کاربران واردشده (آینده: وب‌سایت).
-- =============================================================================
begin;

alter table public.users               enable row level security;
alter table public.user_daily_activity enable row level security;
alter table public.admins              enable row level security;
alter table public.banned_users        enable row level security;
alter table public.groups              enable row level security;
alter table public.group_settings      enable row level security;
alter table public.group_bans          enable row level security;
alter table public.user_warnings       enable row level security;
alter table public.moderation_logs     enable row level security;
alter table public.advertisements      enable row level security;
alter table public.scheduled_posts     enable row level security;
alter table public.content_categories  enable row level security;
alter table public.content_posts       enable row level security;
alter table public.broadcast_campaigns enable row level security;
alter table public.broadcast_logs      enable row level security;
alter table public.ai_conversations    enable row level security;
alter table public.ai_usage            enable row level security;
alter table public.ai_state            enable row level security;
alter table public.anime_cache         enable row level security;
alter table public.bot_settings        enable row level security;
alter table public.bot_sessions        enable row level security;
alter table public.admin_actions       enable row level security;
alter table public.system_logs         enable row level security;
alter table public.bot_stats_daily     enable row level security;

-- ─── کمترین دسترسی: هیچ grant پیش‌فرضی برای anon/authenticated ───────────────
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
    execute 'revoke all on all functions in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
    execute 'revoke all on all functions in schema public from authenticated';
  end if;
end;
$$;

-- ─── تنها مسیر خواندن عمومی: محتوای منتشرشده ────────────────────────────────
grant usage on schema public to authenticated;
grant select on public.content_posts to authenticated;
grant select on public.content_categories to authenticated;

drop policy if exists content_posts_read_published on public.content_posts;
create policy content_posts_read_published
  on public.content_posts
  for select
  to authenticated
  using (status = 'published');

drop policy if exists content_categories_read on public.content_categories;
create policy content_categories_read
  on public.content_categories
  for select
  to authenticated
  using (true);

-- هیچ policy دیگری وجود ندارد ⇒ برای anon/authenticated همه چیز deny است.
-- service_role از RLS عبور می‌کند و تنها کلید استفاده‌شده در Edge Functions است.

-- ─── توابع داخلی: فقط service_role ──────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.set_updated_at() from authenticated';
  end if;
end;
$$;

commit;
