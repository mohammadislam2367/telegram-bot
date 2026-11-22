/** 📨 ارسال همگانی — کمپین، پیش‌نمایش، تأیید نهایی، صف و کنترل ارسال. */
import { callRpc, countRows, insertRow, selectOne, selectRows, updateRows } from "../_shared/db.ts";
import {
  campaignProgress,
  cancelCampaign,
  pauseCampaign,
  runBroadcastTick,
  startCampaign,
} from "../_shared/broadcast_runner.ts";
import { type Button, keyboard, paginationRow } from "../_shared/keyboards.ts";
import { parseStoredButtons, sendRichMessage } from "../_shared/publishers.ts";
import {
  divider,
  faDateTime,
  faNum,
  progressLine,
  sectionTitle,
  statusLabel,
} from "../_shared/texts.ts";
import { escapeHtml, truncate } from "../_shared/validation.ts";
import type { WizardDefinition } from "../_shared/wizard.ts";
import type { CampaignRow, MediaType } from "../_shared/types.ts";
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
  { value: "text", label: "فقط متن" },
  { value: "photo", label: "عکس + متن" },
  { value: "video", label: "ویدیو + متن" },
  { value: "animation", label: "گیف + متن" },
  { value: "document", label: "فایل + متن" },
] as const;

const AUDIENCE_CHOICES = [
  { value: "opt_in", label: "فقط رضایت‌داده‌ها" },
  { value: "active", label: "فعال ۳۰ روز" },
  { value: "all", label: "همه (به‌جز مسدودها)" },
] as const;

const AUDIENCE_LABELS: Record<string, string> = {
  opt_in: "کاربران رضایت‌داده",
  active: "فعالان ۳۰ روز",
  all: "همه کاربران",
};

export const BROADCAST_WIZARD: WizardDefinition = {
  id: "broadcast_create",
  title: "📨 کمپین ارسال همگانی",
  fields: [
    {
      key: "title",
      label: "عنوان کمپین",
      prompt: "فقط برای مدیریت داخلی (در پیام نمایش داده نمی‌شود).",
      kind: "text",
      minLength: 2,
      maxLength: 120,
    },
    {
      key: "text",
      label: "متن پیام",
      prompt: "متن پیام همگانی (بدون HTML).",
      kind: "paragraph",
      minLength: 2,
      maxLength: 3500,
    },
    {
      key: "message_type",
      label: "نوع پیام",
      prompt: "نوع محتوا را انتخاب کنید.",
      kind: "choice",
      choices: MEDIA_CHOICES,
    },
    {
      key: "media_file_id",
      label: "file_id مدیا",
      prompt: "اگر نوع پیام مدیا دارد، file_id را بفرستید؛ در غیر این صورت <code>-</code>.",
      kind: "text",
      required: false,
      maxLength: 400,
    },
    {
      key: "buttons",
      label: "دکمه‌ها (اختیاری)",
      prompt:
        "هر دکمه در یک خط: <code>متن | https://link</code>؛ حداکثر ۳. برای رد کردن <code>-</code>.",
      kind: "buttons",
      required: false,
    },
    {
      key: "audience",
      label: "مخاطبان",
      prompt: "این پیام برای کدام گروه ارسال شود؟",
      kind: "choice",
      choices: AUDIENCE_CHOICES,
    },
  ],
  validate: (data) => {
    const type = String(data.message_type ?? "text");
    if (type !== "text" && !String(data.media_file_id ?? "").trim()) {
      return "برای پیام مدیادار، file_id لازم است.";
    }
    return null;
  },
};

async function estimateAudience(ctx: Ctx, audience: string): Promise<number> {
  return await countRows(ctx.sb, "users", (q) => {
    let query = q.eq("is_bot", false);
    if (audience === "opt_in") query = query.eq("broadcast_opt_in", true);
    if (audience === "active") {
      query = query.gte(
        "last_seen_at",
        new Date(ctx.now.getTime() - 30 * 86_400_000).toISOString(),
      );
    }
    return query;
  });
}

