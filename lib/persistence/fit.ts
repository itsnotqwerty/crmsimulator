import { compactGameState } from "../game/compaction.ts";
import type { GameRules, GameState } from "../game/types.ts";
import { encodeGameState } from "./codec.ts";

export async function fitGameStateToEncodedBudget(
  state: GameState,
  rules: GameRules,
  maxEncodedLength: number,
): Promise<GameState> {
  let fitted = compactGameState(state, rules);
  let encodedLength = (await encodeGameState(fitted)).length;
  if (encodedLength <= maxEncodedLength) return fitted;

  while (
    encodedLength > maxEncodedLength && fitted.recentActivities.length > 0
  ) {
    const removeCount = Math.min(10, fitted.recentActivities.length);
    fitted = {
      ...fitted,
      recentActivities: fitted.recentActivities.slice(removeCount),
      history: {
        ...fitted.history,
        activitiesArchived: fitted.history.activitiesArchived + removeCount,
      },
    };
    encodedLength = (await encodeGameState(fitted)).length;
  }

  if (encodedLength > maxEncodedLength) {
    throw new RangeError(
      `Save exceeds the ${maxEncodedLength}-character persistence budget after activity history was archived`,
    );
  }

  return fitted;
}
