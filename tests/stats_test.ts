import { assert, assertEquals } from "@std/assert";
import {
  dayBounds,
  type OverviewStats,
  renderOverview,
  renderSeries,
  shiftDay,
} from "../supabase/functions/_shared/stats_core.ts";
import { barChart, faNum, faPercent, progressLine } from "../supabase/functions/_shared/texts.ts";

Deno.test("dayBounds converts Tehran local days to UTC", () => {
  const { start, end } = dayBounds("2026-03-22", "Asia/Tehran");
  assertEquals(start, "2026-03-21T20:30:00.000Z");
  assertEquals(end, "2026-03-22T20:30:00.000Z");
});

Deno.test("shiftDay handles month and leap-year boundaries", () => {
  assertEquals(shiftDay("2026-03-01", -1), "2026-02-28");
  assertEquals(shiftDay("2024-03-01", -1), "2024-02-29");
  assertEquals(shiftDay("2026-12-31", 1), "2027-01-01");
});

Deno.test("barChart and progressLine stay within width", () => {
  assertEquals(barChart(0, 10, 5), "▱▱▱▱▱");
  assertEquals(barChart(10, 10, 5), "▰▰▰▰▰");
  assertEquals(barChart(5, 10, 4).length, 4);
  assert(progressLine(5, 10).includes("۵۰٪"));
});

Deno.test("faNum and faPercent formatting", () => {
  assertEquals(faNum(1234), "۱٬۲۳۴");
  assertEquals(faPercent(1, 4), "۲۵٪");
  assertEquals(faPercent(1, 0), "۰٪");
});

const overview: OverviewStats = {
  totalUsers: 1200,
  newUsersToday: 30,
  active7d: 400,
  activeToday: 90,
  blockedUsers: 7,
  groups: 4,
  admins: 2,
  messagesToday: 500,
  messagesYesterday: 400,
  aiRequestsToday: 120,
  aiFallbacksToday: 20,
  aiQuotaToday: 3,
  aiErrorsToday: 1,
  errorsToday: 2,
  adsSent: 15,
  adsActive: 3,
  postsPublished: 22,
  campaignsActive: 1,
  pendingBroadcastRows: 40,
  scheduledPending: 2,
  warningsActive: 5,
  moderation24h: 11,
  generatedAt: new Date().toISOString(),
};

Deno.test("renderOverview contains the required statistics sections", () => {
  const text = renderOverview(overview);
  assert(text.includes("آمار کلی"));
  assert(text.includes("کاربران"));
  assert(text.includes("پیام‌ها"));
  assert(text.includes("AI"));
  assert(text.includes("تبلیغات"));
  assert(text.includes("گروه‌های فعال"));
  assert(text.includes("۱٬۲۰۰"));
  assert(text.includes("▲"));
});

Deno.test("renderSeries renders one bar line per day plus totals", () => {
  const rows = [0, 1, 2, 3, 4, 5, 6].map((i) => ({
    day: `2026-03-2${i}`,
    new_users: 2,
    active_users: 10,
    messages: 100 + i * 10,
    ai_requests: 5,
    ai_fallbacks: 1,
    ads_sent: 1,
    posts_sent: 1,
    errors: 0,
    blocked_users: 0,
    created_at: "",
    updated_at: "",
  }));
  const text = renderSeries(rows);
  assertEquals(
    text.split("\n").filter((line) => line.includes("▰") || line.includes("▱")).length,
    7,
  );
  assert(text.includes("کاربر جدید"));
  assert(text.includes("خطا"));
});