function campaignPreview(campaign: CampaignRow, estimate: number): string {
  const buttons = parseStoredButtons(campaign.buttons);
  return [
    `<b>👁 پیش‌نمایش کمپین: ${escapeHtml(campaign.title)}</b>`,
    divider(),
    escapeHtml(campaign.text),
    buttons.length > 0
      ? `\n🔗 دکمه‌ها:\n${buttons.map((b) => `• ${escapeHtml(b.text)} → ${b.url}`).join("\n")}`
      : "",
    divider(),
    `👥 مخاطبان: ${AUDIENCE_LABELS[campaign.audience] ?? campaign.audience} — حدود ${
      faNum(estimate)
    } نفر`,
    campaign.message_type !== "text" ? `🖼 مدیا: ${campaign.message_type}` : "📝 فقط متن",
    "",
    "<i>ارسال فقط با تأیید نهایی شما آغاز می‌شود و به‌صورت دسته‌ای با رعایت محدودیت تلگرام انجام می‌شود.</i>",
  ].filter(Boolean).join("\n");
}

function campaignView(campaign: CampaignRow, progress: {
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  total: number;
}): string {
  return [
    `<b>📨 ${escapeHtml(campaign.title)}</b>`,
    divider(),
    `وضعیت: ${statusLabel("campaign", campaign.status)}`,
    `مخاطبان: ${AUDIENCE_LABELS[campaign.audience] ?? campaign.audience}`,
    `نوع: ${campaign.message_type}`,
    "",
    `پیشرفت: ${progressLine(progress.sent + progress.failed + progress.skipped, progress.total)}`,
    `✅ موفق: ${faNum(progress.sent)} • ❌ ناموفق: ${faNum(progress.failed)}`,
    `⏭ ردشده: ${faNum(progress.skipped)} • ⏳ در صف: ${faNum(progress.pending)}`,
    campaign.started_at ? `🚀 شروع: ${faDateTime(campaign.started_at)}` : "",
    campaign.finished_at ? `🏁 پایان: ${faDateTime(campaign.finished_at)}` : "",
    campaign.last_error ? `⚠️ آخرین خطا: ${escapeHtml(truncate(campaign.last_error, 200))}` : "",
    "",
    "<b>متن پیام:</b>",
    escapeHtml(truncate(campaign.text, 600)),
  ].filter(Boolean).join("\n");
}

function campaignKeyboard(campaign: CampaignRow): ReturnType<typeof keyboard> {
  const rows = [];
  if (campaign.status === "draft") {
    rows.push([{ text: "🚀 تأیید و شروع ارسال", callback_data: `a:bc:go:${campaign.id}` }]);
  }
  if (campaign.status === "running") {
    rows.push([{ text: "⏸ توقف موقت", callback_data: `a:bc:pa:${campaign.id}` }]);
  }
  if (campaign.status === "paused") {
    rows.push([{ text: "▶️ ادامه ارسال", callback_data: `a:bc:re:${campaign.id}` }]);
  }
  if (["queued", "running", "paused", "draft"].includes(campaign.status)) {
    rows.push([{ text: "🚫 لغو کمپین", callback_data: `a:bc:ca:${campaign.id}` }]);
  }
  rows.push([
    { text: "👁 ارسال تست به من", callback_data: `a:bc:t:${campaign.id}` },
    { text: "🔄 به‌روزرسانی", callback_data: `a:bc:v:${campaign.id}` },
  ]);
  rows.push([
    { text: "📋 لیست کمپین‌ها", callback_data: "a:bc" },
    { text: "🏠 داشبورد", callback_data: "a:h" },
  ]);
  return keyboard(rows);
}

async function renderList(ctx: Ctx, page: number): Promise<void> {
  const from = (page - 1) * PAGE_SIZE;
  const campaigns = await selectRows<CampaignRow>(
    ctx.sb,
    "broadcast_campaigns",
    (q) => q.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1),
  );
  const total = await countRows(ctx.sb, "broadcast_campaigns");

  const rows: Button[][] = [];
  const lines = campaigns.map((campaign) => {
    rows.push([{
      text: `${statusLabel("campaign", campaign.status)} ${truncate(campaign.title, 26)}`,
      callback_data: `a:bc:v:${campaign.id}`,
    }]);
    return `${statusLabel("campaign", campaign.status)} <b>${escapeHtml(campaign.title)}</b>\n   ${
      faNum(campaign.sent_count)
    }/${faNum(campaign.total_recipients)} • ${
      AUDIENCE_LABELS[campaign.audience] ?? campaign.audience
    }`;
  });

  if (campaigns.length > 0) {
    rows.push(paginationRow("a:bc:p", page, total > page * PAGE_SIZE));
  }
  rows.push([{ text: "➕ کمپین جدید", callback_data: "a:bc:n" }]);
  rows.push([{ text: "🏠 داشبورد", callback_data: "a:h" }]);

  await editOrSend(
    ctx,
    [
      sectionTitle("📨 ارسال همگانی"),
      divider(),
      campaigns.length === 0 ? "<i>کمپینی وجود ندارد.</i>" : lines.join("\n\n"),
      "",
      `<i>مجموع: ${faNum(total)} • صفحه ${faNum(page)}</i>`,
      "<i>ارسال‌ها با نرخ کنترل‌شده و صف اتمی انجام می‌شود؛ حداکثر یک کمپین هم‌زمان.</i>",
    ].join("\n"),
    keyboard(rows),
  );
}

