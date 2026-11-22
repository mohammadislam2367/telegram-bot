/**
 * Jikan API (MyAnimeList) — منبع اطلاعات انیمه، مستقل از هوش مصنوعی.
 * کش در anime_cache ذخیره می‌شود تا مصرف API کم و پاسخ‌ها سریع باشد.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchJson, HttpError, sleep } from "./http.ts";
import { selectOne, upsertRow } from "./db.ts";
import { escapeHtml, truncate } from "./validation.ts";
import { faNum } from "./texts.ts";
import { normalizeQuery } from "./ai_fallback.ts";
import type { TgInlineKeyboardButton } from "./types.ts";

const JIKAN_BASE = "https://api.jikan.moe/v4";
const CACHE_TTL_HOURS = 6;
const STALE_TTL_HOURS = 72;

export interface AnimeInfo {
  malId: number;
  title: string;
  titleEnglish: string | null;
  titleJapanese: string | null;
  type: string | null;
  episodes: number | null;
  status: string | null;
  aired: string | null;
  duration: string | null;
  rating: string | null;
  score: number | null;
  rank: number | null;
  popularity: number | null;
  members: number | null;
  synopsis: string | null;
  season: string | null;
  year: number | null;
  studios: string[];
  genres: string[];
  imageUrl: string | null;
  url: string | null;
  trailerUrl: string | null;
}

interface JikanAnimeRaw {
  mal_id?: number;
  title?: string;
  title_english?: string | null;
  title_japanese?: string | null;
  type?: string | null;
  episodes?: number | null;
  status?: string | null;
  aired?: { string?: string | null };
  duration?: string | null;
  rating?: string | null;
  score?: number | null;
  rank?: number | null;
  popularity?: number | null;
  members?: number | null;
  synopsis?: string | null;
  season?: string | null;
  year?: number | null;
  studios?: { name?: string }[];
  genres?: { name?: string }[];
  images?: { jpg?: { large_image_url?: string; image_url?: string } };
  url?: string | null;
  trailer?: { url?: string | null };
}

interface JikanListResponse {
  data?: JikanAnimeRaw[];
}

interface JikanSingleResponse {
  data?: JikanAnimeRaw;
}

let lastRequestAt = 0;

/** Jikan محدودیت ~۳ درخواست در ثانیه دارد. */
async function throttle(): Promise<void> {
  const wait = Math.max(0, 350 - (Date.now() - lastRequestAt));
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

function mapAnime(raw: JikanAnimeRaw): AnimeInfo | null {
  if (!raw.mal_id || !raw.title) return null;
  return {
    malId: raw.mal_id,
    title: raw.title,
    titleEnglish: raw.title_english ?? null,
    titleJapanese: raw.title_japanese ?? null,
    type: raw.type ?? null,
    episodes: raw.episodes ?? null,
    status: raw.status ?? null,
    aired: raw.aired?.string ?? null,
    duration: raw.duration ?? null,
    rating: raw.rating ?? null,
    score: raw.score ?? null,
    rank: raw.rank ?? null,
    popularity: raw.popularity ?? null,
    members: raw.members ?? null,
    synopsis: raw.synopsis ?? null,
    season: raw.season ?? null,
    year: raw.year ?? null,
    studios: (raw.studios ?? []).map((s) => s.name ?? "").filter(Boolean),
    genres: (raw.genres ?? []).map((g) => g.name ?? "").filter(Boolean),
    imageUrl: raw.images?.jpg?.large_image_url ?? raw.images?.jpg?.image_url ?? null,
    url: raw.url ?? null,
    trailerUrl: raw.trailer?.url ?? null,
  };
}

async function readCache<T>(
  sb: SupabaseClient | null,
  key: string,
  allowStale = false,
): Promise<T | null> {
  if (!sb) return null;
  try {
    const row = await selectOne<{ payload: unknown; expires_at: string }>(
      sb,
      "anime_cache",
      (q) => q.eq("query", key),
    );
    if (!row) return null;
    if (!allowStale && new Date(row.expires_at).getTime() < Date.now()) return null;
    return row.payload as T;
  } catch {
    return null;
  }
}

async function writeCache(sb: SupabaseClient | null, key: string, payload: unknown): Promise<void> {
  if (!sb) return;
  try {
    const now = Date.now();
    await upsertRow(sb, "anime_cache", {
      query: key.slice(0, 200),
      payload,
      source: "jikan",
      fetched_at: new Date(now).toISOString(),
      expires_at: new Date(now + CACHE_TTL_HOURS * 3_600_000).toISOString(),
    }, "query");
  } catch (error) {
    console.warn("anime cache write failed:", (error as Error).message);
  }
}

export interface AnimeSearchOptions {
  limit?: number;
  sb?: SupabaseClient | null;
}

export async function searchAnime(
  query: string,
  options: AnimeSearchOptions = {},
): Promise<AnimeInfo[]> {
  const clean = query.trim().slice(0, 100);
  if (clean.length === 0) return [];
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 10);
  const key = `search:${limit}:${normalizeQuery(clean).slice(0, 80)}`;
  const sb = options.sb ?? null;

  const cached = await readCache<AnimeInfo[]>(sb, key);
  if (cached) return cached;

  try {
    await throttle();
    const url = `${JIKAN_BASE}/anime?q=${
      encodeURIComponent(clean)
    }&limit=${limit}&order_by=members&sort=desc&sfw`;
    const response = await fetchJson<JikanListResponse>(url, { timeoutMs: 12_000 });
    const items = (response.body.data ?? [])
      .map(mapAnime)
      .filter((item): item is AnimeInfo => item !== null);
    if (items.length === 0) {
      const stale = await readCache<AnimeInfo[]>(sb, key, true);
      return stale ?? [];
    }
    await writeCache(sb, key, items);
    return items;
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) {
      console.warn("Jikan rate limited");
    } else {
      console.warn("Jikan search failed:", (error as Error).message);
    }
    const stale = await readCache<AnimeInfo[]>(sb, key, true);
    return stale ?? [];
  }
}

