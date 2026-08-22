import { DEFAULT_RULES } from "./state.ts";
import type { GameRules } from "./types.ts";

export function dealCloseLossChance(
  intent: number,
  rules: Pick<
    GameRules,
    "safeCloseIntent" | "maximumCloseLossChancePercent"
  > = DEFAULT_RULES,
): number {
  const normalizedIntent = Math.max(0, Math.min(100, intent));
  if (normalizedIntent >= rules.safeCloseIntent) return 0;
  if (rules.safeCloseIntent <= 0) return 0;

  return Math.min(
    rules.maximumCloseLossChancePercent,
    Math.ceil(
      (rules.safeCloseIntent - normalizedIntent) /
        rules.safeCloseIntent * rules.maximumCloseLossChancePercent,
    ),
  );
}
