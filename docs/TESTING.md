# تست‌ها و نتایج

## اجرا

```bash
# ۱) دیتابیس (PGlite؛ Node)
npm install --no-save --no-package-lock @electric-sql/pglite
node scripts/verify-database.mjs

# ۲) type-check سه entrypoint + تست‌ها
deno task check

# ۳) lint
deno task lint

# ۴) تست‌های واحد
deno task test

# ۵) فرمت
deno task fmt:check
```

---

## نتیجه‌ی آخرین اجرا

| دستور | نتیجه |
| --- | --- |
| `node scripts/verify-database.mjs` | **۶۶ passed / ۰ failed** |
| `deno task check` | بدون خطا |
| `deno task lint` | بدون خطا (۵۷ فایل) |
| `deno task test` | **۷۰ passed / ۰ failed** |
| `deno task fmt:check` | بدون خطا |

---

## پوشش تست‌ها

### `tests/validation_test.ts` (۱۲ تست)

- escape HTML، نرمال‌سازی ارقام فارسی/عربی
- شناسه‌ی تلگرام، `@username`، لینک `t.me`، شناسه‌ی عددی
- اعتبار URL (شامل رد `javascript:`)
- دکمه‌های inline: تعداد، خطا، URL نامعتبر
- زمان‌بندی: `now`، نسبی (`2h`)، مطلق، ساعت روز، گذشته، ورودی نامعتبر
- منطقه‌ی زمانی ایران (+03:30) و روز محلی
- محدودیت ۶۴ بایت callback

### `tests/wizard_test.ts` (۷ تست)

- شروع، پیشرفت با ارقام فارسی، اجباری/اختیاری
- طول متن، بازه‌ی عدد، گزینه با value/label/index
- back و حذف مقدار قبلی
- skip فقط برای اختیاری
- اعتبارسنجی URL/target/buttons
- تکمیل و ذخیره‌ی زمان

### `tests/fallback_test.ts` (۱۱ تست)

- حداقل ۱۰۰ پاسخ و یکتایی شناسه‌ها
- دسته‌های ضروری (greeting، recommendation، title_info، ...)
- نرمال‌سازی فارسی/عربی/انگلیسی و ارقام
- تشخیص زبان (فارسی حتی در متن ترکیبی)
- تطبیق سلام، پیشنهاد ژانر، پرسش عنوان، پرسش انگلیسی
- عدم تطبیق برای رشته‌ی بی‌معنی
- پاسخ عمومی امن

### `tests/auth_test.ts` (۶ تست)

- ماتریس نقش‌ها و مجوزها
- SUPER_ADMIN → owner با همه‌ی مجوزها
- مدیر inactive → بدون دسترسی
- مجوز اضافی و حذف مجوز نامعتبر
- محافظت از owner/super_admin در `canManageRole`
- مقایسه‌ی زمان-ثابت و بررسی Secret
- کش `GroupAdminChecker`

### `tests/keyboards_test.ts` (۶ تست)

- ۱۳ بخش داشبورد برای مالک
- فیلتر بر اساس مجوز (moderator بدون تنظیمات/ابزار)
- فیلتر ماژول‌های خاموش (AI/تبلیغات)
- محدودیت ۶۴ بایت همه‌ی callbackها
- منوی کاربر و URLها
- ساختار ردیف‌ها، toggle و back

### `tests/telegram_test.ts` (۵ تست)

- split متن طولانی و حفظ محتوا
- ارسال HTML و `link_preview_options`
- retry روی 429 با `retry_after`
- تفکیک «بلاک‌شده» و «message is not modified»
- عدم افشای توکن در خطا

### `tests/moderation_test.ts` (۴ تست)

- تشخیص URL، `t.me`، mention و entity
- `parseGroupCommand` با `@Spixle_bot`، ربات دیگر، آرگومان‌ها
- حساسیت به حروف و trim

### `tests/anime_format_test.ts` (۴ تست)

- کارت انیمه: عنوان/امتیاز/استودیو/escape
- لیست شماره‌دار
- callbackهای کوتاه `u:an:<id>`
- پاک‌سازی عبارت جستجو

### `tests/stats_test.ts` (۶ تست)

- مرزهای روز تهران در UTC
- shift روز و سال کبیسه
- نمودار و درصد
- رندر آمار کلی و سری ۷ روزه

### `tests/registration_test.ts` (۳ تست)

- ثبت هر ۵ wizard (تبلیغ، همگانی، زمان‌بندی، ایجاد/ویرایش محتوا)
- فیلد/مجوز/returnTo برای هر wizard
- وجود مسیر مجوز برای هر بخش داشبورد

### `tests/sql_test.ts` (۶ تست)

- وجود ۲۴ جدول
- constraintها، indexها و RPCها (شامل claimهای اتمی)
- RLS روی همه‌جا و نبود grant حساس
- نبود JWT/توکن ربات/کلید Google در فایل‌ها
- تنظیمات و دسته‌های seed
- استفاده‌ی cron از Vault و نبود Secret hardcode

### `scripts/verify-database.mjs` (۶۶ چک)

- اجرای کامل schema/policies/seed در PGlite
- کاربر، admins، بن، گروه، اخطار
- صف همگانی، claim اتمی، reset claim، تک‌کمپین
- claim اتمی تبلیغ/پست/محتوا (اجرای دوم صفر ردیف)
- آمار روزانه و فعالیت روزانه
- محتوا، search_vector، constraint زمان
- session، retention، حذف کاربر و بی‌نام‌سازی AI

---

## آنچه شبیه‌سازی یا تست نشده است

این محیط به Supabase، Telegram و Gemini دسترسی ندارد. بنابراین موارد زیر **ادعای تست‌شده ندارند**:

- deploy واقعی توابع و اجرای SQL روی پروژه‌ی Supabase
- دریافت Webhook واقعی از تلگرام و تأیید هدر Secret در محیط زنده
- ارسال واقعی پیام/مدیا/سند به کانال یا کاربر
- پاسخ واقعی Gemini و رفتار 429 واقعی
- درخواست واقعی به Jikan (تست‌ها از fixture استفاده می‌کنند)
- محدودیت نرخ واقعی تلگرام در ارسال همگانی
- pg_cron/net واقعی (SQL آن استاتیک بررسی شده است)
- UI تلگرام در دستگاه واقعی (فقط منطق keyboard/text تست شده)
- بار هم‌زمان چند isolate (claimهای DB تست شده‌اند، اما اجرای موازی واقعی نه)

پس از استقرار، چک‌لیست [DEPLOYMENT.md](DEPLOYMENT.md#۷-چکلیست-پس-از-استقرار) را اجرا کنید.
