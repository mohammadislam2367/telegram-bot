/** 📢 مدیریت تبلیغات — ساخت، پیش‌نمایش، ارسال، زمان‌بندی، فعال/غیرفعال. */
import {
  callRpc,
  countRows,
  deleteRows,
  insertRow,
  selectOne,
  selectRows,
  updateRows,
} from "../_shared/db.ts";
import { type Button, keyboard, paginationRow } from "../_shared/keyboards.ts";
import {
  parseStoredButtons,
  publishAdvertisement,
  sendRichMessage,
} from "../_shared/publishers.ts";
import { divider, faDateTime, faNum, sectionTitle, statusLabel } from "../_shared/texts.ts";
import { escapeHtml, truncate } from "../_shared/validation.ts";
import type { WizardDefinition } from "../_shared/wizard.ts";
import type { AdRow, MediaType } from "../_shared/types.ts";
import {
  answerCallback,
  askConfirm,
  type Ctx,
  editOrSend,
  guardAdmin,
  logAdminAction,
  send,
} from "./context.ts";
import { beginWizard, registerWizard } from "./wizard_flow.ts";

const PAGE_SIZE = 5;

const MEDIA_CHOICES = [
  { value: "none", label: "بدون مدیا" },
  { value: "photo", label: "عکس" },
  { value: "video", label: "ویدیو" },
  { value: "animation", label: "گیف" },
  { value: "document", label: "فایل" },
] as const;

const REPEAT_CHOICES = [
  { value: "none", label: "یک‌بار" },
  { value: "daily", label: "روزانه" },
  { value: "weekly", label: "هفتگی" },
  { value: "monthly", label: "ماهانه" },
] as const;

export const AD_WIZARD: WizardDefinition = {
  id: "ad_create",
  title: "📢 ساخت تبلیغ جدید",
  fields: [
    {
      key: "title",
      label: "عنوان تبلیغ",
      prompt: "عنوان فقط برای مدیریت داخلی است و در کانال نمایش داده نمی‌شود.",
      kind: "text",
      minLength: 2,
      maxLength: 120,
    },
    {
      key: "body",
      label: "متن تبلیغ",
      prompt: "متن اصلی که در کانال منتشر می‌شود (بدون HTML؛ برچسب تبلیغ خودکار اضافه می‌شود).",
      kind: "paragraph",
      minLength: 3,
      maxLength: 3000,
    },
    {
      key: "media_type",
      label: "نوع مدیا",
      prompt: "یکی از گزینه‌ها را انتخاب کنید.",
      kind: "choice",
      choices: MEDIA_CHOICES,
    },
    {
      key: "media_file_id",
      label: "file_id مدیا",
      prompt:
        "اگر مدیا انتخاب کرده‌اید، file_id تلگرام را بفرستید؛ در غیر این صورت <code>-</code> بزنید.",
      kind: "text",
      required: false,
      maxLength: 400,
    },
    {
      key: "buttons",
      label: "دکمه‌های شیشه‌ای (اختیاری)",
      prompt:
        "هر دکمه در یک خط با قالب <code>متن | https://link</code>؛ حداکثر ۳ دکمه. برای رد کردن <code>-</code>.",
      kind: "buttons",
      required: false,
    },
    {
      key: "target",
      label: "مقصد انتشار (اختیاری)",
      prompt: "یوزرنیم کانال/گروه یا شناسه‌ی -100...؛ برای استفاده از کانال پیش‌فرض <code>-</code>.",
      kind: "telegram_target",
      required: false,
    },
    {
      key: "scheduled_at",
      label: "زمان انتشار",
      prompt:
        "مثال: <code>now</code>، <code>2h</code>، <code>2026-03-21 20:30</code>. برای ذخیره بدون زمان <code>-</code>.",
      kind: "schedule",
      required: false,
    },
    {
      key: "repeat_interval",
      label: "تکرار",
      prompt: "آیا تبلیغ تکرار شود؟",
      kind: "choice",
      choices: REPEAT_CHOICES,
    },
  ],
  validate: (data) => {
    const media = String(data.media_type ?? "none");
    const fileId = data.media_file_id ? String(data.media_file_id) : "";
    if (media !== "none" && fileId.trim().length < 5) {
      return "برای مدیای انتخاب‌شده، file_id لازم است.";
    }
    return null;
  },
};

