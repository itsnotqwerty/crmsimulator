import { assert, assertEquals, assertStringIncludes } from "$std/assert/mod.ts";
import { createInitialState } from "../game/state.ts";
import type { GameState } from "../game/types.ts";
import { createSetCookieHeaders } from "../persistence/cookies.ts";
import type {
  GameSaveStore,
  SaveCredential,
  SaveUpdateResult,
} from "../persistence/save_store.ts";
import { SAVE_SESSION_COOKIE } from "../persistence/save_session.ts";
import { handleRootPost, loadRoot, type RootConfig } from "./root.ts";

const URL = "https://crm.example/";
const SECRET = "database-root-test-secret";

class MemorySaveStore implements GameSaveStore {
  readonly states = new Map<string, GameState>();
  private sequence = 0;

  create(state: GameState): Promise<SaveCredential> {
    this.sequence += 1;
    const credential = {
      id: `00000000-0000-4000-8000-${String(this.sequence).padStart(12, "0")}`,
      token: "a".repeat(43),
    };
    this.states.set(credential.id, structuredClone(state));
    return Promise.resolve(credential);
  }

  load(credential: SaveCredential): Promise<GameState | undefined> {
    const state = this.states.get(credential.id);
    return Promise.resolve(state ? structuredClone(state) : undefined);
  }

  update(
    credential: SaveCredential,
    state: GameState,
    expectedRevision: number,
  ): Promise<SaveUpdateResult> {
    const stored = this.states.get(credential.id);
    if (!stored) return Promise.resolve("missing");
    if (stored.revision !== expectedRevision) return Promise.resolve("conflict");
    this.states.set(credential.id, structuredClone(state));
    return Promise.resolve("saved");
  }

  delete(credential: SaveCredential): Promise<void> {
    this.states.delete(credential.id);
    return Promise.resolve();
  }
}

function config(store: GameSaveStore, now = 1_000): RootConfig {
  return { secret: SECRET, now, seed: 91, secure: true, saveStore: store };
}

function cookieHeader(headers: readonly string[]): string {
  return headers.map((header) => header.split(";", 1)[0]).join("; ");
}

function post(body: unknown, cookies: readonly string[]): Request {
  return new Request(URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader(cookies),
      origin: "https://crm.example",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

Deno.test("database root creates an anonymous save with one capability cookie", async () => {
  const store = new MemorySaveStore();
  const loaded = await loadRoot(new Request(URL), config(store));

  assertEquals(loaded.data.loadStatus, "new");
  assertEquals(store.states.size, 1);
  assertEquals(loaded.setCookies.length, 14);
  assert(loaded.setCookies[0].startsWith(`${SAVE_SESSION_COOKIE}=`));
  assertStringIncludes(loaded.setCookies[0], "HttpOnly");
  assertStringIncludes(loaded.setCookies[0], "Secure");
  assert(loaded.setCookies.slice(1).every((cookie) => cookie.includes("Max-Age=0")));
});

Deno.test("database root migrates a legacy cookie save", async () => {
  const store = new MemorySaveStore();
  const initial = createInitialState({ seed: 92, now: 1_000 });
  const legacy = await createSetCookieHeaders(initial, SECRET, { secure: true });
  const request = new Request(URL, { headers: { cookie: cookieHeader(legacy) } });
  const loaded = await loadRoot(request, config(store));

  assertEquals(loaded.data.game, initial);
  assertEquals(store.states.size, 1);
  assert(loaded.setCookies.some((cookie) => cookie.startsWith(`${SAVE_SESSION_COOKIE}=`)));
  assert(loaded.setCookies.some((cookie) => cookie.startsWith("crm_save_meta=")));
});

Deno.test("database root preserves activity history beyond the cookie budget", async () => {
  const store = new MemorySaveStore();
  const loaded = await loadRoot(new Request(URL), config(store));
  const session = loaded.setCookies[0];
  const activities = Array.from({ length: 100 }, (_, index) => ({
    id: `activity_${index + 1}`,
    kind: "automation_ran" as const,
    summary: Array.from({ length: 200 }, (_, offset) =>
      String.fromCharCode(33 + ((index * 67 + offset * 41 + offset * offset) % 90))
    ).join(""),
    gameMinute: index,
  }));
  const state = {
    ...loaded.data.game,
    sequences: { ...loaded.data.game.sequences, activity: 100 },
    recentActivities: activities,
  };

  const response = await handleRootPost(
    post({ type: "save", state }, [session]),
    config(store, 2_000),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.game.recentActivities.length, 100);
  assertEquals([...store.states.values()][0].recentActivities.length, 100);
  assertEquals(response.headers.getSetCookie().length, 0);
});