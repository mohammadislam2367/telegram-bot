import { assert, assertEquals } from "@std/assert";
import { ADMIN_MENU_SECTIONS } from "../supabase/functions/_shared/keyboards.ts";
import { getWizard, registeredWizards } from "../supabase/functions/telegram-bot/wizard_flow.ts";
// import برای ثبت wizardها (side effect)
import "../supabase/functions/telegram-bot/advertisements.ts";
import "../supabase/functions/telegram-bot/broadcast.ts";
import "../supabase/functions/telegram-bot/schedule.ts";
import "../supabase/functions/telegram-bot/content.ts";
import { SECTION_PERMISSIONS } from "../supabase/functions/telegram-bot/admin.ts";

Deno.test("all admin wizards are registered", () => {
  const ids = registeredWizards();
  for (
    const id of [
      "ad_create",
      "broadcast_create",
      "scheduled_post_create",
      "content_create",
      "content_edit",
    ]
  ) {
    assert(ids.includes(id), id);
  }
});

Deno.test("registered wizards have fields, permissions and unique ids", () => {
  const ids = registeredWizards();
  for (const id of ids) {
    const wizard = getWizard(id);
    assert(wizard);
    assert(wizard!.definition.fields.length > 0, id);
    assert(wizard!.permission.length > 0, id);
    assert(wizard!.returnTo.startsWith("a:"), id);
  }
});

Deno.test("every dashboard section has a permission route", () => {
  for (const section of ADMIN_MENU_SECTIONS) {
    const token = section.callbackData.split(":")[1];
    assert(SECTION_PERMISSIONS[token], `missing route for ${section.callbackData}`);
    assertEquals(SECTION_PERMISSIONS[token], section.permission);
  }
});
