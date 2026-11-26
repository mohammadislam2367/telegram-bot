import { assertEquals } from "@std/assert";
import { isPhishing } from "../supabase/functions/telegram-bot/locks.ts";

Deno.test("isPhishing: لینک + عبارت طعمه", () => {
  assertEquals(isPhishing("جایزه ۵۰ میلیونی: https://scam.example"), true);
  assertEquals(isPhishing("برای دریافت هدیه رایگان کلیک کن t.me/scamchan"), true);
});

Deno.test("isPhishing: دامنهٔ تقلیدی تلگرام", () => {
  assertEquals(isPhishing("ورود به حساب از telegrom.ir"), true);
  assertEquals(isPhishing("https://telegramlogin.app/"), true);
});

Deno.test("isPhishing: پیام و لینک بی‌خطر", () => {
  assertEquals(isPhishing("سلام خوبی؟"), false);
  assertEquals(isPhishing("این ریپو را ببین https://github.com/denoland/deno"), false);
  assertEquals(isPhishing(""), false);
});
