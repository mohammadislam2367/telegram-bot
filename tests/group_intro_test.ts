import { assertEquals } from "@std/assert";
import { isIntroCommand } from "../supabase/functions/telegram-bot/group_intro.ts";

Deno.test("intro commands are detected in groups", () => {
  assertEquals(isIntroCommand("/start", "Spixle_bot"), true);
  assertEquals(isIntroCommand("/start@Spixle_bot", "Spixle_bot"), true);
  assertEquals(isIntroCommand("/start@spixle_bot", "Spixle_bot"), true);
  assertEquals(isIntroCommand("/help", "Spixle_bot"), true);
  assertEquals(isIntroCommand("/menu", "Spixle_bot"), true);
});

Deno.test("intro detection ignores other commands and bots", () => {
  assertEquals(isIntroCommand("/start@other_bot", "Spixle_bot"), false);
  assertEquals(isIntroCommand("/warn", "Spixle_bot"), false);
  assertEquals(isIntroCommand("/starter", "Spixle_bot"), false);
  assertEquals(isIntroCommand("start", "Spixle_bot"), false);
  assertEquals(isIntroCommand("", "Spixle_bot"), false);
});