export async function getAnimeById(
  malId: number,
  sb: SupabaseClient | null = null,
): Promise<AnimeInfo | null> {
  const key = `anime:${malId}`;
  const cached = await readCache<AnimeInfo>(sb, key);
  if (cached) return cached;

  try {
    await throttle();
    const response = await fetchJson<JikanSingleResponse>(`${JIKAN_BASE}/anime/${malId}/full`, {
      timeoutMs: 12_000,
    });
    if (!response.body.data) return null;
    const anime = mapAnime(response.body.data);
    if (anime) await writeCache(sb, key, anime);
    return anime;
  } catch (error) {
    console.warn("Jikan anime lookup failed:", (error as Error).message);
    return await readCache<AnimeInfo>(sb, key, true);
  }
}

export async function getSeasonNow(
  limit = 8,
  sb: SupabaseClient | null = null,
): Promise<AnimeInfo[]> {
  const key = `season:now:${limit}`;
  const cached = await readCache<AnimeInfo[]>(sb, key);
  if (cached) return cached;

  try {
    await throttle();
    const response = await fetchJson<JikanListResponse>(
      `${JIKAN_BASE}/seasons/now?limit=${limit}&sfw`,
      { timeoutMs: 12_000 },
    );
    const items = (response.body.data ?? [])
      .map(mapAnime)
      .filter((item): item is AnimeInfo => item !== null);
    if (items.length > 0) await writeCache(sb, key, items);
    return items;
  } catch (error) {
    console.warn("Jikan season lookup failed:", (error as Error).message);
    return await readCache<AnimeInfo[]>(sb, key, true) ?? [];
  }
}

