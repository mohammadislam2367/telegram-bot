import { assertEquals } from "@std/assert";
import { containsLink, parseGroupCommand } from "../supabase/functions/telegram-bot/moderation.ts";

Deno.test("containsLink detects urls, t.me links and mentions", () => {
  assertEquals(containsLink("سلام دوستان", undefined), false);
  assertEquals(containsLink("https://example.com", undefined), true);
  assertEquals(containsLink("به www.example.com بروید", undefined), true);
  assertEquals(containsLink("t.me/clickanime128", undefined), true);
  assertEquals(containsLink("telegram.me/group", undefined), true);
  assertEquals(containsLink("@clickanime", undefined), true);
  assertEquals(containsLink("abcd @ab", undefined), false);
});

Deno.test("containsLink respects entities even without visible urls", () => {
  assertEquals(containsLink("اینجا کلیک کن", [{ type: "text_link" }]), true);
  assertEquals(containsLink("سلام", [{ type: "bold" }]), false);
  assertEquals(containsLink("user", [{ type: "mention" }]), true);
});

Deno.test("parseGroupCommand parses commands and bot mentions", () => {
  const parsed = parseGroupCommand("/ban@Spixle_bot 123456 spam", "Spixle_bot");
  assertEquals(parsed?.command, "ban");
  assertEquals(parsed?.args, "123456 spam");

  const otherBot = parseGroupCommand("/ban@OtherBot 1", "Spixle_bot");
  assertEquals(otherBot, null);

  const noArgs = parseGroupCommand("/rules", "Spixle_bot");
  assertEquals(noArgs?.command, "rules");
  assertEquals(noArgs?.args, "");

  const plain = parseGroupCommand("سلام", "Spixle_bot");
  assertEquals(plain, null);
});

Deno.test("parseGroupCommand is case-insensitive and trims args", () => {
  const parsed = parseGroupCommand("/WARN@Spixle_Bot   123   دلیل", "Spixle_bot");
  assertEquals(parsed?.command, "warn");
  assertEquals(parsed?.args, "123   دلیل");
});
