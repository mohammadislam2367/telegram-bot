import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  buildCallback,
  escapeHtml,
  formatInZone,
  isValidCallbackData,
  isValidUrl,
  normalizeDigits,
  parseButtons,
  parseChatTarget,
  parseRepeatInterval,
  parseScheduleInput,
  parseTelegramId,
  sanitizeText,
  todayInZone,
  truncate,
  zonedTimeToUtc,
} from "../supabase/functions/_shared/validation.ts";

Deno.test("escapeHtml escapes only HTML-significant characters", () => {
  assertEquals(escapeHtml("a < b & c > d"), "a &lt; b &amp; c &gt; d");
  assertEquals(escapeHtml("«سلام»"), "«سلام»");
  assertEquals(escapeHtml("&amp;"), "&amp;amp;");
});

Deno.test("normalizeDigits converts Persian and Arabic digits", () => {
  assertEquals(normalizeDigits("۱۲۳۴۵"), "12345");
  assertEquals(normalizeDigits("٤٥٦"), "456");
  assertEquals(normalizeDigits("12۳"), "123");
});

Deno.test("parseTelegramId accepts numeric ids only", () => {
  assertEquals(parseTelegramId("123456789"), 123456789);
  assertEquals(parseTelegramId("۱۲۳۴۵۶۷۸۹"), 123456789);
  assertEquals(parseTelegramId("@username"), null);
  assertEquals(parseTelegramId("12"), null);
  assertEquals(parseTelegramId("abc123456"), null);
  assertEquals(parseTelegramId("0"), null);
});

Deno.test("parseChatTarget supports usernames, ids and t.me links", () => {
  assertEquals(parseChatTarget("@clickanime128"), "@clickanime128");
  assertEquals(parseChatTarget("-1001234567890"), "-1001234567890");
  assertEquals(parseChatTarget("https://t.me/clickanime128"), "@clickanime128");
  assertEquals(parseChatTarget("https://t.me/clickanime128/"), "@clickanime128");
  assertEquals(parseChatTarget("clickanime128"), null);
  assertEquals(parseChatTarget("@ab"), null);
});

Deno.test("isValidUrl accepts http(s) and tg links", () => {
  assert(isValidUrl("https://example.com/path?q=1"));
  assert(isValidUrl("http://example.com"));
  assert(isValidUrl("tg://user?id=1"));
  assertEquals(isValidUrl("javascript:alert(1)"), false);
  assertEquals(isValidUrl("example.com"), false);
});

Deno.test("parseButtons parses inline button lines", () => {
  const result = parseButtons("سایت | https://example.com\nکانال | https://t.me/clickanime128");
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.buttons.length, 2);
    assertEquals(result.buttons[0].text, "سایت");
    assertEquals(result.buttons[1].url, "https://t.me/clickanime128");
  }

  const empty = parseButtons("-");
  assert(empty.ok);
  if (empty.ok) assertEquals(empty.buttons.length, 0);

  assertEquals(parseButtons("بدون لینک").ok, false);
  assertEquals(
    parseButtons("a | https://a.com\nb | https://b.com\nc | https://c.com\nd | https://d.com").ok,
    false,
  );
  assertEquals(parseButtons("a | not-a-url").ok, false);
});

Deno.test("parseRepeatInterval understands fa/en values", () => {
  assertEquals(parseRepeatInterval("بدون تکرار"), "none");
  assertEquals(parseRepeatInterval("روزانه"), "daily");
  assertEquals(parseRepeatInterval("weekly"), "weekly");
  assertEquals(parseRepeatInterval("ماهانه"), "monthly");
  assertEquals(parseRepeatInterval("sometimes"), null);
});

Deno.test("parseScheduleInput handles now/relative/absolute/clock", () => {
  const now = new Date("2026-03-21T10:00:00.000Z");
  const timeZone = "Asia/Tehran";

  const nowResult = parseScheduleInput("now", { timeZone, now });
  assert(nowResult.ok);

  const relative = parseScheduleInput("2h", { timeZone, now });
  assert(relative.ok);
  if (relative.ok) {
    assertEquals(relative.date.getTime(), now.getTime() + 2 * 3_600_000);
  }

  const absolute = parseScheduleInput("2026-03-22 20:30", { timeZone, now });
  assert(absolute.ok);
  if (absolute.ok) {
    assertEquals(absolute.date.toISOString(), "2026-03-22T17:00:00.000Z");
  }

  const persianDigits = parseScheduleInput("۱۴۰۵-۰۱-۰۲ ۲۰:۳۰", { timeZone, now });
  assertEquals(persianDigits.ok, false); // سال ۱۴۰۵ با قالب میلادی پذیرفته نمی‌شود

  const past = parseScheduleInput("2020-01-01 10:00", { timeZone, now });
  assertEquals(past.ok, false);

  const clock = parseScheduleInput("20:30", { timeZone, now });
  assert(clock.ok);
  if (clock.ok) assert(clock.date.getTime() > now.getTime());

  const bad = parseScheduleInput("فردا ساعت ۸", { timeZone, now });
  assertEquals(bad.ok, false);
  if (!bad.ok) assert(bad.error.length > 0);
});

Deno.test("zonedTimeToUtc respects Iran offset (+03:30)", () => {
  const date = zonedTimeToUtc(2026, 3, 22, 0, 0, "Asia/Tehran");
  assertEquals(date.toISOString(), "2026-03-21T20:30:00.000Z");
});

Deno.test("todayInZone and formatInZone produce Persian output", () => {
  const day = todayInZone("Asia/Tehran", new Date("2026-03-21T21:00:00.000Z"));
  assertEquals(day, "2026-03-22");
  assert(formatInZone(new Date("2026-03-21T21:00:00.000Z"), "Asia/Tehran").length > 0);
});

Deno.test("callback data helpers enforce the 64-byte limit", () => {
  assertEquals(isValidCallbackData("a:h"), true);
  assertEquals(isValidCallbackData(""), false);
  assertEquals(isValidCallbackData("x".repeat(65)), false);
  assertEquals(buildCallback("a", "ad", "v", "1234"), "a:ad:v:1234");
  assertThrows(() => buildCallback("a", "x".repeat(70)));
});

Deno.test("sanitizeText strips control characters and truncates", () => {
  const cleaned = sanitizeText("سلام\u0000\u0007 دنیا", 100);
  assertEquals(cleaned.includes("\u0000"), false);
  assertEquals(truncate("abcdefghij", 6).length, 6);
  assertEquals(truncate("abc", 10), "abc");
});
