/**
 * AI orchestration — Gemini + Smart Fallback + وضعیت سرویس.
 * قوانین: حداکثر تلاش محدود، بدون حلقه‌ی بی‌نهایت، همیشه یک پاسخ قابل ارائه.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "./config.ts";
import { callRpc, countRows, insertRow, selectOne, selectRows, updateRows } from "./db.ts";
import { startOfDayIso } from "./rate_limit.ts";
import { SettingsStore } from "./settings.ts";
import {
  AiProviderError,
  type GeminiTurn,
  generateContent,
  isGeminiConfigured,
} from "./ai_provider.ts";
import {
  detectLanguage,
  findFallback,
  genericFallback,
  looksLikeAnimeInfoQuery,
} from "./ai_fallback.ts";
import { animeContextForAi, formatAnimeCard, searchAnime } from "./anime_data.ts";
import { offlineAnswer } from "./offline_brain.ts";
import { displayName } from "./texts.ts";
import { escapeHtml, truncate } from "./validation.ts";
import type { AiConversationRow, AiStateRow, AiUsageRow } from "./types.ts";

export interface AiDeps {
  sb: SupabaseClient;
  settings: SettingsStore;
  cfg: Pick<AppConfig, "geminiApiKey" | "geminiModel" | "botUsername" | "superAdminIds">;
}

export interface AiReply {
  text: string;
  source: "gemini" | "fallback" | "system";
  model?: string;
  quotaExhausted?: boolean;
  rateLimited?: boolean;
  latencyMs?: number;
}

export async function getAiState(sb: SupabaseClient): Promise<AiStateRow> {
  const row = await selectOne<AiStateRow>(sb, "ai_state", (q) => q.eq("id", 1));
  if (row) return row;
  return {
    id: 1,
    provider: "gemini",
    status: "ok",
    consecutive_failures: 0,
    last_success_at: null,
    last_failure_at: null,
    last_error: null,
    last_http_status: null,
    next_retry_at: null,
    updated_at: new Date().toISOString(),
  };
}

export async function markAiSuccess(sb: SupabaseClient, model: string): Promise<void> {
  await updateRows(sb, "ai_state", {
    provider: "gemini",
    status: "ok",
    consecutive_failures: 0,
    last_success_at: new Date().toISOString(),
    last_error: null,
    last_http_status: 200,
    next_retry_at: null,
    updated_at: new Date().toISOString(),
  }, { id: 1 });
  console.log("ai provider ok:", model);
}

export async function markAiFailure(
  sb: SupabaseClient,
  error: AiProviderError,
  cooldownSeconds: number,
): Promise<void> {
  const state = await getAiState(sb);
  const failures = state.consecutive_failures + 1;
  const cooldown = error.quota
    ? Math.max(cooldownSeconds, 60)
    : Math.min(Math.max(cooldownSeconds, 60), 900);

  await updateRows(sb, "ai_state", {
    status: error.quota ? "quota_exhausted" : "degraded",
    consecutive_failures: failures,
    last_failure_at: new Date().toISOString(),
    last_error: truncate(error.message, 500),
    last_http_status: error.status || null,
    next_retry_at: new Date(Date.now() + cooldown * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }, { id: 1 });
}

export async function resetAiState(sb: SupabaseClient): Promise<void> {
  await updateRows(sb, "ai_state", {
    status: "ok",
    consecutive_failures: 0,
    last_error: null,
    last_http_status: null,
    next_retry_at: null,
    updated_at: new Date().toISOString(),
  }, { id: 1 });
}

export function isFallbackActive(state: AiStateRow, now = Date.now()): boolean {
  if (state.status === "ok") return false;
  if (!state.next_retry_at) return state.status !== "disabled";
  return new Date(state.next_retry_at).getTime() > now;
}

export async function logAiUsage(
  sb: SupabaseClient,
  entry: {
    userId?: number;
    model?: string;
    requestType?: "chat" | "anime" | "health" | "other";
    promptTokens?: number;
    completionTokens?: number;
    latencyMs?: number;
    status: "success" | "fallback" | "error" | "quota" | "rate_limited";
    errorCode?: string;
  },
): Promise<void> {
  try {
    await insertRow(sb, "ai_usage", {
      user_id: entry.userId ?? null,
      provider: "gemini",
      model: entry.model ?? null,
      request_type: entry.requestType ?? "chat",
      prompt_tokens: entry.promptTokens ?? 0,
      completion_tokens: entry.completionTokens ?? 0,
      latency_ms: entry.latencyMs ?? 0,
      status: entry.status,
      error_code: entry.errorCode ?? null,
    });
  } catch (error) {
    console.warn("ai_usage insert failed:", (error as Error).message);
  }
}

export async function loadHistory(
  sb: SupabaseClient,
  userId: number,
  limit: number,
): Promise<GeminiTurn[]> {
  if (limit <= 0) return [];
  const rows = await selectRows<AiConversationRow>(
    sb,
    "ai_conversations",
    (q) => q.eq("user_id", userId).order("created_at", { ascending: false }).limit(limit),
  );
  return rows
    .slice()
    .reverse()
    .map((row) => ({ role: row.role === "assistant" ? "model" : "user", text: row.content }));
}

export async function appendConversation(
  sb: SupabaseClient,
  entry: {
    userId: number;
    role: "user" | "assistant" | "system";
    content: string;
    source: "gemini" | "fallback" | "cache" | "system";
    model?: string;
    tokens?: number;
  },
): Promise<void> {
  try {
    await insertRow(sb, "ai_conversations", {
      user_id: entry.userId,
      role: entry.role,
      content: truncate(entry.content, 7900),
      source: entry.source,
      model: entry.model ?? null,
      tokens: entry.tokens ?? null,
    });
  } catch (error) {
    console.warn("conversation append failed:", (error as Error).message);
  }
}

export async function trimMemory(sb: SupabaseClient, userId: number, keep: number): Promise<void> {
  try {
    await callRpc(sb, "trim_conversation", { p_user_id: userId, p_keep: Math.max(keep, 2) });
  } catch (error) {
    console.warn("trim_conversation failed:", (error as Error).message);
  }
}

export async function dailyAiRequests(
  sb: SupabaseClient,
  userId: number,
  timeZone: string,
): Promise<number> {
  return await countRows(sb, "ai_usage", (q) =>
    q.eq("user_id", userId)
      .eq("request_type", "chat")
      .gte("created_at", startOfDayIso(timeZone)));
}

export interface AnswerOptions {
  userId: number;
  text: string;
  memoryEnabled?: boolean;
  language?: "fa" | "en";
}

// بدون هیچ اصطلاح فنی: پاسخ مثل یک جواب معمولی تمام می‌شود.
const QUOTA_NOTE_FA =
  "\n\n<i>سهمیهٔ گفتگوی امروزت پر شد؛ فردا دوباره سر بزن 🌙</i>";

export async function answerQuestion(deps: AiDeps, options: AnswerOptions): Promise<AiReply> {
  const { sb, settings, cfg } = deps;
  const language = options.language ?? detectLanguage(options.text);
  const startedAt = Date.now();

  const featureAi = await settings.get("feature_ai");
  const aiEnabled = await settings.get("ai_enabled");
  if (!featureAi || !aiEnabled) {
    const answer = language === "en"
      ? "The AI module is currently turned off by the administrators. You can use /anime <title> or /news."
      : "ماژول هوش مصنوعی توسط مدیران خاموش شده است. می‌توانی از <code>/anime نام انیمه</code> یا /news استفاده کنی.";
    return { text: answer, source: "system" };
  }

  const dailyLimit = await settings.get("ai_daily_limit");
  const usedToday = await dailyAiRequests(sb, options.userId, await settings.get("timezone"));
  const overQuota = dailyLimit > 0 && usedToday >= dailyLimit;

  const memoryLimit = (await settings.get("ai_memory_enabled"))
    ? await settings.get("ai_memory_messages")
    : 0;
  const memoryEnabled = options.memoryEnabled !== false && memoryLimit > 0;

  const state = await getAiState(sb);
  const apiConfigured = isGeminiConfigured(cfg.geminiApiKey);
  const shouldTryProvider = apiConfigured && !overQuota && !isFallbackActive(state) &&
    state.status !== "disabled";

  if (memoryEnabled) {
    await appendConversation(sb, {
      userId: options.userId,
      role: "user",
      content: options.text,
      source: "system",
    });
  }

  if (!shouldTryProvider) {
    const reply = await buildFallbackReply(sb, settings, cfg, options.text, language, {
      quotaExhausted: overQuota || state.status === "quota_exhausted",
      reason: !apiConfigured ? "not_configured" : overQuota ? "daily_quota" : "provider_cooldown",
    });
    await logAiUsage(sb, {
      userId: options.userId,
      requestType: "chat",
      latencyMs: Date.now() - startedAt,
      status: overQuota ? "rate_limited" : "fallback",
      errorCode: !apiConfigured ? "no_api_key" : overQuota ? "daily_quota" : "cooldown",
    });
    if (memoryEnabled) await persistAssistant(sb, options.userId, reply, "fallback", memoryLimit);
    return reply;
  }

  const personaBase = await settings.get("ai_persona");
  const persona =
    `${personaBase}\nپاسخ‌ها را کوتاه، دقیق و بدون اسپویل بده. اگر اطلاعاتی از Jikan ضمیمه شده، به آن تکیه کن و منبع را MyAnimeList ذکر کن.`;

  const includeAnime = await settings.get("ai_anime_context");
  let prompt = options.text;
  if (includeAnime && looksLikeAnimeInfoQuery(options.text)) {
    const context = await animeContextForAi(options.text, sb);
    if (context) {
      prompt = `اطلاعات معتبر از Jikan (MyAnimeList):\n${context}\n\nپرسش کاربر:\n${options.text}`;
    }
  }

  const history = memoryEnabled ? await loadHistory(sb, options.userId, memoryLimit) : [];
  const model = (await settings.get("ai_model")) || cfg.geminiModel;

  try {
    const result = await generateContent({
      apiKey: cfg.geminiApiKey,
      model,
      persona,
      prompt,
      history,
      maxRetries: await settings.get("ai_max_retries"),
      timeoutMs: 22_000,
      maxOutputTokens: 800,
    });

    await markAiSuccess(sb, result.model);
    await logAiUsage(sb, {
      userId: options.userId,
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      latencyMs: result.latencyMs,
      status: "success",
    });

    const reply: AiReply = {
      text: result.text,
      source: "gemini",
      model: result.model,
      latencyMs: result.latencyMs,
    };
    if (memoryEnabled) await persistAssistant(sb, options.userId, reply, "gemini", memoryLimit);
    return reply;
  } catch (error) {
    const providerError = error instanceof AiProviderError
      ? error
      : new AiProviderError((error as Error).message, { code: "unknown" });

    await markAiFailure(sb, providerError, await settings.get("ai_fallback_cooldown_seconds"));
    await logAiUsage(sb, {
      userId: options.userId,
      model,
      latencyMs: Date.now() - startedAt,
      status: providerError.quota ? "quota" : "error",
      errorCode: providerError.code,
    });

    const reply = await buildFallbackReply(sb, settings, cfg, options.text, language, {
      quotaExhausted: providerError.quota,
      reason: providerError.quota ? "provider_quota" : "provider_error",
    });
    if (memoryEnabled) await persistAssistant(sb, options.userId, reply, "fallback", memoryLimit);
    return reply;
  }
}

async function persistAssistant(
  sb: SupabaseClient,
  userId: number,
  reply: AiReply,
  source: "gemini" | "fallback",
  memoryLimit: number,
): Promise<void> {
  await appendConversation(sb, {
    userId,
    role: "assistant",
    content: reply.text,
    source,
    model: reply.model,
  });
  await trimMemory(sb, userId, memoryLimit * 2);
}

async function buildFallbackReply(
  sb: SupabaseClient,
  settings: SettingsStore,
  cfg: Pick<AppConfig, "botUsername" | "superAdminIds">,
  question: string,
  language: "fa" | "en",
  meta: { quotaExhausted: boolean; reason: string },
): Promise<AiReply> {
  const timeZone = await settings.get("timezone");
  const ownerId = cfg.superAdminIds[0];

  // فقط برای سوال درباره‌ی صاحب ربات، نام مالک از دیتابیس خوانده می‌شود.
  let ownerName: string | undefined;
  if (ownerId && /(صاحب|مالک|owner|admin|مدیر)/i.test(question)) {
    const ownerRow = await selectOne<
      { first_name: string | null; last_name: string | null; username: string | null }
    >(sb, "users", (q) => q.eq("telegram_id", ownerId));
    if (ownerRow) ownerName = displayName(ownerRow);
  }

  // ۱) موتور سریع داخلی (کارهای واقعی: محاسبه، ساعت، تصادفی، …)
  const offline = offlineAnswer(question, {
    timeZone,
    botUsername: cfg.botUsername,
    ownerName,
    ownerId,
  });

  const parts: string[] = [];
  let category = "";

  if (offline) {
    parts.push(offline.text);
    category = offline.category;
  } else {
    // ۲) دانش ذخیره‌شده (FAQ)
    const match = findFallback(question, { language });
    if (match) {
      parts.push(match.answer);
      category = match.category;
    } else {
      parts.push(genericFallback(language));
    }
  }

  if (!offline && await settings.get("ai_anime_context")) {
    if (category === "" || category === "title_info") {
      const query = question.replace(/انیمه|anime|اطلاعات|چیست|چیه/gi, "").trim();
      if (query.length >= 2) {
        const results = await searchAnime(query, { limit: 1, sb });
        if (results[0]) {
          parts.push(`\n\n📚 <b>اطلاعات انیمه:</b>\n${formatAnimeCard(results[0])}`);
        }
      }
    }
  }

  if (meta.quotaExhausted) parts.push(QUOTA_NOTE_FA);

  return {
    text: truncate(parts.join(""), 3900),
    source: "fallback",
    quotaExhausted: meta.quotaExhausted,
  };
}

export interface AiTestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
}

/** تست اتصال از داشبورد (یک درخواست کوچک، بدون حلقه). */
export async function testAiConnection(deps: AiDeps): Promise<AiTestResult> {
  const startedAt = Date.now();
  if (!isGeminiConfigured(deps.cfg.geminiApiKey)) {
    return {
      ok: false,
      message: "سرویس هوش مصنوعی وصل نشده است؛ پاسخ‌های سریع داخلی فعال هستند.",
      latencyMs: 0,
    };
  }
  try {
    const result = await generateContent({
      apiKey: deps.cfg.geminiApiKey,
      model: (await deps.settings.get("ai_model")) || deps.cfg.geminiModel,
      persona: "پاسخ کوتاه بده.",
      prompt: "سلام، فقط بنویس: OK",
      maxOutputTokens: 10,
      maxRetries: 0,
      timeoutMs: 12_000,
    });
    await markAiSuccess(deps.sb, result.model);
    await logAiUsage(deps.sb, {
      requestType: "health",
      model: result.model,
      latencyMs: result.latencyMs,
      status: "success",
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    });
    return {
      ok: true,
      message: `اتصال سالم است (${escapeHtml(truncate(result.text, 80))}).`,
      latencyMs: result.latencyMs,
    };
  } catch (error) {
    const providerError = error instanceof AiProviderError
      ? error
      : new AiProviderError((error as Error).message);
    await markAiFailure(
      deps.sb,
      providerError,
      await deps.settings.get("ai_fallback_cooldown_seconds"),
    );
    await logAiUsage(deps.sb, {
      requestType: "health",
      latencyMs: Date.now() - startedAt,
      status: providerError.quota ? "quota" : "error",
      errorCode: providerError.code,
    });
    return {
      ok: false,
      message: `اتصال برقرار نشد: ${escapeHtml(truncate(providerError.message, 200))}`,
      latencyMs: Date.now() - startedAt,
    };
  }
}

export async function aiUsageToday(sb: SupabaseClient, timeZone: string): Promise<{
  requests: number;
  fallbacks: number;
  quota: number;
  errors: number;
}> {
  const since = startOfDayIso(timeZone);
  const rows = await selectRows<Pick<AiUsageRow, "status">>(
    sb,
    "ai_usage",
    (q) => q.gte("created_at", since),
  );
  return {
    requests: rows.filter((row) => row.status === "success" || row.status === "fallback").length,
    fallbacks: rows.filter((row) => row.status === "fallback").length,
    quota: rows.filter((row) => row.status === "quota" || row.status === "rate_limited").length,
    errors: rows.filter((row) => row.status === "error").length,
  };
}
