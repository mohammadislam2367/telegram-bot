/** Telegram Bot API types (subset used by Anime Click Ultimate) + DB row types. */

export type ChatId = number | string;

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_forum?: boolean;
  migrated_to_chat_id?: number;
}

export interface TgMessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
  user?: TgUser;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  date: number;
  chat: TgChat;
  text?: string;
  caption?: string;
  entities?: TgMessageEntity[];
  caption_entities?: TgMessageEntity[];
  new_chat_members?: TgUser[];
  left_chat_member?: TgUser;
  reply_to_message?: TgMessage;
  forward_origin?: Record<string, unknown>;
  forward_date?: number;
  is_automatic_forward?: boolean;
  sender_chat?: TgChat;
  photo?: { file_id: string; file_unique_id: string; width: number; height: number }[];
  video?: { file_id: string; duration: number };
  animation?: { file_id: string };
  document?: { file_id: string };
  audio?: { file_id: string };
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  inline_message_id?: string;
  chat_instance: string;
  data?: string;
}

export interface TgChatMember {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
  user: TgUser;
  is_anonymous?: boolean;
  can_restrict_members?: boolean;
  can_delete_messages?: boolean;
  can_pin_messages?: boolean;
  can_invite_users?: boolean;
  can_change_info?: boolean;
  until_date?: number;
}

export interface TgChatMemberUpdated {
  chat: TgChat;
  from: TgUser;
  date: number;
  old_chat_member: TgChatMember;
  new_chat_member: TgChatMember;
  invite_link?: { invite_link: string };
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
  callback_query?: TgCallbackQuery;
  chat_member?: TgChatMemberUpdated;
  my_chat_member?: TgChatMemberUpdated;
}

export interface TgInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TgInlineKeyboardMarkup {
  inline_keyboard: TgInlineKeyboardButton[][];
}

export interface TgChatFullInfo extends TgChat {
  description?: string;
  pinned_message?: TgMessage;
  invite_link?: string;
  permissions?: Record<string, boolean>;
}

// ─── Database rows ───────────────────────────────────────────────────────────

export interface UserRow {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  is_premium: boolean;
  is_bot: boolean;
  ai_memory_enabled: boolean;
  broadcast_opt_in: boolean;
  broadcast_opt_in_at: string | null;
  notes: string | null;
  first_seen_at: string;
  last_seen_at: string;
  message_count: number;
  ai_request_count: number;
  created_at: string;
  updated_at: string;
}

export type AdminRole = "owner" | "super_admin" | "admin" | "moderator";

