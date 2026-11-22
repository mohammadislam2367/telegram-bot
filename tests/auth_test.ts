import { assert, assertEquals } from "@std/assert";
import {
  buildAdminIdentity,
  canManageRole,
  GroupAdminChecker,
  hasPermission,
  type Permission,
  PermissionError,
  PERMISSIONS,
  permissionsForRole,
  requirePermission,
  ROLE_PERMISSIONS,
  timingSafeEqual,
  verifySchedulerSecret,
  verifyWebhookSecret,
} from "../supabase/functions/_shared/auth.ts";
import type { TelegramApi } from "../supabase/functions/_shared/telegram.ts";
import type { TgChatMember } from "../supabase/functions/_shared/types.ts";

Deno.test("role permission matrix", () => {
  assert(permissionsForRole("owner").includes("admins.manage"));
  assert(permissionsForRole("super_admin").includes("settings.manage"));
  assertEquals(permissionsForRole("super_admin").includes("admins.manage"), false);
  assert(permissionsForRole("admin").includes("broadcast.manage"));
  assert(permissionsForRole("moderator").includes("groups.manage"));
  assertEquals(permissionsForRole("moderator").includes("broadcast.manage"), false);
  for (const role of Object.keys(ROLE_PERMISSIONS)) {
    assert(ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS].length > 0);
  }
});

Deno.test("buildAdminIdentity honours super admins and inactive rows", () => {
  const owner = buildAdminIdentity({ userId: 1, isSuperAdmin: true, row: null });
  assert(owner);
  assertEquals(owner?.role, "owner");
  assertEquals(owner?.permissions.length, PERMISSIONS.length);

  const inactive = buildAdminIdentity({
    userId: 2,
    isSuperAdmin: false,
    row: { role: "admin", permissions: [], is_active: false },
  });
  assertEquals(inactive, null);

  const extra = buildAdminIdentity({
    userId: 3,
    isSuperAdmin: false,
    row: {
      role: "moderator",
      permissions: ["broadcast.manage", "invalid.perm"] as Permission[],
      is_active: true,
    },
  });
  assert(extra);
  assertEquals(extra?.permissions.includes("broadcast.manage"), true);
  assertEquals(extra?.permissions.includes("groups.manage"), true);
  assertEquals((extra?.permissions as string[]).includes("invalid.perm"), false);
});

Deno.test("hasPermission and requirePermission", () => {
  const moderator = buildAdminIdentity({
    userId: 4,
    isSuperAdmin: false,
    row: { role: "moderator", permissions: [], is_active: true },
  });
  assert(hasPermission(moderator, "users.read"));
  assertEquals(hasPermission(moderator, "settings.manage"), false);
  assertEquals(hasPermission(null, "users.read"), false);

  let threw = false;
  try {
    requirePermission(moderator, "settings.manage");
  } catch (error) {
    threw = error instanceof PermissionError;
  }
  assertEquals(threw, true);
});

Deno.test("canManageRole protects owner and super admins", () => {
  const owner = buildAdminIdentity({ userId: 1, isSuperAdmin: true, row: null })!;
  const moderator = buildAdminIdentity({
    userId: 2,
    isSuperAdmin: false,
    row: { role: "moderator", permissions: [], is_active: true },
  })!;
  const admin = buildAdminIdentity({
    userId: 3,
    isSuperAdmin: false,
    row: { role: "admin", permissions: [], is_active: true },
  })!;

  assertEquals(canManageRole(owner, "admin"), true);
  assertEquals(canManageRole(owner, "owner"), true);
  assertEquals(canManageRole(moderator, "admin"), false);
  assertEquals(canManageRole(admin, "moderator"), false);
});

Deno.test("timingSafeEqual and secret verification", () => {
  assertEquals(timingSafeEqual("abcd", "abcd"), true);
  assertEquals(timingSafeEqual("abcd", "abce"), false);
  assertEquals(timingSafeEqual("abcd", "abcde"), false);
  assertEquals(timingSafeEqual("", ""), false);

  assertEquals(verifyWebhookSecret("secret", "secret"), true);
  assertEquals(verifyWebhookSecret("bad", "secret"), false);
  assertEquals(verifyWebhookSecret(null, "secret"), false);
  assertEquals(verifyWebhookSecret("secret", ""), false);
  assertEquals(verifySchedulerSecret("Bearer secret", "secret"), true);
  assertEquals(verifySchedulerSecret("secret", "secret"), true);
  assertEquals(verifySchedulerSecret("nope", "secret"), false);
});

Deno.test("GroupAdminChecker caches Telegram admin lookups", async () => {
  let calls = 0;
  const fakeTelegram = {
    getChatMember: (_chatId: number, userId: number): Promise<TgChatMember> => {
      calls++;
      return Promise.resolve({
        status: userId === 10 ? "creator" : "member",
        user: { id: userId, is_bot: false, first_name: "u" },
      });
    },
  } as unknown as TelegramApi;

  const checker = new GroupAdminChecker(fakeTelegram, 60_000);
  assertEquals((await checker.getMember(-100, 10)).isAdmin, true);
  assertEquals((await checker.getMember(-100, 10)).isAdmin, true);
  assertEquals(calls, 1);
  assertEquals((await checker.getMember(-100, 11)).isAdmin, false);
  assertEquals(calls, 2);
});
