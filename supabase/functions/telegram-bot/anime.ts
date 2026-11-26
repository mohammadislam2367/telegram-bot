/** 🔎 جستجوی انیمه (Jikan) — مستقل از هوش مصنوعی. */
import {
  animeListButtons,
  cleanAnimeQuery,
  formatAnimeCard,
  formatAnimeList,
  getAnimeById,
  searchAnime,
} from "../_shared/anime_data.ts";
import { keyboard } from "../_shared/keyboards.ts";
import { divider, faNum } from "../_shared/texts.ts";
import { answerCallback, askForInput, type Ctx, editOrSend, send } from "./context.ts";

async function showResults(ctx: Ctx, query: string, asEdit: boolean): Promise<void> {
  const clean = cleanAnimeQuery(query);
  if (clean.length < 2) {
    await send(ctx, "🔎 نام انیمه را کامل‌تر بنویسید (حداقل ۲ کاراکتر).");
    return;
  }

  const results = await searchAnime(clean, { limit: 6, sb: ctx.sb });
  if (results.length === 0) {
    const text = [
      `❌ نتیجه‌ای برای «${clean}» پیدا نشد.`,
      "",
      "می‌توانید:",
      "• نام انگلیسی یا ژاپنی را امتحان کنید",
      "• از دکمه‌ی جستجو دوباره استفاده کنید",
      "• نام دقیق‌تر (بدون توضیح اضافه) بفرستید",
    ].join("\n");
    const markup = keyboard([
      [{ text: "🔍 جستجوی دیگر", callback_data: "u:an" }],
      [{ text: "🏠 منوی اصلی", callback_data: "u:m" }],
    ]);
    if (asEdit) await editOrSend(ctx, text, markup);
    else await send(ctx, text, markup);
    return;
  }

  const text = [
    `<b>🔎 نتایج «${clean}»</b>`,
    divider(),
    formatAnimeList(results),
    "",
    "<i>برای دیدن جزئیات، شماره را بزنید. منبع: Jikan / MyAnimeList</i>",
  ].join("\n");

  const rows = animeListButtons(results);
  rows.push([{ text: "🔍 جستجوی دیگر", callback_data: "u:an" }]);
  rows.push([{ text: "🏠 منوی اصلی", callback_data: "u:m" }]);

  if (asEdit) await editOrSend(ctx, text, keyboard(rows));
  else await send(ctx, text, keyboard(rows));
}

export async function commandAnime(ctx: Ctx, query: string): Promise<void> {
  const feature = await ctx.settings.get("feature_anime");
  if (!feature) {
    await send(ctx, "🔎 ماژول انیمه فعلاً غیرفعال است.");
    return;
  }
  if (query.trim().length === 0) {
    await askForInput(
      ctx,
      "user_anime_search",
      "🔎 <b>جستجوی انیمه</b>\nنام انیمه را بفرستید (فارسی یا انگلیسی).",
      {},
      "u:m",
    );
    return;
  }
  await showResults(ctx, query, false);
}

export async function handleAnimeCallback(ctx: Ctx, parts: string[]): Promise<boolean> {
  if (parts[1] !== "an") return false;
  const feature = await ctx.settings.get("feature_anime");
  if (!feature) {
    await answerCallback(ctx, "ماژول انیمه غیرفعال است.", true);
    return true;
  }

  const id = Number(parts[2]);
  if (!parts[2]) {
    await askForInput(
      ctx,
      "user_anime_search",
      "🔎 <b>جستجوی انیمه</b>\nنام انیمه را بفرستید.",
      {},
      "u:m",
    );
    await answerCallback(ctx, "");
    return true;
  }

  if (!Number.isSafeInteger(id) || id <= 0) {
    await answerCallback(ctx, "شناسه‌ی انیمه نامعتبر است.", true);
    return true;
  }

  const anime = await getAnimeById(id, ctx.sb);
  if (!anime) {
    await answerCallback(ctx, "اطلاعات این انیمه پیدا نشد.", true);
    return true;
  }

  const rows = [];
  if (anime.url) rows.push([{ text: "🔗 صفحه MyAnimeList", url: anime.url }]);
  if (anime.trailerUrl) rows.push([{ text: "▶️ تریلر", url: anime.trailerUrl }]);
  rows.push([{ text: "🔍 جستجوی دیگر", callback_data: "u:an" }]);
  rows.push([{ text: "🏠 منوی اصلی", callback_data: "u:m" }]);

  await editOrSend(ctx, formatAnimeCard(anime), keyboard(rows));
  return true;
}

export async function handleAnimeInput(
  ctx: Ctx,
  action: string,
  _args: Record<string, unknown>,
  text: string,
): Promise<boolean> {
  if (action !== "user_anime_search") return false;
  const feature = await ctx.settings.get("feature_anime");
  if (!feature) {
    await send(ctx, "ماژول انیمه غیرفعال است.");
    return true;
  }
  await showResults(ctx, text, false);
  return true;
}

export async function renderSeason(ctx: Ctx): Promise<void> {
  const feature = await ctx.settings.get("feature_anime");
  if (!feature) {
    await send(ctx, "ماژول انیمه غیرفعال است.");
    return;
  }
  const { getSeasonNow } = await import("../_shared/anime_data.ts");
  const items = await getSeasonNow(6, ctx.sb);
  if (items.length === 0) {
    await send(ctx, "فهرست فصل جاری در دسترس نیست. کمی بعد تلاش کنید.");
    return;
  }
  await send(
    ctx,
    [
      "<b>📺 انیمه‌های فصل جاری</b>",
      divider(),
      formatAnimeList(items),
      "",
      `<i>${faNum(items.length)} عنوان • منبع Jikan</i>`,
    ].join("\n"),
    keyboard([
      ...animeListButtons(items),
      [{ text: "🏠 منوی اصلی", callback_data: "u:m" }],
    ]),
  );
}