async function renderCampaign(ctx: Ctx, id: string): Promise<void> {
  const campaign = await selectOne<CampaignRow>(
    ctx.sb,
    "broadcast_campaigns",
    (q) => q.eq("id", id),
  );
  if (!campaign) {
    await answerCallback(ctx, "کمپین پیدا نشد.", true);
    return;
  }
  const progress = await campaignProgress(ctx.sb, campaign.id);
  await editOrSend(ctx, campaignView(campaign, progress), campaignKeyboard(campaign));
}

registerWizard({
  definition: BROADCAST_WIZARD,
  permission: "broadcast.manage",
  returnTo: "a:bc",
  onComplete: async (ctx, data) => {
    const messageType = String(data.message_type ?? "text") as "text" | MediaType;
    const campaign = await insertRow<CampaignRow>(ctx.sb, "broadcast_campaigns", {
      title: String(data.title),
      text: String(data.text),
      message_type: messageType,
      media_file_id: messageType === "text" ? null : String(data.media_file_id ?? ""),
      buttons: data.buttons ?? [],
      audience: String(data.audience ?? "opt_in"),
      status: "draft",
      created_by: ctx.userId,
    });

    await logAdminAction(ctx, "broadcast_create", "campaign", campaign.id, {
      audience: campaign.audience,
    });

    const estimate = await estimateAudience(ctx, campaign.audience);
    await send(
      ctx,
      campaignPreview(campaign, estimate),
      keyboard([
        [{ text: "🚀 تأیید و شروع ارسال", callback_data: `a:bc:go:${campaign.id}` }],
        [{ text: "👁 مشاهده کمپین", callback_data: `a:bc:v:${campaign.id}` }],
        [{ text: "🏠 داشبورد", callback_data: "a:h" }],
      ]),
    );
  },
});

export async function handleBroadcastCallback(ctx: Ctx, parts: string[]): Promise<boolean> {
  if (parts[1] !== "bc") return false;
  const sub = parts[2];

  if (!sub) {
    if (!(await guardAdmin(ctx, "broadcast.read"))) return true;
    await renderList(ctx, 1);
    return true;
  }

  if (sub === "n") {
    if (!(await guardAdmin(ctx, "broadcast.manage"))) return true;
    await beginWizard(ctx, BROADCAST_WIZARD.id);
    return true;
  }

  if (sub === "p") {
    if (!(await guardAdmin(ctx, "broadcast.read"))) return true;
    await renderList(ctx, Math.max(Number(parts[3] ?? 1), 1));
    return true;
  }

  const id = parts[3];
  if (!id) return false;
  const campaign = await selectOne<CampaignRow>(
    ctx.sb,
    "broadcast_campaigns",
    (q) => q.eq("id", id),
  );
  if (!campaign) {
    await answerCallback(ctx, "کمپین پیدا نشد.", true);
    return true;
  }

  if (sub === "v" || sub === "st") {
    if (!(await guardAdmin(ctx, "broadcast.read"))) return true;
    await renderCampaign(ctx, id);
    return true;
  }

  if (sub === "go") {
    if (!(await guardAdmin(ctx, "broadcast.manage"))) return true;
    if (campaign.status !== "draft") {
      await answerCallback(ctx, "این کمپین قبلاً شروع شده است.", true);
      return true;
    }
    const estimate = await estimateAudience(ctx, campaign.audience);
    await askConfirm(
      ctx,
      [
        "🚀 <b>تأیید نهایی ارسال همگانی</b>",
        `کمپین: ${escapeHtml(campaign.title)}`,
        `مخاطبان: ${AUDIENCE_LABELS[campaign.audience] ?? campaign.audience} (~${
          faNum(estimate)
        } نفر)`,
        "ارسال دسته‌ای شروع می‌شود و می‌توانید بعداً متوقف کنید.",
      ].join("\n"),
      "broadcast_start",
      { id: campaign.id },
      `a:bc:v:${campaign.id}`,
    );
    return true;
  }

  if (sub === "pa") {
    if (!(await guardAdmin(ctx, "broadcast.manage"))) return true;
    await pauseCampaign(ctx.sb, id);
    await logAdminAction(ctx, "broadcast_pause", "campaign", id);
    await renderCampaign(ctx, id);
    await answerCallback(ctx, "ارسال متوقف شد.");
    return true;
  }

  if (sub === "re") {
    if (!(await guardAdmin(ctx, "broadcast.manage"))) return true;
    const resumed = await startCampaign(ctx.sb, id, ctx.userId);
    await logAdminAction(ctx, "broadcast_resume", "campaign", id);
    await renderCampaign(ctx, id);
    await answerCallback(
      ctx,
      resumed ? "ارسال ادامه می‌یابد." : "این کمپین قابل ادامه نیست.",
      !resumed,
    );
    return true;
  }

  if (sub === "ca") {
    if (!(await guardAdmin(ctx, "broadcast.manage"))) return true;
    await askConfirm(
      ctx,
      `🚫 لغو کمپین «${escapeHtml(campaign.title)}»؟ پیام‌های ارسال‌نشده کنار گذاشته می‌شوند.`,
      "broadcast_cancel",
      { id: campaign.id },
      `a:bc:v:${campaign.id}`,
    );
    return true;
  }

  if (sub === "t") {
    if (!(await guardAdmin(ctx, "broadcast.read"))) return true;
    const result = await sendRichMessage(ctx.tg, ctx.chatId, {
      text: campaign.text,
      mediaType: campaign.message_type === "text" ? "none" : campaign.message_type,
      mediaFileId: campaign.media_file_id,
      buttons: parseStoredButtons(campaign.buttons),
    });
    await answerCallback(
      ctx,
      result.ok ? "پیام تست ارسال شد." : `خطا: ${result.error}`,
      !result.ok,
    );
    return true;
  }

  await answerCallback(ctx, "اقدام ناشناخته است.", true);
  return true;
}

