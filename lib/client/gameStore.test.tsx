import { assertEquals } from "$std/assert/mod.ts";
import { render } from "https://esm.sh/preact-render-to-string@6.5.13?deps=preact@10.22.0";
import { createInitialState } from "../game/state.ts";
import type { GameState } from "../game/types.ts";
import { useGameStore } from "./gameStore.ts";

type Store = ReturnType<typeof useGameStore>;

function renderStore(initial: GameState): Store {
  let store: Store | undefined;
  function Harness() {
    store = useGameStore(initial);
    return null;
  }
  render(<Harness />);
  return store!;
}

function gameResponse(game: GameState): Response {
  return Response.json({ game });
}

Deno.test("save recovery tracks failures without clearing a newer notice", async () => {
  const originalFetch = globalThis.fetch;
  const initial = createInitialState({ seed: 1, now: 100 });
  const saved = {
    ...initial,
    revision: 1,
    savedAt: 200,
    company: { ...initial.company, name: "Server-compacted company" },
  };
  const responses = [
    new Response(JSON.stringify({ error: "Offline" }), { status: 503 }),
    gameResponse(saved),
  ];
  globalThis.fetch = () => Promise.resolve(responses.shift()!);

  try {
    const store = renderStore(initial);
    store.saveStatus.value = "unsaved";
    await store.saveNow();

    assertEquals(store.consecutiveSaveFailures.value, 1);
    assertEquals(store.notice.value, "Offline");

    store.notice.value = "A newer notice";
    await store.saveNow();

    assertEquals(store.game.value, saved);
    assertEquals(store.lastSuccessfulSaveAt.value, 200);
    assertEquals(store.consecutiveSaveFailures.value, 0);
    assertEquals(store.notice.value, "A newer notice");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("a save queued in flight preserves changes and advances revision", async () => {
  const originalFetch = globalThis.fetch;
  const initial = createInitialState({ seed: 2, now: Date.now() });
  const firstSaved = { ...initial, revision: 1, savedAt: initial.savedAt + 1 };
  const secondSaved = {
    ...firstSaved,
    revision: 2,
    savedAt: initial.savedAt + 2,
    preferences: { ...initial.preferences, palette: "sapphire" as const },
  };
  let resolveFirst: ((response: Response) => void) | undefined;
  const firstResponse = new Promise<Response>((resolve) => {
    resolveFirst = resolve;
  });
  const requests: GameState[] = [];
  let requestCount = 0;
  globalThis.fetch = (_input, init) => {
    requests.push(JSON.parse(String(init?.body)).state);
    requestCount++;
    return requestCount === 1
      ? firstResponse
      : Promise.resolve(gameResponse(secondSaved));
  };

  try {
    const store = renderStore(initial);
    store.saveStatus.value = "unsaved";
    const firstSave = store.saveNow();
    store.dispatch({ type: "set_palette", palette: "sapphire" });
    resolveFirst!(gameResponse(firstSaved));
    await firstSave;

    assertEquals(store.game.value.preferences.palette, "sapphire");
    assertEquals(store.game.value.revision, 1);
    assertEquals(store.saveStatus.value, "unsaved");

    await store.saveNow();
    assertEquals(requests[0].revision, 0);
    assertEquals(requests[1].revision, 1);
    assertEquals(requests[1].preferences.palette, "sapphire");
    assertEquals(store.game.value, secondSaved);
    assertEquals(store.saveStatus.value, "saved");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("informational tutorial steps discard elapsed simulation time", () => {
  const initial = createInitialState({ seed: 3, now: 100 });
  const store = renderStore(initial);

  store.catchUp(60_100);
  assertEquals(store.game.value.clock.gameMinute, 0);
  assertEquals(store.game.value.lastSimulatedAt, 60_100);

  assertEquals(
    store.dispatch({
      type: "acknowledge_onboarding",
      step: "inspect_lead",
    }),
    true,
  );
  assertEquals(
    store.dispatch({
      type: "acknowledge_onboarding",
      step: "explain_capacity",
    }),
    true,
  );
  const resumedAt = store.game.value.lastSimulatedAt;
  store.catchUp(resumedAt + 10_000);

  assertEquals(store.game.value.clock.gameMinute, 20);
});
