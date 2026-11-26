/** 📅 زمان‌بندی انتشار — پست‌های زمان‌بندی‌شده در کانال. */
import { insertRow, selectOne, selectRows, updateRows } from "../_shared/db.ts";
import { keyboard } from "../_shared/keyboards.ts";
import {
  parseStoredButtons,
  publishScheduledPost,
  sendRichMessage,
} from "../_shared/publishers.ts";
import {
  divider,
  faDateTime,
  faNum,
  relativeFa,
  sectionTitle,
  statusLabel,
} from "../_shared/texts.ts";
import { escapeHtml, truncate } from "../_shared/validation.ts";
import type { WizardDefinition } from "../_shared/wizard.ts";
import type { MediaType, ScheduledPostRow } from "../_shared/types.ts";
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

export const SCHEDULE_WIZARD: WizardDefinition = {
  id: "scheduled_post_create",
  title: "📅 پست زمان‌بندی‌شده",
  fields: [
    {
      key: "title",
      label: "عنوان (اختیاری)",
      prompt: "عنوان پست؛ اگر نمی‌خواهید <code>-</code> بفرستید.",
      kind: "text",
      required: false,
      maxLength: 200,
    },
    {
      key: "body",
      label: "متن پست",
      prompt: "متن کامل پست (بدون HTML).",
      kind: "paragraph",
      minLength: 2,
      maxLength: 4000,
    },
    {
      key: "media_type",
      label: "نوع مدیا",
      prompt: "نوع محتوا را انتخاب کنید.",
      kind: "choice",
      choices: MEDIA_CHOICES,
    },
    {
      key: "media_file_id",
      label: "file_id مدیا",
      prompt: "اگر مدیا دارد file_id را بفرستید، وگرنه <code>-</code>.",
      kind: "text",
      required: false,
      maxLength: 400,
    },
    {
      key: "buttons",
      label: "دکمه‌ها (اختیاری)",
      prompt: "هر خط: <code>متن | https://link</code> (حداکثر ۳). برای رد کردن <code>-</code>.",
      kind: "buttons",
      required: false,
    },
    {
      key: "target",
      label: "مقصد (اختیاری)",
      prompt: "کانال/گروه مقصد؛ برای کانال پیش‌فرض <code>-</code>.",
      kind: "telegram_target",
      required: false,
    },
    {
      key: "scheduled_at",
      label: "زمان انتشار",
      prompt:
        "مثال: <code>2h</code>، <code>today 20:30</code> نه— از <code>2026-03-21 20:30</code> یا <code>20:30</code> استفاده کنید.",
      kind: "schedule",
    },
    {
      key: "repeat_interval",
      label: "تکرار",
      prompt: "آیا پست تکرار شود؟",
      kind: "choice",
      choices: REPEAT_CHOICES,
    },
  ],
  validate: (data) => {
    const media = String(data.media_type ?? "none");
    if (media !== "none" && !String(data.media_file_id ?? "").trim()) {
      return "برای مدیای انتخاب‌شده file_id لازم است.";
    }
    return null;
  },
};

function postView(post: ScheduledPostRow): string {
  return [
    `<b>📅 پست: ${escapeHtml(post.title ?? "بدون عنوان")}</b>`,
    divider(),
    `وضعیت: ${statusLabel("scheduled", post.status)}`,
    `زمان: ${faDateTime(post.scheduled_at)} (${relativeFa(post.scheduled_at)})`,
    `تکرار: ${post.repeat_interval}`,
    `مقصد: <code>${escapeHtml(post.target_chat ?? "کانال پیش‌فرض")}</code>`,
    post.attempts > 0 ? `تلاش‌ها: ${faNum(post.attempts)}` : "",
    post.last_error ? `⚠️ خطا: ${escapeHtml(truncate(post.last_error, 200))}` : "",
    "",
    "<b>متن:</b>",
    escapeHtml(post.body),
  ].filter(Boolean).join("\n");
}

