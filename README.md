# Anime Click Ultimate

پلتفرم کامل مدیریت تلگرام برای کانال [Anime Click](https://t.me/clickanime128) و ربات `@Spixle_bot`، ساخته‌شده روی **Supabase Edge Functions (Deno/TypeScript)** و **PostgreSQL**.

داشبورد مدیریت کاملاً داخل تلگرام است (بدون پنل وب) و همه‌ی عملیات حساس تأیید دو‌مرحله‌ای دارند.

---

## قابلیت‌ها

| بخش | توضیح |
| --- | --- |
| 🤖 چت هوشمند | Gemini با حافظه‌ی گفت‌وگو، سقف روزانه، تشخیص تمام‌شدن سهمیه |
| 🧠 Smart Fallback | بیش از ۱۰۰ پاسخ آماده‌ی فارسی/انگلیسی وقتی AI در دسترس نیست |
| 🔎 جستجوی انیمه | Jikan API (MyAnimeList) + کش دیتابیس + جستجوی فصل |
| 👥 کاربران | لیست/جستجو، جزئیات، مسدودسازی، پیام مستقیم، حذف داده |
| 🚫 مسدودسازی | مسدود/آزادسازی با دلیل، اعمال فوری روی همه‌ی درخواست‌ها |
| 📢 تبلیغات | ایجاد، زمان‌بندی، تکرار، ارسال به کانال، آمار موفق/خطا |
| 📨 ارسال همگانی | صف اتمی، دسته‌بندی، تأیید، توقف/ادامه/لغو، جلوگیری از تکرار |
| 📅 زمان‌بندی | پست‌های زمان‌بندی‌شده با تکرار روزانه/هفتگی/ماهانه |
| 📰 محتوا | خبر/پست/راهنما، دسته‌بندی، انتشار و سنجاق در کانال |
| 👮 گروه‌ها | ضدلینک، ضداسپم، اخطار، خوش‌آمد، سکوت، پاک‌سازی پیام |
| 📊 آمار | کاربران فعال روزانه/هفتگی، پیام، AI، تبلیغات، خطاها، گزارش هفتگی |
| 🛡 امنیت | لاگ فعالیت مدیران، Webhook Secret، تأیید مجدد مجوز در هر callback |
| 🧰 ابزارها | تست اتصال AI، ثبت دستورات ربات، پاک‌سازی داده، سلامت سیستم |
| ⚙️ تنظیمات | ویرایش کامل تنظیمات، ماژول‌ها و مدیران بدون تغییر کد |

---

## ساختار پروژه

```text
supabase/
  database/
    schema.sql        # جداول، constraints، index، trigger، RPCها
    policies.sql      # RLS و کمترین دسترسی
    seed.sql          # تنظیمات پیش‌فرض و دسته‌های محتوا
    cron.sql          # pg_cron + pg_net + Vault
  functions/
    _shared/          # هسته‌ی مشترک (config, db, auth, telegram, ai, scheduler, ...)
    telegram-bot/     # Webhook و کل UI تلگرام
    scheduler/        # اجرای وظایف زمان‌بندی‌شده
    health/           # بررسی سلامت
scripts/
  verify-database.mjs # تست SQL با PGlite (۶۶ چک)
tests/                # تست‌های Deno (۷۰ تست)
docs/                 # معماری، دیتابیس، استقرار، تست
```

---

## شروع سریع (محلی)

```bash
# 1) Deno
curl -fsSL https://deno.land/install.sh | sh

# 2) تست دیتابیس (نیاز به Node و PGlite)
npm install --no-save --no-package-lock @electric-sql/pglite
node scripts/verify-database.mjs

# 3) type-check / lint / تست‌ها
deno task check
deno task lint
deno task test

# 4) Supabase CLI (برای deploy واقعی)
supabase login
supabase link --project-ref sbbxlwlgeyshrhmemovq
```

راهنمای کامل: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

---

## استقرار در سه مرحله

1. **دیتابیس:** در SQL Editor به‌ترتیب `schema.sql` → `policies.sql` → `seed.sql` را اجرا کنید.
2. **توابع:** `telegram-bot`، `scheduler` و `health` را deploy کنید (بدون JWT؛ امنیت با Secret).
3. **زمان‌بندی و Webhook:** Secret را در Vault بگذارید، `cron.sql` را اجرا کنید و Webhook را با `secret_token` ثبت کنید.

دستورهای دقیق و Secrets لازم در [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) آمده است.

---

## امنیت

- هیچ کلیدی در کد یا مخزن نیست؛ همه از **Supabase Secrets** خوانده می‌شوند.
- Edge Functions فقط با `service_role` کار می‌کنند؛ `anon` و `authenticated` به هیچ جدولی دسترسی نوشتن ندارند.
- RLS روی همه‌ی جداول فعال است؛ تنها استثنای خواندنی، محتوای منتشرشده است.
- Webhook با هدر `X-Telegram-Bot-Api-Secret-Token` و مقایسه‌ی زمان-ثابت تأیید می‌شود.
- Scheduler با `X-Scheduler-Secret` محافظت می‌شود.
- در هر callback مجوز مدیر **دوباره** از دیتابیس خوانده می‌شود؛ به callback_data اعتماد نمی‌شود.
- مالک اصلی (SUPER_ADMIN_IDS) قابل حذف یا تنزل نیست.
- عملیات حساس (بن، حذف، ارسال همگانی، تغییر تنظیمات، مدیران) تأیید توکن‌دار و لاگ دارند.

جزئیات: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## وضعیت تست (آخرین اجرا)

| بررسی | نتیجه |
| --- | --- |
| `node scripts/verify-database.mjs` (PGlite) | **۶۶ / ۶۶ موفق** |
| `deno task test` | **۷۰ / ۷۰ موفق** |
| `deno check` (۳ entrypoint + تست‌ها) | بدون خطا |
| `deno lint` | بدون خطا |
| `deno fmt --check` | بدون خطا |

**آنچه تست نشده است:** این محیط به Supabase، Telegram و Gemini دسترسی ندارد؛ بنابراین deploy واقعی، Webhook زنده، ارسال واقعی پیام و پاسخ واقعی Gemini/Jikan آزمایش نشده‌اند. تست‌ها این لایه‌ها را با stub و PGlite پوشش می‌دهند. جزئیات در [docs/TESTING.md](docs/TESTING.md).

---

## مستندات

- [معماری و جریان درخواست](docs/ARCHITECTURE.md)
- [دیتابیس، RLS و RPCها](docs/DATABASE.md)
- [استقرار، Secrets و Cron](docs/DEPLOYMENT.md)
- [تست‌ها و محدودیت‌ها](docs/TESTING.md)
