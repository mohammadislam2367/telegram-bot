import { assert, assertEquals } from "@std/assert";
import {
  detectLanguage,
  fallbackCategories,
  fallbackCount,
  findFallback,
  genericFallback,
  looksLikeAnimeInfoQuery,
  normalizeQuery,
} from "../supabase/functions/_shared/ai_fallback.ts";
import { FALLBACK_ENTRIES } from "../supabase/functions/_shared/fallback_data.ts";

Deno.test("fallback dataset has at least 100 unique answers", () => {
  assert(fallbackCount() >= 100, `count=${fallbackCount()}`);
  const ids = new Set(FALLBACK_ENTRIES.map((entry) => entry.id));
  assertEquals(ids.size, FALLBACK_ENTRIES.length);
  for (const entry of FALLBACK_ENTRIES) {
    assert(entry.keywords.length > 0, entry.id);
    assert(entry.answer.length > 20, entry.id);
    assert(entry.category.length > 0, entry.id);
  }
});

Deno.test("fallback dataset covers the required categories", () => {
  const categories = fallbackCategories();
  for (
    const category of [
      "greeting",
      "bot_help",
      "anime_knowledge",
      "recommendation",
      "title_info",
      "studio",
      "film",
      "privacy",
      "technical",
    ]
  ) {
    assert(categories.includes(category), category);
  }
  assert(categories.length >= 10);
});

Deno.test("normalizeQuery unifies Arabic/Persian characters and punctuation", () => {
  assertEquals(normalizeQuery("  سلام، چطوری؟  "), "سلام چطوری");
  assertEquals(normalizeQuery("انيمي"), "انیمی");
  assertEquals(normalizeQuery("Attack on Titan!"), "attack on titan");
  assertEquals(normalizeQuery("۱۲۳"), "123");
});

Deno.test("detectLanguage picks Persian vs English", () => {
  assertEquals(detectLanguage("سلام خوبی"), "fa");
  assertEquals(detectLanguage("hello there"), "en");
  assertEquals(detectLanguage("انیمه Attack on Titan"), "fa");
});

Deno.test("findFallback matches greetings", () => {
  const match = findFallback("سلام");
  assert(match);
  if (match) {
    assertEquals(match.category, "greeting");
    assert(match.score >= 2.5);
  }
});

Deno.test("findFallback matches recommendations by genre", () => {
  const match = findFallback("یه انیمه اکشن خوب پیشنهاد بده");
  assert(match);
  if (match) assertEquals(match.category, "recommendation");
});

Deno.test("findFallback answers title questions with the right category", () => {
  const match = findFallback("اتک آن تایتان چیه؟");
  assert(match);
  if (match) {
    assertEquals(match.category, "title_info");
    assert(match.answer.includes("Attack on Titan"));
  }
});

Deno.test("findFallback answers English queries", () => {
  const match = findFallback("recommend a romance anime");
  assert(match);
  if (match) assert(match.answer.length > 10);
});

Deno.test("findFallback returns null for gibberish", () => {
  assertEquals(findFallback("qwzxvbnm asdfghjkl"), null);
});

Deno.test("genericFallback is always safe to send", () => {
  assert(genericFallback("fa").includes("پاسخ"));
  assert(genericFallback("en").toLowerCase().includes("saved answer"));
});

Deno.test("looksLikeAnimeInfoQuery detects anime info requests", () => {
  assertEquals(looksLikeAnimeInfoQuery("انیمه جوجوتسو چیه"), true);
  assertEquals(looksLikeAnimeInfoQuery("what is Frieren about"), true);
  assertEquals(looksLikeAnimeInfoQuery("سلام خوبی"), false);
});
