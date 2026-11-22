# معماری Anime Click Ultimate

## نمای کلی

```text
Telegram ──POST──▶ telegram-bot (Edge Function)
                     │ 1. تأیید Webhook Secret (زمان-ثابت)
                     │ 2. parse + touch_user (کاربر/آمار/فعالیت روزانه)
                     │ 3. getAdmin (نقش و مجوزها از DB)
                     │ 4. guard (تعمیر/بن/ماژول/محدودیت نرخ)
                     ▼
        ┌────────────┼─────────────┬──────────────┐
        ▼            ▼             ▼              ▼
    commands     callbacks      wizard        group events
        │            │             │              │
        └────────────┴──────┬──────┴──────────────┘
                            ▼
                 Supabase Postgres (service_role)
                            ▲
pg_cron ──POST──▶ scheduler ─┘ (تبلیغ، پست، محتوا، صف همگانی، آمار، AI)
```

- Edge Runtime دائمی نیست؛ بنابراین هیچ تایمر یا صف در حافظه نگه‌داری نمی‌شود.
- تمام state در PostgreSQL است: sessionها، wizard، صف ارسال، rate-limitهای ذخیره‌شده در AI، تنظیمات.
- هر درخواست Webhook با `EdgeRuntime.waitUntil` پردازش می‌شود تا پاسخ سریع به تلگرام برگردد.

---

## ماژول‌ها

### `supabase/functions/_shared/`

| فایل | مسئولیت |
| --- | --- |
| `config.ts` | خواندن Secrets، اعتبارسنجی، `describeConfig` بدون چاپ مقدار |
| `types.ts` | تایپ‌های تلگرام و ردیف‌های دیتابیس |
| `http.ts` | `fetchJson`، `HttpError`، `jsonResponse`، `sleep` |
| `telegram.ts` | کلاینت Bot API، retry هوشمند (429/5xx)، تفکیک خطاها، split متن |
| `validation.ts` | escape HTML، شناسه/لینک/دکمه، زمان‌بندی با منطقه‌ی زمانی، محدودیت ۶۴ بایت callback |
| `db.ts` | کلاینت Supabase، `selectRows/countRows/insertRow/updateRows/callRpc` |
| `logger.ts` | لاگ ساخت‌یافته در `system_logs` با redaction |
| `settings.ts` | `SettingsStore` با کش درون‌درخواستی و مقادیر پیش‌فرض |
| `auth.ts` | نقش‌ها، ماتریس مجوز، `getAdmin`، تأیید Secret، کش ادمین گروه |
| `sessions.ts` | session جدول‌محور با TTL و پاک‌سازی |
| `rate_limit.ts` | پنجره‌ی لغزان درون‌ایزوله + محدودیت روزانه AI در DB |
| `keyboards.ts` | منوهای منظم RTL، فیلتر بر اساس مجوز/ماژول |
| `texts.ts` | اعداد فارسی، تاریخ، نمودار میله‌ای، برچسب وضعیت |
| `wizard.ts` | موتور خالص wizard (فیلد، اعتبارسنجی، back/skip/choice) |
| `fallback_data.ts` / `ai_fallback.ts` | ۱۰۰+ پاسخ آماده، نرمال‌سازی، امتیازدهی، زبان |
| `ai_provider.ts` / `ai_core.ts` | Gemini، سقف روزانه، حافظه، fallback، Jikan context |
| `anime_data.ts` | Jikan، کش، فرمت کارت/لیست |
| `publishers.ts` | ارسال تبلیغ/پست/محتوا با محدودیت تلگرام |
| `broadcast_runner.ts` | claim اتمی دسته، ارسال، pause/cancel، خطای پیاپی |
| `stats_core.ts` | آمار کلی/سری زمانی، تجمیع روزانه، گزارش هفتگی |
| `scheduler_core.ts` | claim اتمی و اجرای همه‌ی وظایف دوره‌ای |

### `supabase/functions/telegram-bot/`

