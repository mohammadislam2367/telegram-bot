/**
 * 🎮 بازی و سرگرمی — کوییز انیمه (با دکمه)، تاس، شیر یا خط، سنگ‌کاغذ‌قیچی،
 * انتخاب از چند گزینه و جواب شانسی. در چت خصوصی و گروه کار می‌کند و وضعیت
 * کوییز در bot_sessions نگه داشته می‌شود (بدون جدول جدید).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../_shared/config.ts";
import type { TelegramApi } from "../_shared/telegram.ts";
import type { Logger } from "../_shared/logger.ts";
import { getSession, startSession } from "../_shared/sessions.ts";
import type { TgCallbackQuery, TgInlineKeyboardMarkup, TgMessage } from "../_shared/types.ts";
import { type Button, keyboard } from "../_shared/keyboards.ts";
import { divider, faNum, sectionTitle } from "../_shared/texts.ts";
import { type Quiz, QUIZ_BANK } from "./quiz_data.ts";

export interface GamesDeps {
  cfg: AppConfig;
  sb: SupabaseClient;
  tg: TelegramApi;
  log: Logger;
}

interface QuizStats {
  score: number;
  streak: number;
  best: number;
}

const QUIZ_TTL_MINUTES = 30;

const RPS_LABELS = { rock: "سنگ", paper: "کاغذ", scissors: "قیچی" } as const;
export type RpsMove = keyof typeof RPS_LABELS;

export const EIGHT_BALL: readonly string[] = [
  "قطعاً بله 🎯",
  "به احتمال زیاد 👍",
  "فعلاً نه 👎",
  "به‌نظرم صبر کن ⏳",
  "نتیجه‌اش به خودت بستگی دارد ✨",
  "نشانه‌ها مثبت است 🌟",
];

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffledOrder(length: number): number[] {
  const order = Array.from({ length }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function parseMove(input: string): RpsMove | null {
  const value = input.trim().toLowerCase();
  if (value === "سنگ" || value === "rock") return "rock";
  if (value === "کاغذ" || value === "paper") return "paper";
  if (value === "قیچی" || value === "scissors") return "scissors";
  return null;
}

export function rpsOutcome(player: RpsMove, bot: RpsMove): "win" | "lose" | "draw" {
  if (player === bot) return "draw";
  const beats: Record<RpsMove, RpsMove> = { rock: "scissors", paper: "rock", scissors: "paper" };
  return beats[player] === bot ? "win" : "lose";
}

export function parseChoices(input: string): string[] {
  return input
    .split(/[,،|\n]|\s+یا\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 12);
}

async function reply(
  deps: GamesDeps,
  chatId: number,
  text: string,
  markup?: TgInlineKeyboardMarkup,
): Promise<void> {
  try {
    await deps.tg.sendMessage(chatId, text, { markup, preview: false });
  } catch (error) {
    await deps.log.warn("games reply failed", { chatId, error: (error as Error).message });
  }
}

async function askNext(
  deps: GamesDeps,
  chatId: number,
  userId: number,
  stats: QuizStats,
): Promise<void> {
  const qi = Math.floor(Math.random() * QUIZ_BANK.length);
  const quiz = QUIZ_BANK[qi];
  await startSession(deps.sb, userId, chatId, "quiz", { qi, ...stats }, QUIZ_TTL_MINUTES);

  const order = shuffledOrder(quiz.options.length);
  const rows: Button[][] = [];
  for (let i = 0; i < order.length; i += 2) {
    rows.push(
      order.slice(i, i + 2).map((optionIndex) => ({
        text: `${optionIndex + 1}️⃣ ${quiz.options[optionIndex]}`,
        callback_data: `gq:${qi}:${optionIndex}`,
      })),
    );
  }

  await reply(
    deps,
    chatId,
    [
      sectionTitle("🎯 کوییز انیمه"),
      quiz.q,
      divider(),
      `امتیاز: <b>${faNum(stats.score)}</b> • زنجیره: ${faNum(stats.streak)} • رکورد: ${
        faNum(stats.best)
      }`,
      "<i>یکی از گزینه‌ها را بزن.</i>",
    ].join("\n"),
    keyboard(rows),
  );
}

async function answer(deps: GamesDeps, cq: TgCallbackQuery, text: string, alert = false) {
  try {
    await deps.tg.answerCallback(cq.id, text, alert);
  } catch {
    // پاسخ به دکمه اختیاری است
  }
}

/** دستورهای بازی؛ true یعنی همان‌جا جواب داده شد. */
export async function handleGamesMessage(deps: GamesDeps, message: TgMessage): Promise<boolean> {
  const text = (message.text ?? "").trim();
  if (!text.startsWith("/")) return false;

  const [head, ...restParts] = text.split(/\s+/);
  const command = head.slice(1).split("@")[0].toLowerCase();
  const args = restParts.join(" ").trim();
  const chatId = message.chat.id;
  const userId = message.from?.id;

  if (command === "games") {
    await reply(
      deps,
      chatId,
      [
        sectionTitle("🎮 بازی و سرگرمی"),
        divider(),
        "• /quiz — کوییز انیمه با گزینه‌ها",
        "• /dice — تاس",
        "• /coin — شیر یا خط",
        "• /rps سنگ | کاغذ | قیچی",
        "• /choose گزینه۱، گزینه۲، …",
        "• /8ball سؤالت",
      ].join("\n"),
    );
    return true;
  }

  if (command === "quiz") {
    if (!userId) return true;
    const session = await getSession(deps.sb, userId, chatId);
    const stats = session?.state === "quiz"
      ? (session.payload as unknown as QuizStats)
      : { score: 0, streak: 0, best: 0 };
    await askNext(deps, chatId, userId, {
      score: stats.score ?? 0,
      streak: stats.streak ?? 0,
      best: stats.best ?? 0,
    });
    return true;
  }

  if (command === "dice") {
    try {
      await deps.tg.call<TgMessage>("sendDice", { chat_id: chatId, emoji: "🎲" });
    } catch {
      await reply(deps, chatId, `🎲 ${faNum(1 + Math.floor(Math.random() * 6))}`);
    }
    return true;
  }

  if (command === "coin") {
    await reply(deps, chatId, `🪙 ${pick(["شیر", "خط"])}`);
    return true;
  }

  if (command === "rps") {
    const move = parseMove(args);
    if (!move) {
      await reply(deps, chatId, "بنویس: <code>/rps سنگ</code> یا «کاغذ» یا «قیچی».");
      return true;
    }
    const botMove = pick(Object.keys(RPS_LABELS) as RpsMove[]);
    const result = rpsOutcome(move, botMove);
    const label = result === "win" ? "🏆 بردی!" : result === "lose" ? "😅 باختی" : "🤝 مساوی";
    await reply(deps, chatId, `${label}\nتو: ${RPS_LABELS[move]} • من: ${RPS_LABELS[botMove]}`);
    return true;
  }

  if (command === "choose") {
    const choices = parseChoices(args);
    if (choices.length < 2) {
      await reply(deps, chatId, "مثال: <code>/choose پیتزا، سوشی، کباب</code>");
      return true;
    }
    await reply(deps, chatId, `🎲 انتخاب من: <b>${pick(choices)}</b>`);
    return true;
  }

  if (command === "8ball") {
    if (args.length === 0) {
      await reply(deps, chatId, "سؤالت را بنویس: <code>/8ball فردا باران می‌آید؟</code>");
      return true;
    }
    await reply(deps, chatId, `🔮 ${pick(EIGHT_BALL)}`);
    return true;
  }

  return false;
}

