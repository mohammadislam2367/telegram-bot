# استقرار کامل

پروژه: `https://sbbxlwlgeyshrhmemovq.supabase.co`  
ربات: `@Spixle_bot`  
کانال: `https://t.me/clickanime128`

> این راهنما دستورهای واقعی است. در محیط توسعه‌ی این مخزن، Supabase CLI و دسترسی به پروژه وجود نداشت؛ بنابراین deploy واقعی انجام **نشده** است.

---

## ۰) پیش‌نیازها

- [Supabase CLI](https://supabase.com/docs/guides/cli) نسخه‌ی جدید
- Deno 2 برای check/test
- دسترسی Owner به پروژه‌ی Supabase
- توکن ربات از `@BotFather`
- کلید Gemini (اختیاری؛ بدون آن Smart Fallback کار می‌کند)

```bash
supabase login
supabase link --project-ref sbbxlwlgeyshrhmemovq
```

---

## ۱) Secrets

از داشبورد: **Project Settings → Edge Functions → Secrets**  
یا CLI:

```bash
supabase secrets set \
  TELEGRAM_BOT_TOKEN="<توکن ربات>" \
  TELEGRAM_WEBHOOK_SECRET="<رشته تصادفی حداقل ۳۲ کاراکتر>" \
  SUPER_ADMIN_IDS="<آیدی عددی شما>" \
  SCHEDULER_SECRET="<رشته تصادفی دیگر>" \
  GEMINI_API_KEY="<کلید Gemini>" \
  GEMINI_MODEL="gemini-2.0-flash" \
  BOT_USERNAME="Spixle_bot" \
  APP_TIMEZONE="Asia/Tehran"
```

| Secret | الزامی | توضیح |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | ✅ | از BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | ✅ | همان مقدار در `setWebhook`؛ بدون آن Webhook همه‌ی آپدیت‌ها را رد می‌کند |
| `SUPER_ADMIN_IDS` | ✅ | یک یا چند آیدی عددی با کاما؛ مالک غیرقابل حذف |
| `SCHEDULER_SECRET` | ✅ | برای فراخوانی `scheduler` از pg_cron |
| `SUPABASE_URL` | خودکار | Supabase به توابع تزریق می‌کند |
| `SUPABASE_SERVICE_ROLE_KEY` | خودکار | Supabase به توابع تزریق می‌کند؛ در کد/کلاینت نگذارید |
| `GEMINI_API_KEY` | اختیاری | بدون آن فقط fallback |
| `GEMINI_MODEL` | اختیاری | پیش‌فرض `gemini-2.0-flash` |
| `BOT_USERNAME` | اختیاری | پیش‌فرض `Spixle_bot` |
| `APP_TIMEZONE` | اختیاری | پیش‌فرض `Asia/Tehran` |

هیچ مقدار Secret را در Git، `.env.example` یا پیام قرار ندهید. `.env` در `.gitignore` است.

---

## ۲) دیتابیس

در **SQL Editor** به‌ترتیب:

1. `supabase/database/schema.sql`
2. `supabase/database/policies.sql`
3. `supabase/database/seed.sql`

هر فایل idempotent است (`if not exists`, `drop ... if exists`). اجرای دوباره‌ی `schema.sql` داده‌ها را حذف نمی‌کند، اما توابع را بازتعریف می‌کند.

بررسی سریع:

```sql
select count(*) from public.bot_settings;        -- باید > 30
select count(*) from public.content_categories;  -- باید >= 4
select relname, relrowsecurity from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r';
```

همه باید `relrowsecurity = true` باشند.

---

## ۳) Deploy توابع

```bash
supabase functions deploy telegram-bot --no-verify-jwt
supabase functions deploy scheduler    --no-verify-jwt
supabase functions deploy health       --no-verify-jwt
```

`supabase/config.toml` هم `verify_jwt = false` را برای هر سه تنظیم کرده است؛ امنیت با Secret انجام می‌شود.

بررسی سلامت:

```bash
curl -s "https://sbbxlwlgeyshrhmemovq.supabase.co/functions/v1/health?deep=1"
```

پاسخ باید `ok: true` و `telegram.ok: true` باشد. `deep=1` توکن را به تلگرام می‌فرستد؛ خروجی هیچ Secretی برنمی‌گرداند.

---

## ۴) ثبت Webhook

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://sbbxlwlgeyshrhmemovq.supabase.co/functions/v1/telegram-bot",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message", "callback_query", "chat_member", "my_chat_member"],
    "drop_pending_updates": true
  }'