export interface AdminRow {
  user_id: number;
  role: AdminRole;
  permissions: string[];
  is_active: boolean;
  added_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface BanRow {
  id: string;
  user_id: number;
  banned_by: number;
  reason: string | null;
  is_active: boolean;
  expires_at: string | null;
  lifted_at: string | null;
  lifted_by: number | null;
  created_at: string;
}

export interface GroupRow {
  telegram_chat_id: number;
  title: string | null;
  username: string | null;
  type: "group" | "supergroup" | "channel";
  is_active: boolean;
  bot_is_admin: boolean;
  member_count: number | null;
  added_by: number | null;
  joined_at: string;
  left_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GroupSettingsRow {
  group_id: number;
  welcome_enabled: boolean;
  welcome_text: string;
  goodbye_enabled: boolean;
  goodbye_text: string;
  rules_text: string;
  antilink_enabled: boolean;
  antispam_enabled: boolean;
  block_forwards: boolean;
  delete_warn_messages: boolean;
  flood_limit: number;
  flood_window_seconds: number;
  warn_limit: number;
  warn_action: "mute" | "kick" | "ban";
  mute_duration_minutes: number;
  log_channel_id: number | null;
  language: "fa" | "en";
  created_at: string;
  updated_at: string;
}

export interface GroupBanRow {
  id: number;
  group_id: number;
  user_id: number;
  kind: "ban" | "mute";
  reason: string | null;
  is_active: boolean;
  expires_at: string | null;
  created_by: number;
  created_at: string;
  lifted_at: string | null;
  lifted_by: number | null;
}

export interface WarningRow {
  id: number;
  group_id: number;
  user_id: number;
  warned_by: number;
  reason: string | null;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
  revoked_by: number | null;
}

export type ModerationAction =
  | "ban"
  | "unban"
  | "kick"
  | "mute"
  | "unmute"
  | "warn"
  | "unwarn"
  | "delete_message"
  | "purge"
  | "settings_update"
  | "report"
  | "auto_action";

export interface ModerationLogRow {
  id: number;
  group_id: number;
  target_user_id: number | null;
  actor_id: number;
  action: ModerationAction;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type MediaType = "none" | "photo" | "video" | "animation" | "document";
export type RepeatInterval = "none" | "daily" | "weekly" | "monthly";

export interface AdRow {
  id: string;
  title: string;
  body: string;
  media_type: MediaType;
  media_file_id: string | null;
  buttons: { text: string; url: string }[];
  target_chat: string | null;
  status: "draft" | "active" | "paused" | "archived";
  scheduled_at: string | null;
  repeat_interval: RepeatInterval;
  label_enabled: boolean;
  sent_count: number;
  error_count: number;
  last_sent_at: string | null;
  last_error: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduledPostRow {
  id: string;
  title: string | null;
  body: string;
  media_type: MediaType;
  media_file_id: string | null;
  buttons: { text: string; url: string }[];
  target_chat: string | null;
  scheduled_at: string;
  status: "pending" | "sent" | "failed" | "cancelled";
  repeat_interval: RepeatInterval;
  attempts: number;
  last_error: string | null;
  sent_message_id: number | null;
  sent_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface ContentPostRow {
  id: string;
  category_id: number | null;
  type: "news" | "post" | "guide";
  title: string;
  body: string;
  media_type: MediaType;
  media_file_id: string | null;
  buttons: { text: string; url: string }[];
  status: "draft" | "scheduled" | "published" | "archived";
  scheduled_at: string | null;
  target_chat: string | null;
  telegram_message_id: number | null;
  views: number;
  is_pinned: boolean;
  publish_attempts: number;
  last_error: string | null;
  published_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface CategoryRow {
  id: number;
  slug: string;
  title: string;
  created_at: string;
}

export interface CampaignRow {
  id: string;
  title: string;
  message_type: "text" | MediaType;
  text: string;
  media_file_id: string | null;
  buttons: { text: string; url: string }[];
  audience: "opt_in" | "active" | "all";
  status:
    | "draft"
    | "queued"
    | "running"
    | "paused"
    | "completed"
    | "cancelled"
    | "failed";
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  last_error: string | null;
  created_by: number | null;
  approved_by: number | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignLogRow {
  id: number;
  campaign_id: string;
  user_id: number;
  status: "pending" | "sending" | "sent" | "failed" | "skipped";
  error: string | null;
  attempts: number;
  locked_at: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface AiConversationRow {
  id: number;
  user_id: number;
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  source: "gemini" | "fallback" | "cache" | "system";
  tokens: number | null;
  created_at: string;
}

export interface AiUsageRow {
  id: number;
  user_id: number | null;
  provider: string;
  model: string | null;
  request_type: "chat" | "anime" | "health" | "other";
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  status: "success" | "fallback" | "error" | "quota" | "rate_limited";
  error_code: string | null;
  created_at: string;
}

export interface AiStateRow {
  id: number;
  provider: string;
  status: "ok" | "degraded" | "quota_exhausted" | "disabled";
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  last_http_status: number | null;
  next_retry_at: string | null;
  updated_at: string;
}

export interface SessionRow {
  id: number;
  telegram_id: number;
  chat_id: number;
  state: string;
  payload: Record<string, unknown>;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface SystemLogRow {
  id: number;
  level: "debug" | "info" | "warn" | "error";
  scope: string;
  message: string;
  context: Record<string, unknown>;
  telegram_user_id: number | null;
  created_at: string;
}

export interface AdminActionRow {
  id: number;
  actor_id: number;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface StatsRow {
  day: string;
  new_users: number;
  active_users: number;
  messages: number;
  ai_requests: number;
  ai_fallbacks: number;
  ads_sent: number;
  posts_sent: number;
  errors: number;
  blocked_users: number;
  created_at: string;
  updated_at: string;
}