function adPreviewText(ad: AdRow, label: string): string {
  const buttons = parseStoredButtons(ad.buttons);
  return [
    "<b>👁 پیش‌نمایش تبلیغ</b>",
    divider(),
    ad.label_enabled ? `🔹 <b>${escapeHtml(label)}</b>\n` : "",
    escapeHtml(ad.body),
    "",
    divider(),
    `📌 عنوان داخلی: ${escapeHtml(ad.title)}`,
    `🎯 مقصد: <code>${escapeHtml(ad.target_chat ?? "کانال پیش‌فرض")}</code>`,
    `🗓 زمان: ${ad.scheduled_at ? faDateTime(ad.scheduled_at) : "ارسال دستی"}`,
    `🔁 تکرار: ${ad.repeat_interval}`,
    buttons.length > 0
      ? `🔗 دکمه‌ها:\n${buttons.map((b) => `• ${escapeHtml(b.text)} → ${b.url}`).join("\n")}`
      : "",
    ad.media_type !== "none" ? `🖼 مدیا: ${ad.media_type}` : "",
    "",
    "<i>این پیش‌نمایش هنوز منتشر نشده است.</i>",
  ].filter(Boolean).join("\n");
}

function adViewText(ad: AdRow): string {
  const buttons = parseStoredButtons(ad.buttons);
  return [
    `<b>📢 تبلیغ: ${escapeHtml(ad.title)}</b>`,
    divider(),
    `وضعیت: ${statusLabel("ad", ad.status)}`,
    `مقصد: <code>${escapeHtml(ad.target_chat ?? "کانال پیش‌فرض")}</code>`,
    `زمان: ${ad.scheduled_at ? faDateTime(ad.scheduled_at) : "دستی"}`,
    `تکرار: ${ad.repeat_interval}`,
    `ارسال موفق: ${faNum(ad.sent_count)} • خطا: ${faNum(ad.error_count)}`,
    ad.last_sent_at ? `آخرین ارسال: ${faDateTime(ad.last_sent_at)}` : "",
    ad.last_error ? `⚠️ آخرین خطا: ${escapeHtml(truncate(ad.last_error, 200))}` : "",
    "",
    "<b>متن:</b>",
    escapeHtml(ad.body),
    buttons.length > 0
      ? `\n<b>دکمه‌ها:</b>\n${buttons.map((b) => `• ${escapeHtml(b.text)} → ${b.url}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n");
}

function adKeyboard(ad: AdRow): ReturnType<typeof keyboard> {
  const rows = [];
  if (ad.status !== "active") {
    rows.push([{ text: "✅ فعال‌سازی / زمان‌بندی", callback_data: `a:ad:on:${ad.id}` }]);
  } else {
    rows.push([{ text: "⏸ غیرفعال‌کردن", callback_data: `a:ad:off:${ad.id}` }]);
  }
  rows.push([
    { text: "🚀 ارسال فوری به کانال", callback_data: `a:ad:send:${ad.id}` },
    { text: "👁 ارسال تست به من", callback_data: `a:ad:test:${ad.id}` },
  ]);
  rows.push([
    { text: "🗑 حذف", callback_data: `a:ad:d:${ad.id}` },
    { text: "📋 لیست تبلیغات", callback_data: "a:ad" },
  ]);
  rows.push([{ text: "🏠 داشبورد", callback_data: "a:h" }]);
  return keyboard(rows);
}

async function renderList(ctx: Ctx, page: number, filter = "all"): Promise<void> {
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const ads = await selectRows<AdRow>(ctx.sb, "advertisements", (q) => {
    let query = q.order("created_at", { ascending: false }).range(from, to);
    if (filter !== "all") query = query.eq("status", filter);
    return query;
  });
  const total = await countRows(
    ctx.sb,
    "advertisements",
    (q) => filter === "all" ? q : q.eq("status", filter),
  );

  const lines = ads.map((ad) =>
    [
      `• <b>${escapeHtml(truncate(ad.title, 40))}</b> ${statusLabel("ad", ad.status)}`,
      `   ${ad.scheduled_at ? `🗓 ${faDateTime(ad.scheduled_at)}` : "ارسال دستی"} • ارسال ${
        faNum(ad.sent_count)
      }${ad.error_count ? ` • خطا ${faNum(ad.error_count)}` : ""}`,
    ].join("\n")
  );

  const rows: Button[][] = ads.map((ad) => [
    { text: `👁 ${truncate(ad.title, 24)}`, callback_data: `a:ad:v:${ad.id}` },
  ]);
  rows.unshift([
    { text: filter === "all" ? "• همه •" : "همه", callback_data: "a:ad:f:all:1" },
    { text: filter === "active" ? "• فعال •" : "فعال", callback_data: "a:ad:f:active:1" },
    { text: filter === "draft" ? "• پیش‌نویس •" : "پیش‌نویس", callback_data: "a:ad:f:draft:1" },
    { text: filter === "paused" ? "• متوقف •" : "متوقف", callback_data: "a:ad:f:paused:1" },
  ]);

  if (ads.length > 0) {
    rows.push(paginationRow(`a:ad:f:${filter}`, page, total > page * PAGE_SIZE));
  }
  rows.push([{ text: "➕ تبلیغ جدید", callback_data: "a:ad:n" }]);
  rows.push([{ text: "🏠 داشبورد", callback_data: "a:h" }]);

  const text = [
    sectionTitle("📢 مدیریت تبلیغات"),
    divider(),
    total === 0 ? "<i>هیچ تبلیغی ثبت نشده است.</i>" : lines.join("\n\n"),
    "",
    `<i>مجموع: ${faNum(total)} تبلیغ • صفحه ${faNum(page)}</i>`,
  ].join("\n");

  await editOrSend(ctx, text, keyboard(rows));
}

async function pubDeps(ctx: Ctx) {
  return { sb: ctx.sb, tg: ctx.tg, settings: ctx.settings };
}

async function publishNow(ctx: Ctx, ad: AdRow): Promise<void> {
  const result = await publishAdvertisement(await pubDeps(ctx), ad);
  if (result.ok) {
    await updateRows(ctx.sb, "advertisements", {
      status: "active",
      sent_count: ad.sent_count + 1,
      last_sent_at: new Date().toISOString(),
      last_error: null,
      scheduled_at: ad.repeat_interval === "none" ? null : ad.scheduled_at,
      updated_at: new Date().toISOString(),
    }, { id: ad.id });
    try {
      await callRpc(ctx.sb, "bump_daily_stat", {
        p_day: new Date().toISOString().slice(0, 10),
        p_field: "ads_sent",
        p_amount: 1,
      });
    } catch {
      // آمار اختیاری است
    }
    await send(ctx, `✅ تبلیغ در <code>${escapeHtml(result.target)}</code> منتشر شد.`);
  } else {
    await updateRows(ctx.sb, "advertisements", {
      error_count: ad.error_count + 1,
      last_error: truncate(result.error ?? "unknown", 500),
      updated_at: new Date().toISOString(),
      ...(result.permanent ? { status: "paused" } : {}),
    }, { id: ad.id });
    await send(
      ctx,
      [
        "⚠️ ارسال تبلیغ ناموفق بود.",
        `خطا: ${escapeHtml(result.error ?? "—")}`,
        result.permanent
          ? "چون خطا دائمی بود، تبلیغ متوقف شد. دسترسی ربات به کانال را بررسی کنید."
          : "تبلیغ فعال مانده و در زمان بعدی دوباره تلاش می‌شود.",
      ].join("\n"),
    );
  }
}

registerWizard({
  definition: AD_WIZARD,
  permission: "ads.manage",
  returnTo: "a:ad",
  onComplete: async (ctx, data) => {
    const mediaType = (data.media_type ?? "none") as MediaType;
    const ad = await insertRow<AdRow>(ctx.sb, "advertisements", {
      title: String(data.title),
      body: String(data.body),
      media_type: mediaType,
      media_file_id: mediaType === "none" ? null : String(data.media_file_id ?? ""),
      buttons: data.buttons ?? [],
      target_chat: data.target ? String(data.target) : null,
      status: "draft",
      scheduled_at: data.scheduled_at ? String(data.scheduled_at) : null,
      repeat_interval: String(data.repeat_interval ?? "none"),
      label_enabled: true,
      created_by: ctx.userId,
    });

    await logAdminAction(ctx, "ad_create", "advertisement", ad.id, {
      title: ad.title,
      scheduled: ad.scheduled_at,
    });

    const label = await ctx.settings.get("ads_label");
    await send(
      ctx,
      adPreviewText(ad, label),
      keyboard([
        [{ text: "✅ ذخیره و ادامه", callback_data: `a:ad:v:${ad.id}` }],
        [{ text: "🗑 حذف این پیش‌نویس", callback_data: `a:ad:d:${ad.id}` }],
      ]),
    );
  },
});

export async function handleAdsCallback(ctx: Ctx, parts: string[]): Promise<boolean> {
  if (parts[1] !== "ad") return false;
  const sub = parts[2];

  if (!sub) {
    if (!(await guardAdmin(ctx, "ads.read"))) return true;
    await renderList(ctx, 1);
    return true;
  }

  if (sub === "n") {
    if (!(await guardAdmin(ctx, "ads.manage"))) return true;
    await beginWizard(ctx, AD_WIZARD.id);
    return true;
  }

  if (sub === "f") {
    if (!(await guardAdmin(ctx, "ads.read"))) return true;
    const filter = parts[3] ?? "all";
    const page = Math.max(Number(parts[4] ?? 1), 1);
    await renderList(ctx, page, filter);
    return true;
  }

  if (sub === "p") {
    if (!(await guardAdmin(ctx, "ads.read"))) return true;
    await renderList(ctx, Math.max(Number(parts[3] ?? 1), 1));
    return true;
  }

  const id = parts[3];
  if (!id) return false;
  const ad = await selectOne<AdRow>(ctx.sb, "advertisements", (q) => q.eq("id", id));
  if (!ad) {
    await answerCallback(ctx, "تبلیغ پیدا نشد.", true);
    return true;
  }

  if (sub === "v") {
    if (!(await guardAdmin(ctx, "ads.read"))) return true;
    await editOrSend(ctx, adViewText(ad), adKeyboard(ad));
    return true;
  }

  if (sub === "on") {
    if (!(await guardAdmin(ctx, "ads.manage"))) return true;
    await askConfirm(
      ctx,
      [
        `✅ <b>فعال‌سازی تبلیغ</b> «${escapeHtml(ad.title)}»`,
        ad.scheduled_at
          ? `در زمان ${faDateTime(ad.scheduled_at)} به‌صورت خودکار ارسال می‌شود.`
          : "چون زمانی تعیین نشده، همین حالا ارسال می‌شود.",
      ].join("\n"),
      "ad_activate",
      { id: ad.id },
      `a:ad:v:${ad.id}`,
    );
    return true;
  }

  if (sub === "off") {
    if (!(await guardAdmin(ctx, "ads.manage"))) return true;
    await updateRows(ctx.sb, "advertisements", {
      status: "paused",
      updated_at: new Date().toISOString(),
    }, { id: ad.id });
    await logAdminAction(ctx, "ad_pause", "advertisement", ad.id);
    const fresh = await selectOne<AdRow>(ctx.sb, "advertisements", (q) => q.eq("id", ad.id));
    if (fresh) await editOrSend(ctx, adViewText(fresh), adKeyboard(fresh));
    await answerCallback(ctx, "تبلیغ غیرفعال شد.");
    return true;
  }

  if (sub === "send") {
    if (!(await guardAdmin(ctx, "ads.manage"))) return true;
    await askConfirm(
      ctx,
      `🚀 <b>ارسال فوری</b>\nتبلیغ «${escapeHtml(ad.title)}» همین حالا به مقصد ارسال می‌شود.`,
      "ad_send",
      { id: ad.id },
      `a:ad:v:${ad.id}`,
    );
    return true;
  }

  if (sub === "test") {
    if (!(await guardAdmin(ctx, "ads.read"))) return true;
    const result = await sendRichMessage(ctx.tg, ctx.chatId, {
      text: `🧪 پیش‌نمایش تبلیغ\n\n${await ctx.settings.get("ads_label")}\n\n${escapeHtml(ad.body)}`,
      mediaType: ad.media_type,
      mediaFileId: ad.media_file_id,
      buttons: parseStoredButtons(ad.buttons),
      html: true,
    });
    await answerCallback(
      ctx,
      result.ok ? "پیش‌نمایش ارسال شد." : `خطا: ${result.error}`,
      !result.ok,
    );
    return true;
  }

  if (sub === "d") {
    if (!(await guardAdmin(ctx, "ads.manage"))) return true;
    await askConfirm(
      ctx,
      `🗑 حذف تبلیغ «${escapeHtml(ad.title)}»؟ این عملیات قابل بازگشت نیست.`,
      "ad_delete",
      { id: ad.id },
      "a:ad",
    );
    return true;
  }

  await answerCallback(ctx, "اقدام ناشناخته است.", true);
  return true;
}

export async function runAdConfirm(
  ctx: Ctx,
  action: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  if (!action.startsWith("ad_")) return false;
  if (!(await guardAdmin(ctx, "ads.manage"))) return true;

  const id = String(args.id ?? "");
  const ad = await selectOne<AdRow>(ctx.sb, "advertisements", (q) => q.eq("id", id));
  if (!ad) {
    await send(ctx, "تبلیغ پیدا نشد.");
    return true;
  }

  if (action === "ad_delete") {
    await deleteRows(ctx.sb, "advertisements", { id });
    await logAdminAction(ctx, "ad_delete", "advertisement", id, { title: ad.title });
    await send(ctx, "🗑 تبلیغ حذف شد.");
    await renderList(ctx, 1);
    return true;
  }

  if (action === "ad_send") {
    await publishNow(ctx, ad);
    const fresh = await selectOne<AdRow>(ctx.sb, "advertisements", (q) => q.eq("id", ad.id));
    if (fresh) await send(ctx, adViewText(fresh), adKeyboard(fresh));
    return true;
  }

  if (action === "ad_activate") {
    const now = Date.now();
    const due = ad.scheduled_at ? new Date(ad.scheduled_at).getTime() : now;
    if (due <= now + 2000) {
      await publishNow(ctx, ad);
    } else {
      await updateRows(ctx.sb, "advertisements", {
        status: "active",
        updated_at: new Date().toISOString(),
      }, { id: ad.id });
      await logAdminAction(ctx, "ad_activate", "advertisement", ad.id, { due: ad.scheduled_at });
      await send(ctx, `✅ تبلیغ فعال شد و در ${faDateTime(ad.scheduled_at)} ارسال می‌شود.`);
    }
    const fresh = await selectOne<AdRow>(ctx.sb, "advertisements", (q) => q.eq("id", ad.id));
    if (fresh) await send(ctx, adViewText(fresh), adKeyboard(fresh));
    return true;
  }

  return true;
}