| فایل | مسئولیت |
| --- | --- |
| `index.ts` | Webhook، Secret، parse، `waitUntil` |
| `router.ts` | استخراج کاربر/چت، `touch_user`، گاردها، مسیردهی |
| `context.ts` | `Ctx`، ارسال/ویرایش، `askConfirm`، `askForInput`، لاگ مدیر |
| `dashboard.ts` | خانه‌ی مدیر و منوی کاربر |
| `commands.ts` | `/start /admin /ai /anime /news /profile /privacy /stop /deletedata /cancel /id /help` |
| `admin.ts` | dispatcher داخلی، تأیید عملیات، ورودی متنی، ثبت wizardها |
| `users.ts` | لیست/جزئیات کاربر، بن، پیام، حذف داده |
| `advertisements.ts` | CRUD تبلیغ + wizard |
| `broadcast.ts` | کمپین همگانی + wizard + کنترل صف |
| `schedule.ts` | پست زمان‌بندی‌شده + wizard |
| `content.ts` | خبر/پست/راهنما، دسته، انتشار، wizard ایجاد/ویرایش |
| `groups.ts` | تنظیمات گروه، ضدلینک/ضداسپم/اخطار/خوش‌آمد |
| `moderation.ts` | رویدادهای گروه، `/ban /warn /mute /purge /rules`، welcome |
| `settings.ts` | تنظیمات، ماژول‌ها، مدیران و نقش‌ها |
| `security.ts` | لاگ فعالیت، بن‌های ربات |
| `tools.ts` | تست AI، ثبت دستورات، پاک‌سازی، وضعیت |
| `ai.ts` | چت هوشمند، سقف، حالت گفت‌وگو |
| `anime.ts` | جستجو/فصل/جزئیات |
| `news.ts` | نمایش محتوای منتشرشده |
| `stats.ts` | آمار و گزارش‌ها |
| `wizard_flow.ts` | ثبت wizard، ذخیره‌ی state در session، اجرا |

---

## جریان یک آپدیت

1. **احراز هویت:** Secret هدر بررسی می‌شود؛ بدون آن `401`.
2. **استخراج:** `message` / `callback_query` / `chat_member` / `my_chat_member`.
3. **کاربر:** `touch_user` به‌صورت اتمی کاربر را upsert می‌کند، شمارنده‌ی پیام و فعالیت روزانه را به‌روز می‌کند.
4. **مدیر:** `getAdmin` نقش را از `admins` می‌خواند؛ SUPER_ADMIN_IDS همیشه owner است.
5. **گاردها:**
   - کاربر بن‌شده: پیام توضیح + توقف.
   - حالت تعمیر: فقط مالک اجازه دارد.
   - محدودیت نرخ: کاربر/مدیر جداگانه.
6. **مسیردهی:**
   - `callback_query` → `handleCallback` (namespaceهای `a: u: w: x:`) و در `finally` پاسخ به callback.
   - wizard فعال → ورودی به wizard می‌رود (مگر callback).
   - گروه → رویدادهای عضویت/پیام و دستورات گروه.
   - خصوصی → دستور یا حالت چت AI.
7. **خطا:** `runWithErrorHandling` خطا را لاگ می‌کند و پیام عمومی می‌فرستد؛ جزئیات به کاربر لو نمی‌رود.

### Namespaceهای callback

| پیشوند | معنی |
| --- | --- |
| `a:` | داشبورد مدیر |
| `u:` | منوی کاربر |
| `w:` | wizard (`w:c:<value>`، `w:s`، `w:b`، `w:x`، `w:ok`) |
| `x:y|n:<token>` | تأیید/انصراف عملیات حساس |
| `noop` | دکمه‌ی غیرفعال |

توکن تأیید در session ذخیره می‌شود، نه در callback_data؛ بنابراین کاربر نمی‌تواند با دستکاری callback، عملیات حساس را جعل کند.

---

## Session و Wizard

- `bot_sessions` کلید `(telegram_id, chat_id)` دارد و `expires_at` دارد.
- Wizard فقط `wizard`, `index`, `data` را نگه می‌دارد؛ منطق در `wizard.ts` خالص و تست‌پذیر است.
- `overwrite` هنگام شروع wizard (مثلاً `type=news` یا `id` برای ویرایش) در `data` ادغام می‌شود.
- عملیات حساس پس از اتمام wizard، `askConfirm` می‌سازد؛ توکن یک‌بارمصرف و وابسته به session است.

---

## هوش مصنوعی

