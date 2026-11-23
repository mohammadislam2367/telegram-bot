import { assertEquals } from "@std/assert";
import {
  clockInfo,
  formatNumber,
  pickOne,
  randomInt,
  safeCalc,
  textStats,
} from "../supabase/functions/_shared/toolbox.ts";

function value(expr: string): number {
  const result = safeCalc(expr);
  assertEquals(result.ok, true, `expected ok for ${expr}`);
  return result.ok ? result.value : NaN;
}

Deno.test("calc respects precedence and parentheses", () => {
  assertEquals(value("2+3*4"), 14);
  assertEquals(value("(2+3)*4"), 20);
  assertEquals(value("2^3^2"), 512);
  assertEquals(value("-5+2"), -3);
  assertEquals(value("10%4"), 2);
});

Deno.test("calc accepts persian digits and symbols", () => {
  assertEquals(value("۲×۳"), 6);
  assertEquals(value("۱۰÷۴"), 2.5);
  assertEquals(value("۱،۰۰۰+۵"), 1005);
  assertEquals(value("٥+٥"), 10);
});

Deno.test("calc rejects bad input instead of throwing", () => {
  assertEquals(safeCalc("").ok, false);
  assertEquals(safeCalc("2/0").ok, false);
  assertEquals(safeCalc("alert(1)").ok, false);
  assertEquals(safeCalc("(1+2").ok, false);
  assertEquals(safeCalc("2+").ok, false);
  assertEquals(safeCalc("1".repeat(200)).ok, false);
});

Deno.test("formatNumber trims noise", () => {
  assertEquals(formatNumber(0.1 + 0.2), "0.3");
  assertEquals(formatNumber(5), "5");
});

Deno.test("clock info has time and date", () => {
  const info = clockInfo(new Date("2026-11-23T12:00:00Z"), "Asia/Tehran");
  assertEquals(info.time.includes(":"), true);
  assertEquals(info.date.length > 0, true);
  assertEquals(info.zone, "Asia/Tehran");
});

Deno.test("random helpers stay in range", () => {
  assertEquals(randomInt(1, 1, () => 0.99), 1);
  assertEquals(randomInt(5, 1, () => 0), 1);
  assertEquals(randomInt(1, 10, () => 0.999999), 10);
  assertEquals(pickOne(["a", "b"], () => 0), "a");
  assertEquals(pickOne(["a", "b"], () => 0.999), "b");
  assertEquals(pickOne([], () => 0), null);
});

Deno.test("text stats count words and chars", () => {
  const stats = textStats("سلام دنیا\nخط دوم");
  assertEquals(stats.words, 4);
  assertEquals(stats.lines, 2);
  assertEquals(stats.charsNoSpace, "سلامدنیاخطدوم".length);
  assertEquals(stats.readingSeconds >= 1, true);
});
