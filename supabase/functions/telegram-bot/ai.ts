/** 🤖 مدیریت هوش مصنوعی + چت کاربر + Smart Fallback. */
import { countRows, selectRows } from "../_shared/db.ts";
import {
  aiUsageToday,
  answerQuestion,
  getAiState,
  isFallbackActive,
  resetAiState,
  testAiConnection,
} from "../_shared/ai_core.ts";
import { fallbackCategories, fallbackCount } from "../_shared/ai_fallback.ts";
import { type Button, keyboard } from "../_shared/keyboards.ts";
import { divider, faDateTime, faNum, sectionTitle, statusLabel } from "../_shared/texts.ts";
import { startOfDayIso } from "../_shared/rate_limit.ts";
import { escapeHtml, truncate } from "../_shared/validation.ts";
import {
  answerCallback,
  askForInput,
  type Ctx,
  editOrSend,
  guardAdmin,
  logAdminAction,
  send,
  sessionTtl,
} from "./context.ts";
import { startSession } from "../_shared/sessions.ts";

export async function renderAiPanel(ctx: Ctx): Promise<void> {
  const timeZone = await ctx.settings.get("timezone");
  const [
    state,
    enabled,
    feature,
    model,
    dailyLimit,
    memory,
    cooldown,
    groupLimit,
    groupCooldown,
    usage,
  ] = await Promise.all([
    getAiState(ctx.sb),
    ctx.settings.get("ai_enabled"),
    ctx.settings.get("feature_ai"),
    ctx.settings.get("ai_model"),
    ctx.settings.get("ai_daily_limit"),
    ctx.settings.get("ai_memory_messages"),
    ctx.settings.get("ai_fallback_cooldown_seconds"),
    ctx.settings.get("ai_group_daily_limit"),
    ctx.settings.get("ai_group_cooldown_seconds"),
    aiUsageToday(ctx.sb, timeZone),
  ]);

  const fallbackActive = isFallbackActive(state);
  const text = [
    sectionTitle("🤖 مدیریت هوش مصنوعی"),
    divider(),
    `وضعیت سرویس: ${statusLabel("ai", state.status)}${
      fallbackActive ? " (پاسخ‌های جایگزین فعال)" : ""
    }`,
    `ماژول AI: ${feature ? "🟢" : "🔴"} • فعال بودن: ${enabled ? "🟢" : "🔴"}`,
    `مدل: <code>${escapeHtml(model)}</code>`,
    `سرویس هوش مصنوعی: ${ctx.cfg.geminiApiKey ? "✅ وصل" : "❌ وصل نشده (پاسخ‌های سریع داخلی)"}`,
    "",
    "<b>امروز</b>",
    `درخواست: ${faNum(usage.requests)} • جایگزین: ${faNum(usage.fallbacks)}`,
    `سهمیه/محدودیت: ${faNum(usage.quota)} • خطا: ${faNum(usage.errors)}`,
    "",
    "<b>پاسخ‌های سریع داخلی</b>",
    `پاسخ‌های ذخیره‌شده: <b>${faNum(fallbackCount())}</b> در ${
      faNum(fallbackCategories().length)
    } دسته`,
    `فاصلهٔ تلاش مجدد: ${faNum(cooldown)} ثانیه`,
    `آخرین موفقیت: ${faDateTime(state.last_success_at, timeZone)}`,
    state.last_error ? `⚠️ آخرین خطا: ${escapeHtml(truncate(state.last_error, 150))}` : "",
    state.next_retry_at ? `⏭ تلاش بعدی: ${faDateTime(state.next_retry_at, timeZone)}` : "",
    "",
    `سقف روزانه چت خصوصی: ${faNum(dailyLimit)} • حافظه: ${faNum(memory)} پیام`,
    `در گروه، برای هر نفر: ${faNum(groupLimit)} پاسخ در روز • فاصلهٔ پاسخ: ${
      faNum(groupCooldown)
    } ثانیه`,
  ].filter(Boolean).join("\n");

  const rows: Button[][] = [
    [
      {
        text: `هوش مصنوعی: ${enabled ? "🟢 خاموش کن" : "🔴 روشن کن"}`,
        callback_data: "a:ai:t",
        style: enabled ? "danger" : "success",
      },
      { text: "🧪 تست اتصال", callback_data: "a:ai:h", style: "primary" },
    ],
    [
      { text: "✏️ شخصیت ربات", callback_data: "a:ai:pe", style: "primary" },
      { text: "🔢 سقف روزانه", callback_data: "a:ai:l", style: "primary" },
    ],
    [
      { text: "🧠 مدل", callback_data: "a:ai:m", style: "primary" },
      { text: "🧹 ریست وضعیت", callback_data: "a:ai:r", style: "primary" },
    ],
    [
      { text: "📊 مصرف امروز", callback_data: "a:ai:u", style: "primary" },
      { text: "🧩 دسته‌های پاسخ سریع", callback_data: "a:ai:f", style: "primary" },
    ],
    [
      {
        text: `👥 سقف روزانهٔ هر کاربر در گروه: ${faNum(groupLimit)}`,
        callback_data: "a:ai:gd",
        style: "primary",
      },
    ],
    [
      {
        text: `⏱ فاصلهٔ زمانی پاسخ در گروه: ${faNum(groupCooldown)} ثانیه`,
        callback_data: "a:ai:gc",
        style: "primary",
      },
    ],
    [
      {
        text: "🧠 حافظه: " + (memory > 0 ? "🟢" : "🔴"),
        callback_data: "a:ai:mem",
        style: "primary",
      },
      { text: "🏠 داشبورد", callback_data: "a:h", style: "success" },
    ],
  ];
  await editOrSend(ctx, text, keyboard(rows));
}