```text
پیام کاربر
  ├─ ماژول AI خاموش؟ → پیام غیرفعال
  ├─ سقف روزانه پر؟ → fallback + ثبت quota
  ├─ Gemini (با timeout/retry)
  │     ├─ موفق → پاسخ + ذخیره در حافظه
  │     └─ 429/خطا → Smart Fallback
  └─ Fallback: نرمال‌سازی → امتیازدهی کلیدواژه → پاسخ آماده
        └─ اگر پرسش انیمه‌ای بود، کارت Jikan هم اضافه می‌شود
```

- حافظه: `ai_conversations` با `trim_conversation` (حداکثر پیام‌های تنظیم‌شده).
- سلامت: `ai_state` وضعیت `ok/quota_exhausted/error/disabled` و `next_retry_at` را نگه می‌دارد.
- Scheduler در صورت خطا، با backoff تا ۶ ساعت دوباره تست می‌کند.
- Fallback هیچ داده‌ی کاربری ندارد و پاسخ‌ها ثابت و امن‌اند.

---

## ارسال همگانی

- `enqueue_broadcast` گیرندگان واجد شرط (opt-in، غیربن، غیرربات) را در `broadcast_logs` می‌ریزد.
- فقط یک کمپین `running` به‌لطف index یکتا وجود دارد.
- Scheduler هر دقیقه `claim_broadcast_batch` را صدا می‌زند: `FOR UPDATE SKIP LOCKED` + وضعیت `sending` + `attempts`.
- claimهای قدیمی با `reset_stale_broadcast_claims` آزاد می‌شوند.
- `pause` / `resume` / `cancel` از داشبورد؛ runner در هر تکرار وضعیت را دوباره می‌خواند.
- خطای پیاپی بیش از حد → توقف خودکار و ثبت دلیل.
- خطای «کاربر ربات را بلاک کرده» ناموفق دائمی است؛ خطای موقت با سقف تلاش.

---

## تبلیغات، پست و محتوا

- Scheduler با `claim_due_advertisements` / `claim_due_scheduled_posts` / `claim_due_content_posts` هر ردیف را lease می‌کند (`claimed_at`، ۱۰ دقیقه) تا دو اجرای هم‌زمان چیزی را دوبار نفرستند.
- تبلیغ: حداقل فاصله‌ی تنظیم‌شده، تکرار، شمارش موفق/خطا، توقف خودکار روی خطای دائمی.
- پست زمان‌بندی‌شده: حداکثر ۳ تلاش، سپس `failed`؛ تکرار با محاسبه‌ی `nextOccurrence`.
- محتوا: پس از انتشار، شمارش بازدید و سنجاق اختیاری؛ خطا پس از ۳ تلاش به `draft` برمی‌گردد.

---

## امنیت و حریم خصوصی

- Clé/service role فقط سمت سرور؛ هیچ کلیدی در کلاینت یا callback نیست.
- RLS همه‌جا؛ `anon`/`authenticated` هیچ دسترسی نوشتنی ندارند و فقط محتوای منتشرشده خواندنی است.
- Secretها با مقایسه‌ی زمان-ثابت بررسی می‌شوند.
- متن پیام‌های کاربران ذخیره نمی‌شود؛ فقط چت AI برای حافظه و با امکان حذف.
- `/deletedata` کل ردیف کاربر و وابستگی‌ها را حذف می‌کند و `ai_usage` را بی‌نام می‌کند.
- مالک اصلی از `SUPER_ADMIN_IDS` می‌آید و در دیتابیس قابل حذف/تنزل نیست.
- هر تغییر حساس در `admin_actions` و `system_logs` ثبت می‌شود.

### محدودیت‌های شناخته‌شده

- محدودیت نرخ درون‌ایزوله است (بدون Redis)؛ بین چند isolate دقیق نیست. سقف روزانه AI در DB اتمیک است.
- Telegram API برای ارسال کانال idempotency key ندارد؛ lease پنجره‌ی تکرار را کم می‌کند، ولی قطعی کامل نیست.
- دقت زمان‌بندی cron یک دقیقه است.
- ارسال همگانی به محدودیت نرخ تلگرام (~۳۰ پیام/ثانیه) وابسته است و با delay تنظیم می‌شود.
