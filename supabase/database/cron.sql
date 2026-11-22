-- =============================================================================
-- Anime Click Ultimate — Scheduled jobs (pg_cron + pg_net + Supabase Vault)
--
-- پیش‌نیازها (یک‌بار در SQL Editor اجرا کنید):
--   1) SCHEDULER_SECRET را در Secrets توابع ثبت کنید (مقداری تصادفی و طولانی).
--   2) همان مقدار را در Vault ذخیره کنید تا در فایل SQL لو نرود:
--        select vault.create_secret('<همان مقدار>', 'scheduler_secret');
--   3) در SQL Editor این فایل را اجرا کنید (پس از deploy تابع scheduler).
--
-- نکته: Supabase Edge Runtime اجرای دائمی ندارد؛ بنابراین زمان‌بندی با pg_cron
-- انجام می‌شود و هر دقیقه تابع scheduler را با POST فراخوانی می‌کند.
-- =============================================================================
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- پروژه‌ی خود را اینجا تنظیم کنید
-- (همان مقدار SUPABASE_URL پروژه: https://<ref>.supabase.co)
create or replace function public.scheduler_endpoint()
returns text
language sql
immutable
as $$ select 'https://sbbxlwlgeyshrhmemovq.supabase.co/functions/v1/scheduler'::text $$;

-- پاک‌سازی jobهای قبلی (idempotent)
select cron.unschedule(jobid) from cron.job where jobname like 'animeclick-%';

-- هر دقیقه: انتشار تبلیغ/پست زمان‌بندی‌شده، پیشبرد صف ارسال همگانی،
-- بررسی سلامت AI، تجمیع آمار روزانه
select cron.schedule(
  'animeclick-scheduler-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url     := public.scheduler_endpoint(),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Scheduler-Secret',
      coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'scheduler_secret'), '')
    ),
    body    := jsonb_build_object('source', 'pg_cron', 'task', 'all'),
    timeout_milliseconds := 25000
  );
  $$
);

-- هر روز 03:10 به وقت UTC: پاک‌سازی داده‌های قدیمی (retention)
select cron.schedule(
  'animeclick-retention-daily',
  '10 3 * * *',
  $$
  select public.prune_old_data(
    coalesce((select (value #>> '{}')::int from public.bot_settings where key = 'data_retention_days'), 90)
  );
  $$
);

commit;