async function renderUsage(ctx: Ctx): Promise<void> {
  const timeZone = await ctx.settings.get("timezone");
  const since = startOfDayIso(timeZone, ctx.now);
  const rows = await selectRows<{ status: string; request_type: string; latency_ms: number }>(
    ctx.sb,
    "ai_usage",
    (q) => q.gte("created_at", since).limit(500),
  );
  const summary = await aiUsageToday(ctx.sb, timeZone);
  const avg = rows.filter((row) => row.status === "success");
  const avgLatency = avg.length > 0
    ? Math.round(avg.reduce((sum, row) => sum + row.latency_ms, 0) / avg.length)
    : 0;

  await editOrSend(
    ctx,
    [
      sectionTitle("📊 مصرف هوش مصنوعی امروز"),
      divider(),
      `کل درخواست قابل پاسخ: ${faNum(summary.requests)}`,
      `پاسخ هوشمند: ${faNum(summary.requests - summary.fallbacks)}`,
      `پاسخ سریع داخلی: ${faNum(summary.fallbacks)}`,
      `سهمیه تمام/محدودیت: ${faNum(summary.quota)}`,
      `خطا: ${faNum(summary.errors)}`,
      `میانگین تأخیر موفق: ${faNum(avgLatency)}ms`,
      `تعداد رکوردهای امروز: ${faNum(rows.length)}`,
    ].join("\n"),
    keyboard([
      [{ text: "🔄 به‌روزرسانی", callback_data: "a:ai:u" }],
      [{ text: "◀️ بازگشت", callback_data: "a:ai" }],
    ]),
  );
}

async function renderFallbackCategories(ctx: Ctx): Promise<void> {
  const counts = new Map<string, number>();
  for (const category of fallbackCategories()) counts.set(category, 0);
  const { FALLBACK_ENTRIES } = await import("../_shared/fallback_data.ts");
  for (const entry of FALLBACK_ENTRIES) {
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }
  const lines = [...counts.entries()].map(([category, count]) => `• ${category}: ${faNum(count)}`);
  await editOrSend(
    ctx,
    [
      sectionTitle("🧩 دسته‌های پاسخ سریع"),
      divider(),
      ...lines,
      divider(),
      `مجموع: ${faNum(fallbackCount())} پاسخ ذخیره‌شده`,
      "",
      "<i>این پاسخ‌ها وقتی سرویس هوش مصنوعی در دسترس نباشد یا سهمیه تمام شود استفاده می‌شوند تا ربات از کار نیفتد.</i>",
    ].join("\n"),
    keyboard([
      [{ text: "◀️ بازگشت", callback_data: "a:ai" }],
    ]),
  );
}

