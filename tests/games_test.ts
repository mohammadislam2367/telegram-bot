import { assertEquals } from "@std/assert";
import {
  EIGHT_BALL,
  parseChoices,
  parseMove,
  rpsOutcome,
} from "../supabase/functions/telegram-bot/games.ts";
import { QUIZ_BANK } from "../supabase/functions/telegram-bot/quiz_data.ts";

Deno.test("quiz bank is consistent", () => {
  assertEquals(QUIZ_BANK.length >= 10, true);
  assertEquals(new Set(QUIZ_BANK.map((item) => item.q)).size, QUIZ_BANK.length);
  for (const item of QUIZ_BANK) {
    assertEquals(item.options.length, 4);
    assertEquals(item.answer >= 0 && item.answer <= 3, true);
    assertEquals(item.options[item.answer].length > 0, true);
  }
});

Deno.test("rps outcome covers win, lose and draw", () => {
  assertEquals(rpsOutcome("rock", "scissors"), "win");
  assertEquals(rpsOutcome("rock", "paper"), "lose");
  assertEquals(rpsOutcome("paper", "paper"), "draw");
  assertEquals(rpsOutcome("scissors", "paper"), "win");
  assertEquals(rpsOutcome("paper", "scissors"), "lose");
});

Deno.test("parseMove accepts persian and english moves", () => {
  assertEquals(parseMove("سنگ"), "rock");
  assertEquals(parseMove("کاغذ"), "paper");
  assertEquals(parseMove("قیچی"), "scissors");
  assertEquals(parseMove(" Rock "), "rock");
  assertEquals(parseMove("توپ"), null);
});

Deno.test("parseChoices splits persian separators", () => {
  assertEquals(parseChoices("پیتزا، سوشی، کباب"), ["پیتزا", "سوشی", "کباب"]);
  assertEquals(parseChoices("a | b"), ["a", "b"]);
  assertEquals(parseChoices("شیر یا خط"), ["شیر", "خط"]);
  assertEquals(parseChoices(""), []);
});

Deno.test("eight ball has a small answer bank", () => {
  assertEquals(EIGHT_BALL.length >= 5, true);
  assertEquals(EIGHT_BALL.every((line) => line.length > 0), true);
});
