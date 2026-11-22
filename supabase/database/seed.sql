-- =============================================================================
-- Anime Click Ultimate — Default settings & seed data
-- تمام مقادیر از داشبورد تلگرام (⚙️ تنظیمات) قابل تغییرند.
-- =============================================================================
begin;

insert into public.bot_settings (key, value, description) values
  ('maintenance_mode',        'false'::jsonb,                          'حالت تعمیر و نگهداری (فقط مالک دسترسی دارد)'),
  ('maintenance_text',        '"🛠 ربات موقتاً در حال به‌روزرسانی است. لطفاً کمی بعد دوباره تلاش کنید."'::jsonb, 'پیام حالت تعمیر'),
  ('welcome_text',            '"🌸 به **Anime Click Ultimate** خوش آمدی!\n\nاز منوی زیر می‌توانی چت هوشمند، جستجوی انیمه و آخرین خبرها را ببینی."'::jsonb, 'پیام خوش‌آمد خصوصی'),
  ('channel_target',          '"@clickanime128"'::jsonb,               'کانال پیش‌فرض انتشار (یوزرنیم یا -100...)'),
  ('channel_url',             '"https://t.me/clickanime128"'::jsonb,   'لینک کانال'),
  ('group_url',               '""'::jsonb,                             'لینک گروه پشتیبانی'),
  ('support_username',        '"@Spixle_bot"'::jsonb,                  'پشتیبانی'),
  ('ai_enabled',              'true'::jsonb,                           'فعال بودن هوش مصنوعی'),
  ('ai_persona',              '"تو دستیار فارسی‌زبان «Anime Click» هستی؛ خوش‌برخورد، دقیق و مختصر جواب بده و درباره انیمه اطلاعات درست بده. اگر مطمئن نیستی حدس نزن."'::jsonb, 'شخصیت AI'),
  ('ai_model',                '"gemini-2.0-flash"'::jsonb,             'مدل Gemini'),
  ('ai_daily_limit',          '25'::jsonb,                             'سقف درخواست AI هر کاربر در روز'),
  ('ai_memory_messages',      '12'::jsonb,                             'تعداد پیام‌های حافظه مکالمه'),
  ('ai_memory_enabled',       'true'::jsonb,                           'حافظه مکالمه فعال باشد'),
  ('ai_fallback_cooldown_seconds', '900'::jsonb,                       'مدت خروج از حالت fallback قبل از تلاش مجدد'),
  ('ai_max_retries',          '1'::jsonb,                              'حداکثر تلاش مجدد در یک درخواست'),
  ('ai_anime_context',        'true'::jsonb,                           'افزودن اطلاعات Jikan به پاسخ AI'),
  ('feature_ai',              'true'::jsonb,                           'ماژول هوش مصنوعی'),
  ('feature_anime',           'true'::jsonb,                           'ماژول انیمه (Jikan)'),
  ('feature_news',            'true'::jsonb,                           'ماژول اخبار'),
  ('feature_ads',             'true'::jsonb,                           'ماژول تبلیغات'),
  ('feature_broadcast',       'true'::jsonb,                           'ماژول ارسال همگانی'),
  ('feature_content',         'true'::jsonb,                           'ماژول محتوا'),
  ('feature_groups',          'true'::jsonb,                           'ماژول مدیریت گروه'),
  ('feature_scheduling',      'true'::jsonb,                           'زمان‌بندی انتشار'),
  ('broadcast_batch_size',    '20'::jsonb,                             'اندازه هر دسته ارسال همگانی'),
  ('broadcast_delay_ms',      '800'::jsonb,                            'فاصله بین پیام‌های همگانی (ms)'),
  ('broadcast_max_fail_streak', '20'::jsonb,                           'توقف خودکار پس از این تعداد خطای پیاپی'),
  ('broadcast_require_confirm','true'::jsonb,                          'تأیید نهایی مدیر برای ارسال همگانی'),
  ('ads_label',               '"تبلیغ"'::jsonb,                        'برچسب شناسایی تبلیغ'),
  ('ads_default_target',      '""'::jsonb,                             'مقصد پیش‌فرض تبلیغ (خالی = کانال)'),
  ('ads_min_interval_minutes','30'::jsonb,                             'حداقل فاصله تبلیغات در کانال'),
  ('session_ttl_minutes',     '30'::jsonb,                             'انقضای گفت‌وگوی چندمرحله‌ای'),
  ('user_rate_limit_per_minute',  '20'::jsonb,                         'سقف پیام کاربر در دقیقه'),
  ('admin_rate_limit_per_minute', '60'::jsonb,                         'سقف اقدام مدیر در دقیقه'),
  ('data_retention_days',     '90'::jsonb,                             'نگه‌داری لاگ‌ها (روز)'),
  ('weekly_report_enabled',   'true'::jsonb,                           'گزارش هفتگی خودکار'),
  ('weekly_report_day',       '5'::jsonb,                              'روز هفته گزارش (0=یکشنبه ... 5=جمعه)'),
  ('weekly_report_hour',      '20'::jsonb,                             'ساعت گزارش هفتگی (به وقت تهران)'),
  ('daily_stats_enabled',     'true'::jsonb,                           'تجمیع آمار روزانه'),
  ('timezone',                '"Asia/Tehran"'::jsonb,                  'منطقه زمانی نمایش'),
  ('bot_version',             '"1.0.0"'::jsonb,                        'نسخه')
on conflict (key) do nothing;

insert into public.content_categories (slug, title) values
  ('news',    'اخبار'),
  ('review',  'نقد و بررسی'),
  ('guide',   'راهنما'),
  ('release', 'انتشارات')
on conflict (slug) do nothing;

commit;
