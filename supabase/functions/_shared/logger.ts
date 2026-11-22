/** Structured logging → console + public.system_logs (never throws). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertRow } from "./db.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  scope: string;
  message: string;
  context?: Record<string, unknown>;
  telegramUserId?: number;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): Promise<void>;
  info(message: string, context?: Record<string, unknown>): Promise<void>;
  warn(message: string, context?: Record<string, unknown>): Promise<void>;
  error(message: string, context?: Record<string, unknown>): Promise<void>;
  child(scope: string, telegramUserId?: number): Logger;
}

function safeContext(context?: Record<string, unknown>): Record<string, unknown> {
  if (!context) return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (/token|secret|key|password|authorization/i.test(key)) continue;
    if (typeof value === "string" && value.length > 500) {
      result[key] = `${value.slice(0, 500)}…`;
    } else if (value instanceof Error) {
      result[key] = value.message;
    } else {
      result[key] = value;
    }
  }
  return result;
}

export async function logToDb(sb: SupabaseClient, entry: LogEntry): Promise<void> {
  const context = safeContext(entry.context);
  try {
    await insertRow(sb, "system_logs", {
      level: entry.level,
      scope: entry.scope.slice(0, 100),
      message: entry.message.slice(0, 1000),
      context,
      telegram_user_id: entry.telegramUserId ?? null,
    });
  } catch (error) {
    console.warn(
      `[${entry.scope}] ${entry.message} (log persist failed: ${(error as Error).message})`,
    );
  }
}

export function createLogger(
  sb: SupabaseClient,
  scope: string,
  telegramUserId?: number,
): Logger {
  const write = async (level: LogLevel, message: string, context?: Record<string, unknown>) => {
    const context2 = safeContext(context);
    if (level === "error") console.error(`[${scope}]`, message, context2);
    else if (level === "warn") console.warn(`[${scope}]`, message, context2);
    else console.log(`[${scope}]`, message, context2);
    await logToDb(sb, { level, scope, message, context: context2, telegramUserId });
  };

  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
    child: (childScope, childUserId) =>
      createLogger(sb, `${scope}/${childScope}`, childUserId ?? telegramUserId),
  };
}
