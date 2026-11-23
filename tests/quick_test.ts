import { assertEquals } from "@std/assert";
import { bioText, taglineFor } from "../supabase/functions/telegram-bot/quick.ts";

Deno.test("tagline is deterministic and in range", () => {
  assertEquals(taglineFor(12345), taglineFor(12345));
  assertEquals(taglineFor(0).length > 0, true);
  assertEquals(taglineFor(-7).length > 0, true);
  assertEquals(taglineFor(Number.MAX_SAFE_INTEGER).length > 0, true);
});

Deno.test("bio card shows name, username and id", () => {
  const text = bioText({
    id: 555,
    is_bot: false,
    first_name: "علی",
    last_name: "رضایی",
    username: "ali_r",
  });
  assertEquals(text.includes("علی رضایی"), true);
  assertEquals(text.includes("@ali_r"), true);
  assertEquals(text.includes("555"), true);
  assertEquals(text.includes(taglineFor(555)), true);
});

Deno.test("bio card handles missing username and last name", () => {
  const text = bioText({ id: 7, is_bot: false, first_name: "Sara" });
  assertEquals(text.includes("Sara"), true);
  assertEquals(text.includes("نام کاربری: ندارد"), true);
});