/** دکمه‌های کوییز؛ true یعنی callback مال همین ماژول بود. */
export async function handleQuizCallback(deps: GamesDeps, cq: TgCallbackQuery): Promise<boolean> {
  const data = cq.data ?? "";
  if (!data.startsWith("gq:")) return false;

  const chatId = cq.message?.chat.id;
  const userId = cq.from.id;
  if (!chatId) {
    await answer(deps, cq, "این دکمه قدیمی شده است.", true);
    return true;
  }

  const parts = data.split(":");
  const session = await getSession(deps.sb, userId, chatId);
  const stats = session && session.state === "quiz"
    ? (session.payload as unknown as QuizStats)
    : null;

  if (parts[1] === "n") {
    if (!stats) {
      await answer(deps, cq, "برای شروع /quiz را بزن.", true);
      return true;
    }
    await askNext(deps, chatId, userId, {
      score: stats.score ?? 0,
      streak: stats.streak ?? 0,
      best: stats.best ?? 0,
    });
    await answer(deps, cq, "");
    return true;
  }

  const qi = Number(parts[1]);
  const optionIndex = Number(parts[2]);
  const quiz: Quiz | undefined = QUIZ_BANK[qi];
  const sessionQi = (session?.payload as { qi?: number } | undefined)?.qi;

  if (!stats || !quiz || sessionQi !== qi) {
    await answer(deps, cq, "این کوییز منقضی شده؛ /quiz بزن.", true);
    return true;
  }

  const correct = optionIndex === quiz.answer;
  const score = (stats.score ?? 0) + (correct ? 1 : 0);
  const streak = correct ? (stats.streak ?? 0) + 1 : 0;
  const best = Math.max(stats.best ?? 0, streak);

  await startSession(
    deps.sb,
    userId,
    chatId,
    "quiz",
    { qi: -1, score, streak, best },
    QUIZ_TTL_MINUTES,
  );

  const body = [
    correct ? "✅ <b>درست بود!</b>" : "❌ <b>اشتباه بود.</b>",
    `پاسخ درست: <b>${quiz.options[quiz.answer]}</b>`,
    quiz.q,
    divider(),
    `امتیاز: <b>${faNum(score)}</b> • زنجیره: ${faNum(streak)} • رکورد: ${faNum(best)}`,
  ].join("\n");

  try {
    await deps.tg.editMessageText(chatId, cq.message!.message_id, body, {
      markup: keyboard([[{ text: "🎯 سؤال بعدی", callback_data: "gq:n" }]]),
    });
  } catch (error) {
    await deps.log.warn("quiz edit failed", { error: (error as Error).message });
    await reply(deps, chatId, body);
  }

  await answer(deps, cq, correct ? "درست بود! 🎉" : "اشتباه بود — سؤال بعدی؟");
  return true;
}