function postKeyboard(post: ScheduledPostRow): ReturnType<typeof keyboard> {
  const rows = [];
  if (post.status === "pending") {
    rows.push([
      { text: "🚀 ارسال فوری", callback_data: `a:sh:s:${post.id}` },
      { text: "🚫 لغو زمان‌بندی", callback_data: `a:sh:x:${post.id}` },
    ]);
  }
  rows.push([
    { text: "📋 لیست زمان‌بندی", callback_data: "a:sh" },
    { text: "🏠 داشبورد", callback_data: "a:h" },
  ]);
  return keyboard(rows);
}

async function renderList(ctx: Ctx): Promise<void> {
  const [pending, recent] = await Promise.all([
    selectRows<ScheduledPostRow>(
      ctx.sb,
      "scheduled_posts",
      (q) => q.eq("status", "pending").order("scheduled_at", { ascending: true }).limit(8),
    ),
    selectRows<ScheduledPostRow>(
      ctx.sb,
      "scheduled_posts",
      (q) => q.neq("status", "pending").order("updated_at", { ascending: false }).limit(4),
    ),
  ]);

  const pendingLines = pending.length === 0
    ? ["<i>پستی در انتظار انتشار نیست.</i>"]
    : pending.map((post, index) =>
      `${faNum(index + 1)}. <b>${escapeHtml(truncate(post.title ?? post.body, 40))}</b>\n    ${
        faDateTime(post.scheduled_at)
      } • ${relativeFa(post.scheduled_at)}`
    );
  const recentLines = recent.map((post) =>
    `• ${statusLabel("scheduled", post.status)} ${
      escapeHtml(truncate(post.title ?? post.body, 32))
    }`
  );

  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < pending.length; i += 2) {
    rows.push(
      pending.slice(i, i + 2).map((post, offset) => ({
        text: truncate(post.title ?? `پست ${i + offset + 1}`, 22),
        callback_data: `a:sh:v:${post.id}`,
      })),
    );
  }
  rows.push([{ text: "➕ زمان‌بندی پست جدید", callback_data: "a:sh:n" }]);
  rows.push([{ text: "🏠 داشبورد", callback_data: "a:h" }]);

  await editOrSend(
    ctx,
    [
      sectionTitle("📅 زمان‌بندی انتشار"),
      divider(),
      `<b>در انتظار (${faNum(pending.length)})</b>`,
      ...pendingLines,
      "",
      "<b>اخیر</b>",
      ...(recentLines.length > 0 ? recentLines : ["<i>—</i>"]),
      "",
      "<i>انتشار توسط تابع scheduler هر دقیقه بررسی می‌شود.</i>",
    ].join("\n"),
    keyboard(rows),
  );
}

registerWizard({
  definition: SCHEDULE_WIZARD,
  permission: "schedule.manage",
  returnTo: "a:sh",
  onComplete: async (ctx, data) => {
    const mediaType = String(data.media_type ?? "none") as MediaType;
    const post = await insertRow<ScheduledPostRow>(ctx.sb, "scheduled_posts", {
      title: data.title ? String(data.title) : null,
      body: String(data.body),
      media_type: mediaType,
      media_file_id: mediaType === "none" ? null : String(data.media_file_id ?? ""),
      buttons: data.buttons ?? [],
      target_chat: data.target ? String(data.target) : null,
      scheduled_at: String(data.scheduled_at),
      repeat_interval: String(data.repeat_interval ?? "none"),
      status: "pending",
      created_by: ctx.userId,
    });

    await logAdminAction(ctx, "scheduled_post_create", "scheduled_post", post.id, {
      scheduled_at: post.scheduled_at,
    });
    await send(ctx, `✅ پست زمان‌بندی شد.\n\n${postView(post)}`, postKeyboard(post));
  },
});

