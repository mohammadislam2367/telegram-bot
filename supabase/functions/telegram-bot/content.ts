/** 📰 مدیریت اخبار + 🎭 محتوای انیمه (پست/راهنما) + دسته‌بندی‌ها. */
import {
  countRows,
  deleteRows,
  insertRow,
  selectOne,
  selectRows,
  updateRows,
} from "../_shared/db.ts";
import { type Button, keyboard, paginationRow } from "../_shared/keyboards.ts";
import { parseStoredButtons, publishContentPost, sendRichMessage } from "../_shared/publishers.ts";
import { divider, faDateTime, faNum, sectionTitle, statusLabel } from "../_shared/texts.ts";
import { escapeHtml, truncate } from "../_shared/validation.ts";
import type { WizardDefinition } from "../_shared/wizard.ts";
import type { CategoryRow, ContentPostRow, MediaType } from "../_shared/types.ts";
import {
  answerCallback,
  askConfirm,
  askForInput,
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

const PUBLISH_CHOICES = [
  { value: "now", label: "انتشار فوری" },
  { value: "scheduled", label: "زمان‌بندی" },
  { value: "draft", label: "ذخیره پیش‌نویس" },
] as const;

const PIN_CHOICES = [
  { value: "yes", label: "سنجاق شود" },
  { value: "no", label: "سنجاق نشود" },
] as const;

const DEFAULT_CATEGORY: Record<string, string> = {
  news: "news",
  post: "review",
  guide: "guide",
};

export const CONTENT_WIZARD: WizardDefinition = {
  id: "content_create",
  title: "📝 محتوای جدید",
  fields: [
    {
      key: "title",
      label: "عنوان",
      prompt: "عنوان پست/خبر.",
      kind: "text",
      minLength: 2,
      maxLength: 200,
    },
    {
      key: "body",
      label: "متن",
      prompt: "متن کامل (بدون HTML).",
      kind: "paragraph",
      minLength: 2,
      maxLength: 8000,
    },
    {
      key: "category",
      label: "دسته (اختیاری)",
      prompt: "اسلاگ دسته مثل <code>news</code> یا <code>review</code>؛ برای پیش‌فرض <code>-</code>.",
      kind: "text",
      required: false,
      maxLength: 40,
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
      prompt: "اگر مدیا دارد file_id بفرستید، وگرنه <code>-</code>.",
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
      key: "scheduled_at",
      label: "زمان انتشار (اختیاری)",
      prompt:
        "برای انتشار فوری/پیش‌نویس <code>-</code>؛ وگرنه مثال <code>2h</code> یا <code>2026-03-21 20:30</code>.",
      kind: "schedule",
      required: false,
    },
    {
      key: "publish",
      label: "نحوه انتشار",
      prompt: "محتوا چگونه منتشر شود؟",
      kind: "choice",
      choices: PUBLISH_CHOICES,
    },
    {
      key: "target",
      label: "مقصد (اختیاری)",
      prompt: "کانال/گروه مقصد؛ برای کانال پیش‌فرض <code>-</code>.",
      kind: "telegram_target",
      required: false,
    },
    {
      key: "pin",
      label: "سنجاق",
      prompt: "بعد از انتشار سنجاق شود؟",
      kind: "choice",
      choices: PIN_CHOICES,
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

export const CONTENT_EDIT_WIZARD: WizardDefinition = {
  id: "content_edit",
  title: "✏️ ویرایش محتوا",
  fields: [
    {
      key: "title",
      label: "عنوان جدید",
      prompt: "عنوان جدید را بفرستید.",
      kind: "text",
      minLength: 2,
      maxLength: 200,
    },
    {
      key: "body",
      label: "متن جدید",
      prompt: "متن جدید را بفرستید.",
      kind: "paragraph",
      minLength: 2,
      maxLength: 8000,
    },
  ],
};

async function resolveCategoryId(ctx: Ctx, type: string, slug?: string): Promise<number | null> {
  const wanted = (slug ?? DEFAULT_CATEGORY[type] ?? "").trim();
  if (!wanted) return null;
  const category = await selectOne<CategoryRow>(
    ctx.sb,
    "content_categories",
    (q) => q.eq("slug", wanted),
  );
  return category?.id ?? null;
}

function postView(post: ContentPostRow, categoryTitle: string | null): string {
  return [
    `<b>${post.type === "news" ? "📰" : "🎭"} ${escapeHtml(post.title)}</b>`,
    divider(),
    `نوع: ${post.type} • دسته: ${escapeHtml(categoryTitle ?? "—")}`,
    `وضعیت: ${statusLabel("post", post.status)}`,
    post.published_at ? `انتشار: ${faDateTime(post.published_at)}` : "",
    post.scheduled_at ? `زمان‌بندی: ${faDateTime(post.scheduled_at)}` : "",
    post.telegram_message_id ? `پیام تلگرام: <code>${post.telegram_message_id}</code>` : "",
    `بازدید ثبت‌شده: ${faNum(post.views)}`,
    post.last_error ? `⚠️ آخرین خطا: ${escapeHtml(truncate(post.last_error, 200))}` : "",
    "",
    "<b>متن:</b>",
    escapeHtml(truncate(post.body, 1200)),
  ].filter(Boolean).join("\n");
}

function postKeyboard(post: ContentPostRow): ReturnType<typeof keyboard> {
  const rows: Button[][] = [];
  if (post.status !== "published") {
    rows.push([{ text: "🚀 انتشار در کانال", callback_data: `a:ct:pub:${post.id}` }]);
  }
  rows.push([
    { text: "✏️ ویرایش", callback_data: `a:ct:e:${post.id}` },
    { text: "👁 ارسال تست به من", callback_data: `a:ct:t:${post.id}` },
  ]);
  rows.push([{ text: "🗑 حذف", callback_data: `a:ct:del:${post.id}` }]);
  rows.push([
    { text: "📋 لیست", callback_data: `a:ct:l:${post.type}:1` },
    { text: "🏠 داشبورد", callback_data: "a:h" },
  ]);
  return keyboard(rows);
}

async function renderList(ctx: Ctx, type: string, page: number): Promise<void> {
  const from = (page - 1) * PAGE_SIZE;
  const posts = await selectRows<ContentPostRow>(ctx.sb, "content_posts", (q) => {
    let query = q.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
    if (type !== "all") query = query.eq("type", type);
    return query;
  });
  const total = await countRows(
    ctx.sb,
    "content_posts",
    (q) => type === "all" ? q : q.eq("type", type),
  );

  const rows: Button[][] = posts.map((post) => [{
    text: `${statusLabel("post", post.status)} ${truncate(post.title, 28)}`,
    callback_data: `a:ct:v:${post.id}`,
  }]);
  rows.unshift([
    { text: type === "all" ? "• همه •" : "همه", callback_data: "a:ct:l:all:1" },
    { text: type === "news" ? "• اخبار •" : "اخبار", callback_data: "a:ct:l:news:1" },
    { text: type === "post" ? "• پست •" : "پست", callback_data: "a:ct:l:post:1" },
    { text: type === "guide" ? "• راهنما •" : "راهنما", callback_data: "a:ct:l:guide:1" },
  ]);
  if (posts.length > 0) {
    rows.push(paginationRow(`a:ct:l:${type}`, page, total > page * PAGE_SIZE));
  }
  rows.push([
    { text: "➕ خبر جدید", callback_data: "a:ct:n:news" },
    { text: "➕ پست جدید", callback_data: "a:ct:n:post" },
  ]);
  rows.push([{ text: "🗂 دسته‌بندی‌ها", callback_data: "a:ct:cat" }]);
  rows.push([{ text: "🏠 داشبورد", callback_data: "a:h" }]);

  const lines = posts.map((post) =>
    `${statusLabel("post", post.status)} <b>${
      escapeHtml(truncate(post.title, 50))
    }</b> — ${post.type}`
  );

  await editOrSend(
    ctx,
    [
      sectionTitle(type === "news" ? "📰 اخبار" : "🎭 محتوای انیمه"),
      divider(),
      posts.length === 0 ? "<i>محتوایی ثبت نشده است.</i>" : lines.join("\n"),
      "",
      `<i>مجموع: ${faNum(total)} • صفحه ${faNum(page)}</i>`,
    ].join("\n"),
    keyboard(rows),
  );
}

async function renderMenu(ctx: Ctx, isNews: boolean): Promise<void> {
  const [published, drafts, scheduled, newsCount, postsCount] = await Promise.all([
    countRows(ctx.sb, "content_posts", (q) => q.eq("status", "published")),
    countRows(ctx.sb, "content_posts", (q) => q.eq("status", "draft")),
    countRows(ctx.sb, "content_posts", (q) => q.eq("status", "scheduled")),
    countRows(ctx.sb, "content_posts", (q) => q.eq("type", "news")),
    countRows(ctx.sb, "content_posts", (q) => q.eq("type", "post")),
  ]);

  const text = [
    sectionTitle(isNews ? "📰 مدیریت اخبار" : "🎭 مدیریت محتوای انیمه"),
    divider(),
    `منتشرشده: ${faNum(published)} • پیش‌نویس: ${faNum(drafts)} • زمان‌بندی: ${faNum(scheduled)}`,
    `اخبار: ${faNum(newsCount)} • پست‌ها: ${faNum(postsCount)}`,
    "",
    "<i>محتوا با عنوان و متن ساده ذخیره می‌شود و هنگام ارسال امن‌سازی HTML انجام می‌گیرد.</i>",
  ].join("\n");

  const rows: Button[][] = [];
  if (isNews) {
    rows.push([{ text: "📋 لیست اخبار", callback_data: "a:ct:l:news:1" }]);
    rows.push([{ text: "➕ خبر جدید", callback_data: "a:ct:n:news" }]);
  } else {
    rows.push([
      { text: "📋 همه محتوا", callback_data: "a:ct:l:all:1" },
      { text: "🕐 زمان‌بندی‌شده", callback_data: "a:ct:l:all:1" },
    ]);
    rows.push([
      { text: "➕ پست جدید", callback_data: "a:ct:n:post" },
      { text: "➕ راهنما", callback_data: "a:ct:n:guide" },
    ]);
  }
  rows.push([{ text: "🗂 دسته‌بندی‌ها", callback_data: "a:ct:cat" }]);
  rows.push([{ text: "🏠 داشبورد", callback_data: "a:h" }]);

  await editOrSend(ctx, text, keyboard(rows));
}

async function renderCategories(ctx: Ctx): Promise<void> {
  const categories = await selectRows<CategoryRow>(
    ctx.sb,
    "content_categories",
    (q) => q.order("id"),
  );
  const counts = await Promise.all(
    categories.map((category) =>
      countRows(ctx.sb, "content_posts", (q) => q.eq("category_id", category.id))
    ),
  );
  const lines = categories.map((category, index) =>
    `${faNum(index + 1)}. <b>${escapeHtml(category.title)}</b> — <code>${category.slug}</code> (${
      faNum(counts[index])
    } پست)`
  );
  await editOrSend(
    ctx,
    [
      sectionTitle("🗂 دسته‌بندی‌ها"),
      divider(),
      lines.join("\n"),
      "",
      "<i>برای افزودن دسته، اسلاگ و عنوان را با قالب <code>slug | عنوان</code> بفرستید.</i>",
    ].join("\n"),
    keyboard([
      [{ text: "➕ افزودن دسته", callback_data: "a:ct:cat:add" }],
      [{ text: "🏠 داشبورد", callback_data: "a:h" }],
    ]),
  );
}

registerWizard({
  definition: CONTENT_WIZARD,
  permission: "content.manage",
  returnTo: "a:ct",
  onComplete: async (ctx, data) => {
    const type = String(data.type ?? "post") as "news" | "post" | "guide";
    const mediaType = String(data.media_type ?? "none") as MediaType;
    const categoryId = await resolveCategoryId(
      ctx,
      type,
      data.category ? String(data.category) : undefined,
    );
    const publishChoice = String(data.publish ?? "draft");
    const scheduledAt = data.scheduled_at ? String(data.scheduled_at) : null;

    let status: ContentPostRow["status"] = "draft";
    if (publishChoice === "scheduled" && scheduledAt) status = "scheduled";
    if (publishChoice === "now") status = "draft"; // ابتدا draft، سپس انتشار

    const post = await insertRow<ContentPostRow>(ctx.sb, "content_posts", {
      category_id: categoryId,
      type,
      title: String(data.title),
      body: String(data.body),
      media_type: mediaType,
      media_file_id: mediaType === "none" ? null : String(data.media_file_id ?? ""),
      buttons: data.buttons ?? [],
      status,
      scheduled_at: status === "scheduled" ? scheduledAt : null,
      target_chat: data.target ? String(data.target) : null,
      is_pinned: String(data.pin ?? "no") === "yes",
      created_by: ctx.userId,
    });

    await logAdminAction(ctx, "content_create", "content_post", post.id, {
      type,
      status,
      publish: publishChoice,
    });

    if (publishChoice === "now") {
      const result = await publishContentPost(
        { sb: ctx.sb, tg: ctx.tg, settings: ctx.settings },
        post,
      );
      if (result.ok) {
        await updateRows(ctx.sb, "content_posts", {
          status: "published",
          published_at: new Date().toISOString(),
          telegram_message_id: result.messageId ?? null,
          last_error: null,
          updated_at: new Date().toISOString(),
        }, { id: post.id });
        await send(ctx, `✅ محتوا در <code>${escapeHtml(result.target)}</code> منتشر شد.`);
      } else {
        await updateRows(ctx.sb, "content_posts", {
          last_error: truncate(result.error ?? "unknown", 500),
          updated_at: new Date().toISOString(),
        }, { id: post.id });
        await send(
          ctx,
          `⚠️ انتشار ناموفق بود و به‌صورت پیش‌نویس ذخیره شد:\n${escapeHtml(result.error ?? "—")}`,
        );
      }
    } else if (status === "scheduled") {
      await send(ctx, `🕐 محتوا زمان‌بندی شد: ${faDateTime(scheduledAt)}`);
    } else {
      await send(ctx, "💾 محتوا به‌صورت پیش‌نویس ذخیره شد.");
    }

    const fresh = await selectOne<ContentPostRow>(
      ctx.sb,
      "content_posts",
      (q) => q.eq("id", post.id),
    );
    if (fresh) {
      const category = categoryId
        ? await selectOne<CategoryRow>(ctx.sb, "content_categories", (q) => q.eq("id", categoryId))
        : null;
      await send(ctx, postView(fresh, category?.title ?? null), postKeyboard(fresh));
    }
  },
});

registerWizard({
  definition: CONTENT_EDIT_WIZARD,
  permission: "content.manage",
  returnTo: "a:ct",
  onComplete: async (ctx, data) => {
    const id = String(data.id ?? "");
    if (!id) {
      await send(ctx, "شناسه محتوا پیدا نشد.");
      return;
    }
    await updateRows(ctx.sb, "content_posts", {
      title: String(data.title),
      body: String(data.body),
      updated_at: new Date().toISOString(),
    }, { id });
    await logAdminAction(ctx, "content_edit", "content_post", id);
    const post = await selectOne<ContentPostRow>(ctx.sb, "content_posts", (q) => q.eq("id", id));
    if (post) await send(ctx, postView(post, null), postKeyboard(post));
  },
});

export async function handleContentCallback(ctx: Ctx, parts: string[]): Promise<boolean> {
  const section = parts[1];
  if (section !== "nw" && section !== "ct") return false;

  const isNews = section === "nw";
  const sub = parts[2];

  if (isNews && !sub) {
    if (!(await guardAdmin(ctx, "content.read"))) return true;
    await renderMenu(ctx, true);
    return true;
  }

  if (!sub) {
    if (!(await guardAdmin(ctx, "content.read"))) return true;
    await renderMenu(ctx, false);
    return true;
  }

  if (sub === "n") {
    if (!(await guardAdmin(ctx, "content.manage"))) return true;
    const type = (parts[3] ?? "post") as "news" | "post" | "guide";
    await beginWizard(ctx, CONTENT_WIZARD.id, { overwrite: { type } });
    return true;
  }

  if (sub === "l") {
    if (!(await guardAdmin(ctx, "content.read"))) return true;
    const type = parts[3] ?? "all";
    const page = Math.max(Number(parts[4] ?? 1), 1);
    await renderList(ctx, type, page);
    return true;
  }

  if (sub === "cat") {
    if (!(await guardAdmin(ctx, "content.read"))) return true;
    if (parts[3] === "add") {
      if (!(await guardAdmin(ctx, "content.manage"))) return true;
      await askForInput(
        ctx,
        "admin_category_add",
        "🗂 دسته‌ی جدید را با قالب <code>slug | عنوان</code> بفرستید (مثال: <code>interview | مصاحبه</code>).",
        {},
        "a:ct:cat",
      );
      return true;
    }
    await renderCategories(ctx);
    return true;
  }

  const id = parts[3];
  if (!id) return false;
  const post = await selectOne<ContentPostRow>(ctx.sb, "content_posts", (q) => q.eq("id", id));
  if (!post) {
    await answerCallback(ctx, "محتوا پیدا نشد.", true);
    return true;
  }

  if (sub === "v") {
    if (!(await guardAdmin(ctx, "content.read"))) return true;
    const category = post.category_id
      ? await selectOne<CategoryRow>(
        ctx.sb,
        "content_categories",
        (q) => q.eq("id", post.category_id),
      )
      : null;
    await editOrSend(ctx, postView(post, category?.title ?? null), postKeyboard(post));
    return true;
  }

  if (sub === "e") {
    if (!(await guardAdmin(ctx, "content.manage"))) return true;
    await beginWizard(ctx, CONTENT_EDIT_WIZARD.id, {
      overwrite: { id: post.id, title: post.title, body: post.body },
    });
    return true;
  }

  if (sub === "pub") {
    if (!(await guardAdmin(ctx, "content.manage"))) return true;
    await askConfirm(
      ctx,
      `🚀 انتشار «${escapeHtml(post.title)}» در کانال؟`,
      "post_publish",
      { id: post.id },
      `a:ct:v:${post.id}`,
    );
    return true;
  }

  if (sub === "del") {
    if (!(await guardAdmin(ctx, "content.manage"))) return true;
    await askConfirm(
      ctx,
      `🗑 حذف «${escapeHtml(post.title)}»؟ این عملیات قابل بازگشت نیست.`,
      "post_delete",
      { id: post.id },
      "a:ct",
    );
    return true;
  }

  if (sub === "t") {
    if (!(await guardAdmin(ctx, "content.read"))) return true;
    const result = await sendRichMessage(ctx.tg, ctx.chatId, {
      text: `<b>${escapeHtml(post.title)}</b>\n\n${escapeHtml(post.body)}`,
      mediaType: post.media_type,
      mediaFileId: post.media_file_id,
      buttons: parseStoredButtons(post.buttons),
      html: true,
    });
    await answerCallback(ctx, result.ok ? "تست ارسال شد." : `خطا: ${result.error}`, !result.ok);
    return true;
  }

  await answerCallback(ctx, "اقدام ناشناخته است.", true);
  return true;
}

export async function handleContentInput(
  ctx: Ctx,
  action: string,
  _args: Record<string, unknown>,
  text: string,
): Promise<boolean> {
  if (action !== "admin_category_add") return false;
  if (!(await guardAdmin(ctx, "content.manage"))) return true;

  const [slugRaw, ...titleParts] = text.split("|");
  const slug = (slugRaw ?? "").trim().toLowerCase();
  const title = titleParts.join("|").trim();

  if (!/^[a-z0-9_-]{2,40}$/.test(slug) || title.length < 2) {
    await send(ctx, "⚠️ قالب نامعتبر است. مثال درست: <code>interview | مصاحبه</code>");
    return true;
  }

  try {
    const category = await insertRow<CategoryRow>(ctx.sb, "content_categories", { slug, title });
    await logAdminAction(ctx, "category_create", "content_category", category.id, { slug });
    await send(ctx, `✅ دسته «${escapeHtml(title)}» ساخته شد.`);
  } catch (error) {
    await send(ctx, `⚠️ ساخت دسته ناموفق بود: ${escapeHtml((error as Error).message)}`);
  }
  await renderCategories(ctx);
  return true;
}

export async function runContentConfirm(
  ctx: Ctx,
  action: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  if (action !== "post_publish" && action !== "post_delete") return false;
  if (!(await guardAdmin(ctx, "content.manage"))) return true;

  const id = String(args.id ?? "");
  const post = await selectOne<ContentPostRow>(ctx.sb, "content_posts", (q) => q.eq("id", id));
  if (!post) {
    await send(ctx, "محتوا پیدا نشد.");
    return true;
  }

  if (action === "post_delete") {
    await deleteRows(ctx.sb, "content_posts", { id });
    await logAdminAction(ctx, "content_delete", "content_post", id, { title: post.title });
    await send(ctx, "🗑 محتوا حذف شد.");
    await renderMenu(ctx, post.type === "news");
    return true;
  }

  const result = await publishContentPost(
    { sb: ctx.sb, tg: ctx.tg, settings: ctx.settings },
    post,
  );
  if (result.ok) {
    await updateRows(ctx.sb, "content_posts", {
      status: "published",
      published_at: new Date().toISOString(),
      telegram_message_id: result.messageId ?? null,
      last_error: null,
      publish_attempts: post.publish_attempts + 1,
      updated_at: new Date().toISOString(),
    }, { id: post.id });
    await logAdminAction(ctx, "content_publish", "content_post", id);
    await send(ctx, `✅ محتوا در <code>${escapeHtml(result.target)}</code> منتشر شد.`);
  } else {
    await updateRows(ctx.sb, "content_posts", {
      last_error: truncate(result.error ?? "unknown", 500),
      publish_attempts: post.publish_attempts + 1,
      updated_at: new Date().toISOString(),
    }, { id: post.id });
    await send(ctx, `⚠️ انتشار ناموفق: ${escapeHtml(result.error ?? "—")}`);
  }
  const fresh = await selectOne<ContentPostRow>(ctx.sb, "content_posts", (q) => q.eq("id", id));
  if (fresh) await send(ctx, postView(fresh, null), postKeyboard(fresh));
  return true;
}