export async function handleAiCallback(ctx: Ctx, parts: string[]): Promise<boolean> {
  if (parts[1] !== "ai") return false;
  const sub = parts[2];

  if (!sub) {
    if (!(await guardAdmin(ctx, "ai.read"))) return true;
    await renderAiPanel(ctx);
    return true;
  }

  if (sub === "u") {
    if (!(await guardAdmin(ctx, "ai.read"))) return true;
    await renderUsage(ctx);
    return true;
  }

  if (sub === "f") {
    if (!(await guardAdmin(ctx, "ai.read"))) return true;
    await renderFallbackCategories(ctx);
    return true;
  }

  if (sub === "t") {
    if (!(await guardAdmin(ctx, "ai.manage"))) return true;
    const enabled = await ctx.settings.get("ai_enabled");
    await ctx.settings.set("ai_enabled", !enabled, ctx.userId);
    await logAdminAction(ctx, "ai_toggle", "ai", undefined, { enabled: !enabled });
    await answerCallback(ctx, !enabled ? "هوش مصنوعی روشن شد." : "هوش مصنوعی خاموش شد.");
    await renderAiPanel(ctx);
    return true;
  }

  if (sub === "mem") {
    if (!(await guardAdmin(ctx, "ai.manage"))) return true;
    const memory = await ctx.settings.get("ai_memory_messages");
    const next = memory > 0 ? 0 : 12;
    await ctx.settings.set("ai_memory_messages", next, ctx.userId);
    await logAdminAction(ctx, "ai_memory_toggle", "ai", undefined, { memory: next });
    await answerCallback(ctx, next > 0 ? "حافظه فعال شد." : "حافظه غیرفعال شد.");
    await renderAiPanel(ctx);
    return true;
  }

  if (sub === "h") {
    if (!(await guardAdmin(ctx, "ai.manage"))) return true;
    const result = await testAiConnection({ sb: ctx.sb, settings: ctx.settings, cfg: ctx.cfg });
    await logAdminAction(ctx, "ai_test", "ai", undefined, { ok: result.ok });
    await editOrSend(
      ctx,
      [
        sectionTitle("🧪 تست اتصال هوش مصنوعی"),
        divider(),
        result.ok ? "✅ اتصال برقرار است." : "❌ اتصال برقرار نشد.",
        result.message,
        `زمان: ${faNum(result.latencyMs)}ms`,
        "",
        "<i>اگر سهمیه تمام شود، ربات با پاسخ‌های سریع داخلی ادامه می‌دهد و بعداً دوباره تلاش می‌کند.</i>",
      ].join("\n"),
      keyboard([
        [{ text: "🔄 تست مجدد", callback_data: "a:ai:h" }],
        [{ text: "◀️ بازگشت", callback_data: "a:ai" }],
      ]),
    );
    return true;
  }

  if (sub === "r") {
    if (!(await guardAdmin(ctx, "ai.manage"))) return true;
    await resetAiState(ctx.sb);
    await logAdminAction(ctx, "ai_state_reset", "ai");
    await answerCallback(ctx, "وضعیت هوش مصنوعی از نو تنظیم شد.");
    await renderAiPanel(ctx);
    return true;
  }

  if (sub === "pe" || sub === "l" || sub === "m" || sub === "gd" || sub === "gc") {
    if (!(await guardAdmin(ctx, "ai.manage"))) return true;
    const map: Record<
      string,
      {
        key:
          | "ai_persona"
          | "ai_daily_limit"
          | "ai_model"
          | "ai_group_daily_limit"
          | "ai_group_cooldown_seconds";
        label: string;
        hint: string;
      }
    > = {
      pe: {
        key: "ai_persona",
        label: "شخصیت AI",
        hint: "متن شخصیت ربات را بفرستید.",
      },
      l: {
        key: "ai_daily_limit",
        label: "سقف روزانهٔ هوش مصنوعی (چت خصوصی)",
        hint: "یک عدد بین ۰ تا ۱۰۰۰ بفرستید (۰ = بدون محدودیت).",
      },
      gd: {
        key: "ai_group_daily_limit",
        label: "سقف روزانهٔ هوش مصنوعی در گروه (برای هر کاربر)",
        hint: "یک عدد بین ۰ تا ۱۰۰ بفرستید (۰ = بدون محدودیت).",
      },
      gc: {
        key: "ai_group_cooldown_seconds",
        label: "فاصلهٔ زمانی پاسخ هوش مصنوعی در گروه",
        hint: "یک عدد بین ۰ تا ۳۶۰۰ ثانیه بفرستید (۰ = بدون فاصله).",
      },
      m: {
        key: "ai_model",
        label: "مدل هوش مصنوعی",
        hint: "نام مدل را بفرستید.",
      },
    };
    const target = map[sub];
    await askForInput(
      ctx,
      "admin_setting",
      [
        `✏️ <b>${target.label}</b>`,
        target.hint,
        "مقدار جدید را بفرستید.",
      ].join("\n"),
      { key: target.key },
      "a:ai",
    );
    return true;
  }

  await answerCallback(ctx, "اقدام ناشناخته است.", true);
  return true;
}

