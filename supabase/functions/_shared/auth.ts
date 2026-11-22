/**
 * Authorization — سطوح دسترسی مدیران ربات، مستقل از ادمین‌بودن در گروه تلگرام.
 * هر callback مدیریتی دوباره از این ماژول عبور می‌کند.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectOne, upsertRow } from "./db.ts";
import type { TelegramApi } from "./telegram.ts";
import { TelegramError } from "./telegram.ts";
import type { AdminRole, AdminRow, ChatId, TgChatMember } from "./types.ts";

export type { AdminRole } from "./types.ts";

export const PERMISSIONS = [
  "stats.read",
  "users.read",
  "users.manage",
  "bans.manage",
  "ads.read",
  "ads.manage",
  "broadcast.read",
  "broadcast.manage",
  "schedule.manage",
  "ai.read",
  "ai.manage",
  "content.read",
  "content.manage",
  "groups.read",
  "groups.manage",
  "settings.manage",
  "security.read",
  "tools.use",
  "admins.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READ_ALL: Permission[] = [...PERMISSIONS];
const SUPER_ADMIN_PERMISSIONS: Permission[] = PERMISSIONS.filter((p) => p !== "admins.manage");

export const ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
  owner: READ_ALL,
  super_admin: SUPER_ADMIN_PERMISSIONS,
  admin: [
    "stats.read",
    "users.read",
    "users.manage",
    "bans.manage",
    "ads.read",
    "ads.manage",
    "broadcast.read",
    "broadcast.manage",
    "schedule.manage",
    "ai.read",
    "ai.manage",
    "content.read",
    "content.manage",
    "groups.read",
    "groups.manage",
    "security.read",
    "tools.use",
  ],
  moderator: [
    "stats.read",
    "users.read",
    "bans.manage",
    "ads.read",
    "broadcast.read",
    "content.read",
    "groups.read",
    "groups.manage",
  ],
};

export const ROLE_LABELS: Record<AdminRole, string> = {
  owner: "مالک اصلی",
  super_admin: "مدیر ارشد",
  admin: "مدیر",
  moderator: "ناظر",
};

export interface AdminIdentity {
  userId: number;
  role: AdminRole;
  permissions: Permission[];
  isActive: boolean;
}

export class PermissionError extends Error {
  constructor(readonly permission: Permission) {
    super(`دسترسی لازم: ${permission}`);
    this.name = "PermissionError";
  }
}

function uniquePermissions(list: Permission[]): Permission[] {
  return [...new Set(list)];
}

export function permissionsForRole(role: AdminRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(
  admin: AdminIdentity | null | undefined,
  permission: Permission,
): boolean {
  if (!admin || !admin.isActive) return false;
  return admin.permissions.includes(permission);
}

export function requirePermission(
  admin: AdminIdentity | null | undefined,
  permission: Permission,
): void {
  if (!hasPermission(admin, permission)) throw new PermissionError(permission);
}

/** ساخت هویت از ردیف DB + لیست SUPER_ADMIN_IDS. */
export function buildAdminIdentity(input: {
  userId: number;
  isSuperAdmin: boolean;
  row: Pick<AdminRow, "role" | "permissions" | "is_active"> | null;
}): AdminIdentity | null {
  if (input.isSuperAdmin) {
    return {
      userId: input.userId,
      role: "owner",
      permissions: [...PERMISSIONS],
      isActive: true,
    };
  }
  if (!input.row || !input.row.is_active) return null;

  const extra = (input.row.permissions ?? []).filter((p): p is Permission =>
    (PERMISSIONS as readonly string[]).includes(p)
  );
  return {
    userId: input.userId,
    role: input.row.role,
    permissions: uniquePermissions([...permissionsForRole(input.row.role), ...extra]),
    isActive: true,
  };
}

/** خواندن مدیر از DB؛ در صورت نبود ردیف برای SUPER_ADMIN_IDS، مالک ساخته می‌شود. */
export async function getAdmin(
  sb: SupabaseClient,
  userId: number,
  superAdminIds: number[],
): Promise<AdminIdentity | null> {
  const isSuperAdmin = superAdminIds.includes(userId);
  const row = await selectOne<AdminRow>(sb, "admins", (q) => q.eq("user_id", userId));

  if (!row && isSuperAdmin) {
    try {
      await upsertRow(
        sb,
        "admins",
        { user_id: userId, role: "owner", permissions: [], is_active: true },
        "user_id",
      );
    } catch (error) {
      console.warn("bootstrap owner failed:", (error as Error).message);
    }
    return buildAdminIdentity({ userId, isSuperAdmin: true, row: null });
  }

  return buildAdminIdentity({ userId, isSuperAdmin, row });
}

export async function listAdmins(sb: SupabaseClient): Promise<AdminRow[]> {
  const { selectRows } = await import("./db.ts");
  return await selectRows<AdminRow>(
    sb,
    "admins",
    (q) => q.order("created_at", { ascending: true }),
  );
}

export function canManageRole(actor: AdminIdentity, targetRole: AdminRole): boolean {
  if (actor.role === "owner") return true;
  if (targetRole === "owner" || targetRole === "super_admin") return false;
  return hasPermission(actor, "admins.manage");
}

/** مقایسه‌ی زمان-ثابت برای Secret ها */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);
  let diff = bytesA.length ^ bytesB.length;
  const length = Math.max(bytesA.length, bytesB.length);
  for (let i = 0; i < length; i++) {
    diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0);
  }
  return diff === 0 && bytesA.length > 0;
}

export function verifyWebhookSecret(provided: string | null, expected: string): boolean {
  if (!expected || !provided) return false;
  return timingSafeEqual(provided, expected);
}

export function verifySchedulerSecret(provided: string | null, expected: string): boolean {
  if (!expected || !provided) return false;
  const token = provided.startsWith("Bearer ") ? provided.slice(7) : provided;
  return timingSafeEqual(token, expected);
}

export interface GroupAdminResult {
  isAdmin: boolean;
  member: TgChatMember | null;
  error?: string;
}

/** کش کوتاه‌عمر بررسی ادمین گروه (هر نمونه‌ی اجرا). */
export class GroupAdminChecker {
  private cache = new Map<string, { result: GroupAdminResult; expiresAt: number }>();

  constructor(
    private readonly tg: TelegramApi,
    private readonly ttlMs = 60_000,
  ) {}

  async getMember(chatId: ChatId, userId: number): Promise<GroupAdminResult> {
    const key = `${chatId}:${userId}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.result;

    let result: GroupAdminResult;
    try {
      const member = await this.tg.getChatMember(chatId, userId);
      result = {
        isAdmin: member.status === "creator" || member.status === "administrator",
        member,
      };
    } catch (error) {
      result = {
        isAdmin: false,
        member: null,
        error: error instanceof TelegramError ? error.description : (error as Error).message,
      };
    }
    this.cache.set(key, { result, expiresAt: Date.now() + this.ttlMs });
    if (this.cache.size > 500) {
      for (const [k, v] of this.cache) {
        if (v.expiresAt <= Date.now()) this.cache.delete(k);
      }
    }
    return result;
  }
}
