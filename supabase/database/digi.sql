-- =============================================================================
-- digi.sql — جدول‌های تکمیلی «دیجی‌وار»
--   group_staff   : مدیران ربات و کاربران ویژهٔ هر گروه
--   group_words   : فیلتر کلمات هر گروه
--   group_scores  : امتیاز اعضا (مثبت/منفی)
-- اجرا: همان روش schema.sql (idempotent است)
-- =============================================================================

create table if not exists public.group_staff (
  id          bigserial primary key,
  group_id    bigint not null references public.groups(telegram_chat_id) on delete cascade,
  user_id     bigint not null,
  role        text not null check (role in ('admin', 'vip')),
  added_by    bigint not null,
  created_at  timestamptz not null default now()
);

create unique index if not exists group_staff_uidx
  on public.group_staff (group_id, user_id, role);

create table if not exists public.group_words (
  id          bigserial primary key,
  group_id    bigint not null references public.groups(telegram_chat_id) on delete cascade,
  word        text not null,
  created_by  bigint not null,
  created_at  timestamptz not null default now()
);

create unique index if not exists group_words_uidx
  on public.group_words (group_id, word);

create table if not exists public.group_scores (
  group_id    bigint not null references public.groups(telegram_chat_id) on delete cascade,
  user_id     bigint not null,
  score       integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);
