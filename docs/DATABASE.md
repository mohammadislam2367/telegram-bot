# دیتابیس، RLS و RPCها

فایل‌ها به‌ترتیب اجرا:

1. `supabase/database/schema.sql` — جداول، constraints، index، trigger، توابع.
2. `supabase/database/policies.sql` — RLS، revoke/grant، سیاست خواندن محتوای منتشرشده.
3. `supabase/database/seed.sql` — تنظیمات پیش‌فرض و دسته‌های محتوا.
4. `supabase/database/cron.sql` — پس از deploy تابع scheduler و ثبت Secret در Vault.

---

## جداول (۲۴ جدول)

### کاربران و مدیران

| جدول | نکته |
| --- | --- |
| `users` | `telegram_id` کلید، `message_count`، `last_seen_at`، `broadcast_opt_in`، `is_premium` |
| `user_daily_activity` | `(telegram_id, day)` یکتا؛ منبع واقعی «کاربر فعال امروز/هر روز» |
| `admins` | نقش `owner/super_admin/admin/moderator`، `permissions` اضافی، `is_active` |
| `banned_users` | یک بن فعال برای هر کاربر (partial unique index)؛ `expires_at` اختیاری |

### گروه‌ها و مدیریت

| جدول | نکته |
| --- | --- |
| `groups` | `telegram_chat_id` کلید، `bot_is_admin`، `is_active` |
| `group_settings` | ضدلینک/ضداسپم/خوش‌آمد/سکوت/سقف اخطار |
| `group_bans` | بن گروهی با `telegram_chat_id` + `user_id` |
| `user_warnings` | اخطارها؛ ایندکس یکتای اخطار فعال برای `(group,user)` |
| `moderation_logs` | تاریخچه‌ی اقدامات گروه |

### تبلیغات، صف و محتوا

| جدول | نکته |
| --- | --- |
| `advertisements` | وضعیت `draft/active/paused/archived`، `claimed_at`، شمارنده‌ها |
| `scheduled_posts` | وضعیت `pending/sent/failed/cancelled`، `attempts`، `claimed_at` |
| `broadcast_campaigns` | فقط یک `running` (index یکتا) |
| `broadcast_logs` | `(campaign_id,user_id)` یکتا؛ `pending → sending → sent/failed/skipped` |
| `content_categories` | دسته‌های خبر/راهنما |
| `content_posts` | `draft/scheduled/published/archived`، `search_vector` تولیدشده، `claimed_at` |

### هوش مصنوعی

| جدول | نکته |
| --- | --- |
| `ai_conversations` | حافظه‌ی چت؛ با حذف کاربر cascade |
| `ai_usage` | هر درخواست؛ `success/fallback/quota/rate_limited/error`؛ با حذف کاربر بی‌نام می‌شود |
| `ai_state` | ردیف singleton (id=1) با وضعیت و `next_retry_at` |
| `anime_cache` | کش Jikan با `expires_at` |

### سیستم

| جدول | نکته |
| --- | --- |
| `bot_settings` | همه‌ی تنظیمات به‌صورت JSONB؛ seed مقدار پیش‌فرض می‌دهد |
| `bot_sessions` | state wizard/confirm با TTL |
| `admin_actions` | لاگ اقدامات مدیر |
| `system_logs` | لاگ ساخت‌یافته‌ی توابع |
| `bot_stats_daily` | پیام/کاربر جدید/AI/تبلیغ/پست/خطا برای هر روز |

---

## RPCهای مهم

| تابع | رفتار |
| --- | --- |
| `touch_user(...)` | upsert کاربر + شمارنده پیام + `bot_stats_daily.messages` + `user_daily_activity`، همه در یک رفت‌وبرگشت |
| `purge_user(id)` | حذف کامل کاربر و وابستگی‌ها؛ `ai_usage` بی‌نام؛ sessionها پاک می‌شوند |
| `trim_conversation(id, keep)` | نگه‌داشتن آخرین N پیام |
| `enqueue_broadcast(campaign)` | فقط کاربران opt-in غیربن غیرربات؛ `ON CONFLICT DO NOTHING` |
| `claim_broadcast_batch(campaign, limit)` | `FOR UPDATE SKIP LOCKED`، `pending→sending`، افزایش `attempts` |
| `reset_stale_broadcast_claims(campaign, minutes)` | آزادسازی claimهای گیرکرده |
| `bump_daily_stat(day, field, amount)` | افزایش اتمیک یک ستون آمار با allowlist |
| `claim_due_advertisements(limit)` | lease ۱۰ دقیقه‌ای روی تبلیغ‌های due |
| `claim_due_scheduled_posts(limit)` | همان برای پست‌های `pending` |
| `claim_due_content_posts(limit)` | همان برای محتوای `scheduled` |
| `prune_old_data(days)` | session منقضی، لاگ/AI/کش/فعالیت قدیمی؛ گزارش تعداد |
| `set_updated_at()` | trigger مشترک `updated_at` |

همه‌ی توابع `SECURITY DEFINER` با `search_path=public` هستند و `EXECUTE` از `public/anon/authenticated` گرفته شده است.

---

## RLS

- روی هر ۲۴ جدول `ENABLE ROW LEVEL SECURITY`.
- `REVOKE ALL` از `anon` و `authenticated` روی همه‌ی جداول.
- تنها دسترسی خواندنی: `content_posts` با `status='published'` برای `authenticated`.
- Edge Functions با `service_role` کار می‌کنند و از RLS عبور می‌کنند؛ هیچ کلید service role به تلگرام/مرورگر نمی‌رود.
- `GRANT SELECT` روی `users` یا سایر جداول حساس وجود ندارد.

---

## محدودیت‌ها و قواعد کلیدی

- `advertisements_media_consistency`: مدیا بدون `media_file_id` مجاز نیست.
- `content_scheduled_requires_time`: وضعیت `scheduled` بدون زمان مجاز نیست.
- `banned_users_active_uidx`: فقط یک بن فعال برای هر کاربر.
- `broadcast_logs_unique_recipient`: ارسال دوبار به یک کاربر در یک کمپین ممکن نیست.
- `broadcast_single_running_uidx`: حداکثر یک کمپین در حال اجرا.
- `user_warnings_active_uidx`: یک اخطار فعال برای هر `(گروه، کاربر)`.
- `warn_limit` با trigger/constraint اعمال می‌شود.

---

## نگه‌داری داده

`prune_old_data(days)` توسط cron روزانه اجرا می‌شود:

- sessionهای منقضی
- `system_logs`، `moderation_logs`، `admin_actions` قدیمی
- `ai_usage` قدیمی (آمار تجمیعی می‌ماند)
- `anime_cache` منقضی
- `user_daily_activity` قدیمی‌تر از حداکثر `days` و ۳۰ روز

`data_retention_days` از تنظیمات خوانده می‌شود (پیش‌فرض ۹۰، بازه‌ی مجاز ۷–۳۶۵).

---

## تست دیتابیس

```bash
npm install --no-save --no-package-lock @electric-sql/pglite
node scripts/verify-database.mjs
```

اسکریپت کل `schema.sql`، `policies.sql` و `seed.sql` را در PGlite اجرا می‌کند و ۶۶ چک دارد: جداول، constraintها، RPCها، claimهای اتمی، RLS، شمارنده‌ها، حذف کاربر و retention.

نتیجه‌ی آخرین اجرا: **۶۶ / ۶۶ موفق**.