```

بررسی:

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

باید `last_error_message` خالی و `pending_update_count` کوچک باشد. اگر `401` گرفتید یعنی Secret هدر با Secret تابع یکی نیست.

سپس در تلگرام:

1. `/start` را بزنید.
2. `/start admin` یا `/admin` را بزنید (فقط آیدی داخل `SUPER_ADMIN_IDS`).
3. از **🧰 ابزارهای سیستم → ثبت دستورات ربات** منوی دستورات را ثبت کنید.

---

## ۵) زمان‌بندی با pg_cron

ابتدا Secret را در Vault بگذارید (مقدار باید دقیقاً برابر `SCHEDULER_SECRET` باشد):

```sql
select vault.create_secret('<SCHEDULER_SECRET>', 'scheduler_secret');
```

سپس `supabase/database/cron.sql` را در SQL Editor اجرا کنید. این فایل:

- `pg_cron` و `pg_net` را فعال می‌کند.
- هر دقیقه تابع `scheduler` را با هدر `X-Scheduler-Secret` صدا می‌زند.
- روزانه `prune_old_data` را اجرا می‌کند.

> `scheduler_endpoint()` در `cron.sql` به پروژه‌ی `sbbxlwlgeyshrhmemovq` اشاره می‌کند. اگر پروژه را fork کردید، این مقدار را عوض کنید.

بررسی jobها:

```sql
select jobid, jobname, schedule, active from cron.job;
select * from cron.job_run_details order by start_time desc limit 5;
```

فراخوانی دستی برای تست:

```bash
curl -s -X POST "https://sbbxlwlgeyshrhmemovq.supabase.co/functions/v1/scheduler" \
  -H "X-Scheduler-Secret: <SCHEDULER_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"source":"manual"}'
```

پاسخ شامل `summary` با تعداد تبلیغ/پست/همگانی/AI/آمار است.

---

## ۶) اجرای محلی (اختیاری)

```bash
cp .env.example .env    # مقادیر را پر کنید
supabase start
supabase functions serve telegram-bot --env-file .env --no-verify-jwt
```

برای دریافت Webhook روی لوکال به یک تونل HTTPS نیاز دارید:

```bash
ngrok http 54321
# سپس setWebhook با URL تونل و همان secret_token
```

اجرای محلی بدون Supabase (فقط تست منطق):

```bash
deno task check
deno task lint
deno task test
node scripts/verify-database.mjs
```

---

## ۷) چک‌لیست پس از استقرار

- [ ] `health?deep=1` → `ok: true`
- [ ] `getWebhookInfo` → بدون خطا
- [ ] `/start` منوی کاربر را نشان می‌دهد
- [ ] `/admin` فقط برای مالک باز می‌شود
- [ ] یک تبلیغ تستی بسازید و «🧪 پیش‌نمایش/تست» را بزنید
- [ ] یک پست زمان‌بندی‌شده‌ی ۲ دقیقه بعد بسازید و انتشارش را ببینید
- [ ] یک ارسال همگانی کوچک با تأیید اجرا کنید و پیشرفت را ببینید
- [ ] `/stop` و سپس `/start` را تست کنید (opt-in)
- [ ] `/deletedata` را با یک حساب تستی تأیید کنید
- [ ] `cron.job_run_details` موفق باشد
- [ ] در گروه: افزودن ربات، ادمین‌کردن، `/rules` و ضدلینک

---

## ۸) عملیات و نگه‌داری

| کار | دستور/مسیر |
| --- | --- |
| مشاهده‌ی لاگ توابع | Dashboard → Edge Functions → Logs |
| لاگ برنامه | جدول `system_logs` |
| لاگ مدیران | جدول `admin_actions` |
| تنظیم مجدد Webhook | `setWebhook` با همان `secret_token` |
| چرخش Secret | مقدار جدید در Secrets + `setWebhook` مجدد |
| چرخش Scheduler Secret | Secrets + `vault.update_secret` + اجرای مجدد cron |
| پاک‌سازی دستی | `/admin → 🧰 ابزارها → پاک‌سازی داده` |
| توقف ارسال همگانی | `/admin → 📨 همگانی → توقف` |

اگر پس از deploy، توابع `500 server_not_configured` دادند، یکی از Secretهای الزامی خالی است؛ نام‌ها در پاسخ `missing` برمی‌گردند (بدون مقدار).