// ─── user chat ───────────────────────────────────────────────────────────────

export async function startUserChat(ctx: Ctx): Promise<void> {
  const feature = await ctx.settings.get("feature_ai");
  const enabled = await ctx.settings.get("ai_enabled");
  if (!feature || !enabled) {
    await send(ctx, "🤖 ماژول چت هوشمند فعلاً غیرفعال است. می‌توانی از /anime یا /news استفاده کنی.");
    return;
  }

  await startSession(
    ctx.sb,
    ctx.userId,
    ctx.chatId,
    "ai_chat",
    {},
    await sessionTtl(ctx),
  );

  const limit = await ctx.settings.get("ai_daily_limit");
  await send(
    ctx,
    [
      "🤖 <b>حالت چت هوشمند فعال شد</b>",
      "",
      "سوالت را بنویس تا پاسخ بدهم.",
      `سقف روزانه: ${faNum(limit)} درخواست.`,
      "",
      "<i>برای خروج /cancel را بفرستید.</i>",
    ].join("\n"),
    keyboard([
      [
        { text: "🧹 پاک‌کردن حافظه", callback_data: "u:mm" },
        { text: "🏠 منوی اصلی", callback_data: "u:m" },
      ],
    ]),
  );
}

export async function handleUserAiMessage(ctx: Ctx, text: string): Promise<void> {
  const timeZone = await ctx.settings.get("timezone");
  const perMinute = await ctx.settings.get("user_rate_limit_per_minute");
  const decision = ctx.limiter.hit(`ai:${ctx.userId}`, perMinute, 60_000, ctx.now.getTime());
  if (!decision.allowed) {
    await send(
      ctx,
      `⏳ کمی آرام‌تر! تا ${
        faNum(Math.ceil(decision.retryAfterMs / 1000))
      } ثانیه دیگر دوباره تلاش کن.`,
    );
    return;
  }

  const limit = await ctx.settings.get("ai_daily_limit");
  const used = await countRows(ctx.sb, "ai_usage", (q) =>
    q.eq("user_id", ctx.userId)
      .eq("request_type", "chat")
      .gte("created_at", startOfDayIso(timeZone, ctx.now)));

  // نشانگر «در حال تایپ» جای پیام «در حال فکر کردن» تا پاسخ بی‌معطلی برسد.
  try {
    await ctx.tg.call("sendChatAction", { chat_id: ctx.chatId, action: "typing" });
  } catch {
    // نشانگر تایپ اختیاری است
  }

  const reply = await answerQuestion(
    { sb: ctx.sb, settings: ctx.settings, cfg: ctx.cfg },
    {
      userId: ctx.userId,
      text,
      memoryEnabled: ctx.user.ai_memory_enabled,
    },
  );

  const footer: string[] = [];
  if (!reply.quotaExhausted && used + 1 >= limit && limit > 0) {
    footer.push(`<i>این آخرین درخواست امروز شما بود.</i>`);
  }

  await send(
    ctx,
    [reply.text, ...footer].join("\n\n"),
    keyboard([
      [
        { text: "🧹 پاک‌کردن حافظه", callback_data: "u:mm" },
        { text: "🏠 منوی اصلی", callback_data: "u:m" },
      ],
    ]),
  );
}

export async function handleOneShotAi(ctx: Ctx, text: string): Promise<void> {
  if (text.trim().length === 0) {
    await startUserChat(ctx);
    return;
  }
  await handleUserAiMessage(ctx, text);
}
