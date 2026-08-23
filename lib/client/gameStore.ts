import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { applyCommand } from "../game/actions.ts";
import { compactGameState } from "../game/compaction.ts";
import { advanceGame } from "../game/simulation.ts";
import { DEFAULT_RULES } from "../game/state.ts";
import { NARRATIVE_CHAPTERS } from "../game/narrative.ts";
import type { GameCommand, GameState } from "../game/types.ts";

export type SaveStatus = "saved" | "unsaved" | "saving" | "error";
export type OperationStatus = "idle" | "importing" | "exporting" | "resetting";

export function useGameStore(initial: GameState) {
  const game = useSignal(initial);
  const now = useSignal(initial.lastSimulatedAt);
  const saveStatus = useSignal<SaveStatus>("saved");
  const lastSuccessfulSaveAt = useSignal<number | undefined>(initial.savedAt);
  const consecutiveSaveFailures = useSignal(0);
  const operationStatus = useSignal<OperationStatus>("idle");
  const notice = useSignal<string | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const saving = useRef(false);
  const queued = useRef(false);
  const mounted = useRef(true);
  const saveGeneration = useRef(0);
  const saveFailureNotice = useRef<string | undefined>(undefined);

  const recordSaveSuccess = (savedAt: number) => {
    lastSuccessfulSaveAt.value = savedAt;
    consecutiveSaveFailures.value = 0;
    if (
      saveFailureNotice.current !== undefined &&
      notice.value === saveFailureNotice.current
    ) {
      notice.value = undefined;
    }
    saveFailureNotice.current = undefined;
  };

  const saveNow = async () => {
    if (saving.current) {
      queued.current = true;
      return;
    }
    if (saveStatus.value === "saved") return;

    saving.current = true;
    saveStatus.value = "saving";
    const snapshot = compactGameState(game.value, DEFAULT_RULES);
    game.value = snapshot;
    const generation = saveGeneration.current;
    try {
      const response = await fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "save", state: snapshot }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Save failed");
      if (!mounted.current || generation !== saveGeneration.current) return;
      game.value = queued.current
        ? {
          ...compactGameState(game.value, DEFAULT_RULES),
          revision: body.game.revision,
          savedAt: body.game.savedAt,
        }
        : body.game;
      recordSaveSuccess(body.game.savedAt);
      saveStatus.value = queued.current ? "unsaved" : "saved";
    } catch (error) {
      if (!mounted.current || generation !== saveGeneration.current) return;
      saveStatus.value = "error";
      consecutiveSaveFailures.value++;
      saveFailureNotice.current = error instanceof Error
        ? error.message
        : "Save failed";
      notice.value = saveFailureNotice.current;
    } finally {
      saving.current = false;
      if (queued.current && mounted.current) {
        queued.current = false;
        saveStatus.value = "unsaved";
        queueSave();
      }
    }
  };

  const queueSave = () => {
    saveStatus.value = "unsaved";
    if (saveTimer.current !== undefined) clearTimeout(saveTimer.current);
    if (saving.current) {
      queued.current = true;
      return;
    }
    saveTimer.current = globalThis.setTimeout(() => void saveNow(), 500);
  };

  const catchUp = (
    timestamp = Date.now(),
    maxGameMinutes?: number,
  ) => {
    now.value = timestamp;
    if (game.value.clock.status !== "active") return;
    const timeScale = game.value.preferences.timeScale;
    const totalElapsedGameMinutes = Math.floor(
      (timestamp - game.value.lastSimulatedAt) /
        DEFAULT_RULES.realMillisecondsPerGameMinute * timeScale,
    );
    const elapsedGameMinutes = maxGameMinutes === undefined
      ? totalElapsedGameMinutes
      : Math.min(totalElapsedGameMinutes, maxGameMinutes);
    const processableMinutes = elapsedGameMinutes -
      (elapsedGameMinutes % DEFAULT_RULES.simulationStepMinutes);
    if (processableMinutes < DEFAULT_RULES.simulationStepMinutes) return;

    const previousChapter = game.value.narrative.chapter;
    const result = advanceGame(game.value, processableMinutes);
    game.value = {
      ...result.state,
      lastSimulatedAt: totalElapsedGameMinutes > elapsedGameMinutes
        ? timestamp
        : game.value.lastSimulatedAt +
          processableMinutes * DEFAULT_RULES.realMillisecondsPerGameMinute /
            timeScale,
    };
    if (game.value.narrative.chapter > previousChapter) {
      notice.value = `Chapter complete — next: ${
        NARRATIVE_CHAPTERS[game.value.narrative.chapter].title
      }`;
    }
    queueSave();
  };

  const dispatch = (command: GameCommand): boolean => {
    catchUp();
    const previousChapter = game.value.narrative.chapter;
    const result = applyCommand(game.value, command);
    if (!result.accepted) {
      notice.value = result.reason;
      return false;
    }
    if (command.type === "set_time_scale") {
      const timestamp = Date.now();
      game.value = { ...result.state, lastSimulatedAt: timestamp };
      now.value = timestamp;
    } else {
      game.value = result.state;
    }
    notice.value = result.state.narrative.chapter > previousChapter
      ? `Chapter complete — next: ${
        NARRATIVE_CHAPTERS[result.state.narrative.chapter].title
      }`
      : result.events.at(-1)?.summary;
    queueSave();
    return true;
  };

  const reset = async () => {
    operationStatus.value = "resetting";
    try {
      const response = await fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "reset" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Reset failed");
      saveGeneration.current++;
      game.value = body.game;
      now.value = body.game.lastSimulatedAt;
      recordSaveSuccess(body.game.savedAt);
      saveStatus.value = "unsaved";
      queueSave();
    } finally {
      operationStatus.value = "idle";
    }
  };

  const importSave = async (data: unknown) => {
    operationStatus.value = "importing";
    try {
      const response = await fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "import", data }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Import failed");
      saveGeneration.current++;
      queued.current = false;
      if (saveTimer.current !== undefined) clearTimeout(saveTimer.current);
      game.value = body.game;
      now.value = body.game.lastSimulatedAt;
      recordSaveSuccess(body.game.savedAt);
      saveStatus.value = "saved";
    } finally {
      operationStatus.value = "idle";
    }
  };

  const exportSave = async () => {
    operationStatus.value = "exporting";
    try {
      await saveNow();
      const response = await fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "export" }),
      });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `crm-company-${game.value.seed}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      operationStatus.value = "idle";
    }
  };

  useEffect(() => {
    mounted.current = true;
    const interval = globalThis.setInterval(() => {
      if (document.visibilityState === "visible") catchUp();
    }, 1_000);
    const flush = () => {
      if (saveStatus.value === "unsaved" || saveStatus.value === "error") {
        void saveNow();
      }
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") flush();
      else catchUp(Date.now(), DEFAULT_RULES.maxInactiveGameMinutes);
    };
    document.addEventListener("visibilitychange", visibility);
    globalThis.addEventListener("pagehide", flush);
    return () => {
      mounted.current = false;
      clearInterval(interval);
      if (saveTimer.current !== undefined) clearTimeout(saveTimer.current);
      document.removeEventListener("visibilitychange", visibility);
      globalThis.removeEventListener("pagehide", flush);
    };
  }, []);

  return {
    game,
    now,
    saveStatus,
    lastSuccessfulSaveAt,
    consecutiveSaveFailures,
    operationStatus,
    notice,
    dispatch,
    reset,
    importSave,
    exportSave,
    saveNow,
  };
}