/** پاک‌سازی عبارت جستجو از دستورها و کلمات پرسشی. */
export function cleanAnimeQuery(input: string): string {
  return input
    .replace(/^\/(anime|search)(?:@[A-Za-z0-9_]+)?/i, "")
    .replace(
      /(^|\s)(انیمه|جستجو|جست‌وجو|اطلاعات|معرفی|درباره|چیست|چیه|کیست|چی|info|about|anime|search)(?=\s|$)/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export function formatAnimeCard(anime: AnimeInfo): string {
  const lines: string[] = [`🎬 <b>${escapeHtml(anime.title)}</b>`];
  if (anime.titleEnglish && anime.titleEnglish !== anime.title) {
    lines.push(`<i>${escapeHtml(anime.titleEnglish)}</i>`);
  }

  const facts: string[] = [];
  if (anime.score) facts.push(`⭐ ${faNum(Number(anime.score.toFixed(2)))}`);
  if (anime.rank) facts.push(`🏆 رتبه ${faNum(anime.rank)}`);
  if (facts.length > 0) lines.push(facts.join("  •  "));

  const meta: string[] = [];
  if (anime.type) meta.push(`📺 ${escapeHtml(anime.type)}`);
  if (anime.episodes) meta.push(`🎞 ${faNum(anime.episodes)} قسمت`);
  if (anime.duration) meta.push(`⏱ ${escapeHtml(anime.duration)}`);
  if (meta.length > 0) lines.push(meta.join("  •  "));

  const air: string[] = [];
  if (anime.year) air.push(`📅 ${anime.year}`);
  if (anime.status) air.push(`📌 ${escapeHtml(anime.status)}`);
  if (air.length > 0) lines.push(air.join("  •  "));

  if (anime.studios.length > 0) lines.push(`🏢 استودیو: ${escapeHtml(anime.studios.join("، "))}`);
  if (anime.genres.length > 0) {
    lines.push(`🎭 ژانر: ${escapeHtml(anime.genres.slice(0, 5).join("، "))}`);
  }
  if (anime.synopsis) {
    lines.push("");
    lines.push(escapeHtml(truncate(anime.synopsis.replace(/\s+/g, " ").trim(), 700)));
  }
  if (anime.url) lines.push(`\n🔗 <a href="${escapeHtml(anime.url)}">صفحه MyAnimeList</a>`);
  return lines.join("\n");
}

export function formatAnimeList(items: AnimeInfo[]): string {
  return items
    .map((anime, index) => {
      const score = anime.score ? `⭐ ${faNum(Number(anime.score.toFixed(2)))}` : "⭐ —";
      const type = anime.type ? escapeHtml(anime.type) : "—";
      const episodes = anime.episodes ? `${faNum(anime.episodes)} قسمت` : "—";
      return `${faNum(index + 1)}. <b>${
        escapeHtml(anime.title)
      }</b>\n    ${score} • ${type} • ${episodes}`;
    })
    .join("\n\n");
}

export function animeListButtons(items: AnimeInfo[]): TgInlineKeyboardButton[][] {
  const rows: TgInlineKeyboardButton[][] = [];
  for (let i = 0; i < items.length; i += 3) {
    rows.push(
      items.slice(i, i + 3).map((anime, offset) => ({
        text: `${i + offset + 1}`,
        callback_data: `u:an:${anime.malId}`,
      })),
    );
  }
  return rows;
}

/** خلاصه‌ی متنی برای استفاده در context مدل زبان. */
export async function animeContextForAi(
  text: string,
  sb: SupabaseClient | null,
  limit = 1,
): Promise<string | null> {
  const query = cleanAnimeQuery(text);
  if (query.length < 2) return null;
  const results = await searchAnime(query, { limit, sb });
  const anime = results[0];
  if (!anime) return null;

  return [
    `عنوان: ${anime.title}`,
    anime.titleEnglish ? `عنوان انگلیسی: ${anime.titleEnglish}` : "",
    anime.type ? `نوع: ${anime.type}` : "",
    anime.episodes ? `تعداد قسمت: ${anime.episodes}` : "",
    anime.status ? `وضعیت: ${anime.status}` : "",
    anime.score ? `امتیاز MyAnimeList: ${anime.score}` : "",
    anime.studios.length > 0 ? `استودیو: ${anime.studios.join(", ")}` : "",
    anime.genres.length > 0 ? `ژانر: ${anime.genres.join(", ")}` : "",
    anime.synopsis ? `خلاصه: ${anime.synopsis.slice(0, 700)}` : "",
    anime.url ? `منبع: ${anime.url}` : "",
  ].filter(Boolean).join("\n");
}

export const ANIME_CACHE_STALE_HOURS = STALE_TTL_HOURS;
