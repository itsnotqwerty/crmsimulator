import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { applyCommand } from "../game/actions.ts";
import { advanceGame } from "../game/simulation.ts";
import { DEFAULT_RULES } from "../game/state.ts";
import type { GameCommand, GameState } from "../game/types.ts";

export type SaveStatus = "saved" | "unsaved" | "saving" | "error";
export type OperationStatus = "idle" | "importing" | "exporting" | "resetting";

export function useGameStore(initial: GameState) {
  const game = useSignal(initial);
  const now = useSignal(initial.lastSimulatedAt);
  const saveStatus = useSignal<SaveStatus>("saved");
  const operationStatus = useSignal<OperationStatus>("idle");
  const notice = useSignal<string | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const saving = useRef(false);
  const queued = useRef(false);
  const mounted = useRef(true);

  const saveNow = async () => {
    if (saving.current) {
      queued.current = true;
      return;
    }
    if (saveStatus.value === "saved") return;

    saving.current = true;
    saveStatus.value = "saving";
    const snapshot = game.value;
    try {
      const response = await fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "save", state: snapshot }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Save failed");
      if (!mounted.current) return;
      game.value = {
        ...game.value,
        revision: body.game.revision,
        savedAt: body.game.savedAt,
      };
      saveStatus.value = queued.current ? "unsaved" : "saved";
    } catch (error) {
      if (!mounted.current) return;
      saveStatus.value = "error";
      notice.value = error instanceof Error ? error.message : "Save failed";
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
    saveTimer.current = globalThis.setTimeout(() => void saveNow(), 500);
  };

  const catchUp = (timestamp = Date.now()) => {
    now.value = timestamp;
    if (game.value.clock.status !== "active") return;
    const timeScale = game.value.preferences.timeScale;
    const elapsedGameMinutes = Math.floor(
      (timestamp - game.value.lastSimulatedAt) /
        DEFAULT_RULES.realMillisecondsPerGameMinute * timeScale,
    );
    const processableMinutes = elapsedGameMinutes -
      (elapsedGameMinutes % DEFAULT_RULES.simulationStepMinutes);
    if (processableMinutes < DEFAULT_RULES.simulationStepMinutes) return;

    const result = advanceGame(game.value, processableMinutes);
    game.value = {
      ...result.state,
      lastSimulatedAt: game.value.lastSimulatedAt +
        processableMinutes * DEFAULT_RULES.realMillisecondsPerGameMinute /
          timeScale,
    };
    queueSave();
  };

  const dispatch = (command: GameCommand): boolean => {
    catchUp();
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
    notice.value = result.events.at(-1)?.summary;
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
      game.value = body.game;
      now.value = body.game.lastSimulatedAt;
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
      game.value = body.game;
      now.value = body.game.lastSimulatedAt;
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
    const interval = globalThis.setInterval(() => catchUp(), 1_000);
    const flush = () => {
      if (saveStatus.value === "unsaved" || saveStatus.value === "error") {
        void saveNow();
      }
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") flush();
      else catchUp();
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
    operationStatus,
    notice,
    dispatch,
    reset,
    importSave,
    exportSave,
    saveNow,
  };
}
