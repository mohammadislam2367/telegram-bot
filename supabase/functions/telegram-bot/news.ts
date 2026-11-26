/** 📰 خواندن اخبار و محتوای منتشرشده توسط کاربران. */
import { selectRows } from "../_shared/db.ts";
import { type Button, keyboard } from "../_shared/keyboards.ts";
import { divider, faDateTime, faNum, sectionTitle } from "../_shared/texts.ts";
import { escapeHtml, truncate } from "../_shared/validation.ts";
import type { ContentPostRow } from "../_shared/types.ts";
import { answerCallback, type Ctx, editOrSend, send } from "./context.ts";

async function latestPosts(ctx: Ctx, limit = 5): Promise<ContentPostRow[]> {
  return await selectRows<ContentPostRow>(
    ctx.sb,
    "content_posts",
    (q) =>
      q.eq("status", "published").eq("type", "news").order("published_at", { ascending: false })
        .limit(limit),
  );
}

function postButtons(posts: ContentPostRow[]): Button[][] {
  const rows: Button[][] = posts.map((post) => [{
    text: truncate(post.title, 40),
    callback_data: `u:nw:${post.id}`,
  }]);
  rows.push([{ text: "🏠 منوی اصلی", callback_data: "u:m" }]);
  return rows;
}

export async function commandNews(ctx: Ctx): Promise<void> {
  const feature = await ctx.settings.get("feature_news");
  const channelUrl = await ctx.settings.get("channel_url");
  if (!feature) {
    await send(ctx, "📰 ماژول اخبار فعلاً غیرفعال است.");
    return;
  }

  const posts = await latestPosts(ctx);
  if (posts.length === 0) {
    const rows: Button[][] = [];
    if (channelUrl) rows.push([{ text: "📢 کانال", url: channelUrl }]);
    rows.push([{ text: "🏠 منوی اصلی", callback_data: "u:m" }]);
    await send(ctx, "📰 هنوز خبری منتشر نشده است.", keyboard(rows));
    return;
  }

  const lines = posts.map((post, index) =>
    `${faNum(index + 1)}. <b>${escapeHtml(post.title)}</b>\n    ${faDateTime(post.published_at)}`
  );

  await send(
    ctx,
    [
      sectionTitle("📰 آخرین اخبار"),
      divider(),
      ...lines,
      "",
      "<i>برای مطالعه روی عنوان بزنید.</i>",
    ].join("\n"),
    keyboard(postButtons(posts)),
  );
}

export async function handleUserNewsCallback(ctx: Ctx, parts: string[]): Promise<boolean> {
  if (parts[1] !== "nw") return false;
  const feature = await ctx.settings.get("feature_news");
  if (!feature) {
    await answerCallback(ctx, "ماژول اخبار غیرفعال است.", true);
    return true;
  }

  const id = parts[2];
  if (!id) {
    await commandNews(ctx);
    await answerCallback(ctx, "");
    return true;
  }

  const post = (await selectRows<ContentPostRow>(
    ctx.sb,
    "content_posts",
    (q) => q.eq("id", id).eq("status", "published"),
  ))[0];

  if (!post) {
    await answerCallback(ctx, "این خبر در دسترس نیست.", true);
    return true;
  }

  const rows: Button[][] = [];
  if (post.buttons && Array.isArray(post.buttons)) {
    for (const button of post.buttons.slice(0, 3)) {
      if (button && typeof button.text === "string" && typeof button.url === "string") {
        rows.push([{ text: button.text.slice(0, 64), url: button.url }]);
      }
    }
  }
  rows.push([{ text: "📰 همه اخبار", callback_data: "u:nw" }]);
  rows.push([{ text: "🏠 منوی اصلی", callback_data: "u:m" }]);

  await editOrSend(
    ctx,
    [
      `<b>${escapeHtml(post.title)}</b>`,
      `<i>${faDateTime(post.published_at)}</i>`,
      divider(),
      escapeHtml(truncate(post.body, 3000)),
    ].join("\n"),
    keyboard(rows),
  );
  return true;
}