export async function runBroadcastConfirm(
  ctx: Ctx,
  action: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  if (!action.startsWith("broadcast_")) return false;
  if (!(await guardAdmin(ctx, "broadcast.manage"))) return true;

  const id = String(args.id ?? "");
  const campaign = await selectOne<CampaignRow>(
    ctx.sb,
    "broadcast_campaigns",
    (q) => q.eq("id", id),
  );
  if (!campaign) {
    await send(ctx, "کمپین پیدا نشد.");
    return true;
  }

  if (action === "broadcast_cancel") {
    const skipped = await cancelCampaign(ctx.sb, campaign.id);
    await logAdminAction(ctx, "broadcast_cancel", "campaign", campaign.id, { skipped });
    await send(ctx, `🚫 کمپین لغو شد. ${faNum(skipped)} پیام ارسال‌نشده کنار گذاشته شد.`);
    await renderCampaign(ctx, campaign.id);
    return true;
  }

  if (action === "broadcast_start") {
    const total = await callRpc<number>(ctx.sb, "enqueue_broadcast", {
      p_campaign_id: campaign.id,
      p_audience: campaign.audience,
    });
    if (!total && campaign.total_recipients === 0) {
      await send(ctx, "⚠️ مخاطبی برای این کمپین پیدا نشد.");
      return true;
    }
    await updateRows(ctx.sb, "broadcast_campaigns", {
      status: "queued",
      approved_by: ctx.userId,
      created_by: campaign.created_by ?? ctx.userId,
      updated_at: new Date().toISOString(),
      last_error: null,
    }, { id: campaign.id });
    await logAdminAction(ctx, "broadcast_start", "campaign", campaign.id, { total });

    await send(ctx, `🚀 کمپین شروع شد (${faNum(total)} گیرنده). ارسال دسته‌ای در حال اجراست…`);

    try {
      const tick = await runBroadcastTick({ sb: ctx.sb, tg: ctx.tg, settings: ctx.settings });
      if (tick.campaignId === campaign.id) {
        await send(
          ctx,
          [
            "📦 دسته اول پردازش شد.",
            `✅ موفق: ${faNum(tick.sent)} • ❌ ناموفق: ${faNum(tick.failed)} • ⏭ ردشده: ${
              faNum(tick.skipped)
            }`,
            `⏳ باقی‌مانده: ${faNum(tick.remaining)}`,
            tick.note ? `ℹ️ ${tick.note}` : "",
          ].filter(Boolean).join("\n"),
        );
      }
    } catch (error) {
      await ctx.log.error("broadcast tick failed", { error: (error as Error).message });
    }

    await renderCampaign(ctx, campaign.id);
    return true;
  }

  return true;
}