export async function handleScheduleCallback(ctx: Ctx, parts: string[]): Promise<boolean> {
  if (parts[1] !== "sh") return false;
  const sub = parts[2];

  if (!sub) {
    if (!(await guardAdmin(ctx, "schedule.manage"))) return true;
    await renderList(ctx);
    return true;
  }

  if (sub === "n") {
    if (!(await guardAdmin(ctx, "schedule.manage"))) return true;
    await beginWizard(ctx, SCHEDULE_WIZARD.id);
    return true;
  }

  const id = parts[3];
  if (!id) return false;
  const post = await selectOne<ScheduledPostRow>(ctx.sb, "scheduled_posts", (q) => q.eq("id", id));
  if (!post) {
    await answerCallback(ctx, "پست پیدا نشد.", true);
    return true;
  }

  if (sub === "v") {
    if (!(await guardAdmin(ctx, "schedule.manage"))) return true;
    await editOrSend(ctx, postView(post), postKeyboard(post));
    return true;
  }

  if (sub === "x") {
    if (!(await guardAdmin(ctx, "schedule.manage"))) return true;
    await askConfirm(
      ctx,
      `🚫 لغو زمان‌بندی پست «${escapeHtml(post.title ?? truncate(post.body, 40))}»؟`,
      "scheduled_cancel",
      { id: post.id },
      "a:sh",
    );
    return true;
  }

  if (sub === "s") {
    if (!(await guardAdmin(ctx, "schedule.manage"))) return true;
    await askConfirm(
      ctx,
      `🚀 ارسال فوری پست «${escapeHtml(post.title ?? truncate(post.body, 40))}» به مقصد؟`,
      "scheduled_send",
      { id: post.id },
      "a:sh",
    );
    return true;
  }

  await answerCallback(ctx, "اقدام ناشناخته است.", true);
  return true;
}

export async function runScheduleConfirm(
  ctx: Ctx,
  action: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  if (!action.startsWith("scheduled_")) return false;
  if (!(await guardAdmin(ctx, "schedule.manage"))) return true;

  const id = String(args.id ?? "");
  const post = await selectOne<ScheduledPostRow>(ctx.sb, "scheduled_posts", (q) => q.eq("id", id));
  if (!post) {
    await send(ctx, "پست پیدا نشد.");
    return true;
  }

  if (action === "scheduled_cancel") {
    await updateRows(ctx.sb, "scheduled_posts", {
      status: "cancelled",
      updated_at: new Date().toISOString(),
    }, { id: post.id });
    await logAdminAction(ctx, "scheduled_post_cancel", "scheduled_post", post.id);
    await send(ctx, "🚫 زمان‌بندی لغو شد.");
    await renderList(ctx);
    return true;
  }

  if (action === "scheduled_send") {
    const result = await publishScheduledPost(
      { sb: ctx.sb, tg: ctx.tg, settings: ctx.settings },
      post,
    );
    if (result.ok) {
      await updateRows(ctx.sb, "scheduled_posts", {
        status: "sent",
        sent_message_id: result.messageId ?? null,
        sent_at: new Date().toISOString(),
        attempts: post.attempts + 1,
        last_error: null,
        updated_at: new Date().toISOString(),
      }, { id: post.id });
      await logAdminAction(ctx, "scheduled_post_send_now", "scheduled_post", post.id);
      await send(ctx, `✅ پست در <code>${escapeHtml(result.target)}</code> ارسال شد.`);
    } else {
      await updateRows(ctx.sb, "scheduled_posts", {
        attempts: post.attempts + 1,
        last_error: truncate(result.error ?? "unknown", 500),
        updated_at: new Date().toISOString(),
      }, { id: post.id });
      await send(ctx, `⚠️ ارسال ناموفق: ${escapeHtml(result.error ?? "—")}`);
    }
    await renderList(ctx);
    return true;
  }

  return true;
}

export async function testScheduledPreview(ctx: Ctx, post: ScheduledPostRow): Promise<void> {
  await sendRichMessage(ctx.tg, ctx.chatId, {
    text: post.body,
    mediaType: post.media_type,
    mediaFileId: post.media_file_id,
    buttons: parseStoredButtons(post.buttons),
  });
}
