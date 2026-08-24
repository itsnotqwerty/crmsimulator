import { advanceOffline } from "../game/simulation.ts";
import { compactGameState } from "../game/compaction.ts";
import {
  createInitialState,
  DEFAULT_RULES,
  syncProgressionUnlocks,
} from "../game/state.ts";
import type { AdvanceSummary, GameState } from "../game/types.ts";
import {
  createClearCookieHeaders,
  createSetCookieHeaders,
  DEFAULT_COOKIE_OPTIONS,
  parseCookieHeader,
  readCookieBundle,
} from "../persistence/cookies.ts";
import { fitGameStateToEncodedBudget } from "../persistence/fit.ts";
import { migrateGameState } from "../persistence/migrations.ts";
import {
  createSupabaseGameSaveStore,
  type GameSaveStore,
  type SaveCredential,
} from "../persistence/save_store.ts";
import {
  clearSaveSessionCookie,
  createSaveSessionCookie,
  parseSaveCredential,
  SAVE_SESSION_COOKIE,
} from "../persistence/save_session.ts";
import { parseGameState } from "../persistence/schema.ts";

const MAX_REQUEST_BYTES = 256_000;
const DEV_COOKIE_SECRET = "crm-simulator-local-development-secret";
const COOKIE_PAYLOAD_BUDGET = DEFAULT_COOKIE_OPTIONS.chunkSize *
  DEFAULT_COOKIE_OPTIONS.maxChunks;

export type LoadStatus = "new" | "loaded" | "offline" | "crisis" | "corrupt";

export interface RootPageData {
  game: GameState;
  loadStatus: LoadStatus;
  offlineSummary?: AdvanceSummary;
  loadError?: string;
}

export interface RootConfig {
  secret: string;
  now: number;
  seed: number;
  secure: boolean;
  saveStore?: GameSaveStore;
}

export interface LoadedRoot {
  data: RootPageData;
  setCookies: string[];
}

type RootAction =
  | { type: "save"; state: unknown }
  | { type: "reset" }
  | { type: "begin" }
  | { type: "export" }
  | { type: "import"; data: unknown };

function requestProtocol(request: Request): string {
  return request.headers.get("x-forwarded-proto")
    ?.split(",", 1)[0].trim().toLowerCase() || new URL(request.url).protocol;
}

function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const protocol = requestProtocol(request);
  if (protocol === "http" || protocol === "https") {
    url.protocol = `${protocol}:`;
  }
  return url.origin;
}

export function getRootConfig(request: Request): RootConfig {
  const configuredSecret = Deno.env.get("COOKIE_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!configuredSecret && Deno.env.get("DENO_DEPLOYMENT_ID")) {
    throw new Error("COOKIE_SECRET is required in production");
  }
  if (Deno.env.get("DENO_DEPLOYMENT_ID") && (!supabaseUrl || !serviceRoleKey)) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production",
    );
  }

  return {
    secret: configuredSecret ?? DEV_COOKIE_SECRET,
    now: Date.now(),
    seed: crypto.getRandomValues(new Uint32Array(1))[0],
    secure: requestProtocol(request) === "https" ||
      new URL(request.url).protocol === "https:",
    saveStore: supabaseUrl && serviceRoleKey
      ? createSupabaseGameSaveStore(supabaseUrl, serviceRoleKey)
      : undefined,
  };
}

function cookieChunkCount(cookies: Readonly<Record<string, string>>): number {
  return Object.keys(cookies).filter((name) => /^crm_save_\d+$/.test(name))
    .length;
}

function appendSetCookies(
  response: Response,
  cookies: readonly string[],
): Response {
  for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown save error";
}

async function signedHeaders(
  state: GameState,
  config: RootConfig,
  previousChunkCount: number,
): Promise<string[]> {
  return await createSetCookieHeaders(state, config.secret, {
    secure: config.secure,
    previousChunkCount,
  });
}

function fitForCookies(state: GameState): Promise<GameState> {
  return fitGameStateToEncodedBudget(
    state,
    DEFAULT_RULES,
    COOKIE_PAYLOAD_BUDGET,
  );
}

function prepareForStorage(
  state: GameState,
  config: RootConfig,
): Promise<GameState> {
  const compacted = compactGameState(state, DEFAULT_RULES);
  return config.saveStore
    ? Promise.resolve(compacted)
    : fitForCookies(compacted);
}

function credentialFromCookies(
  cookies: Readonly<Record<string, string>>,
): SaveCredential | undefined {
  return parseSaveCredential(cookies[SAVE_SESSION_COOKIE]);
}

function migratedSessionHeaders(
  credential: SaveCredential,
  config: RootConfig,
): string[] {
  return [
    createSaveSessionCookie(credential, config.secure),
    ...createClearCookieHeaders({ secure: config.secure }),
  ];
}

async function loadDatabaseRoot(
  cookies: Readonly<Record<string, string>>,
  config: RootConfig & { saveStore: GameSaveStore },
): Promise<LoadedRoot> {
  let credential = credentialFromCookies(cookies);
  let loaded: GameState;
  let setCookies: string[] = [];

  try {
    if (credential) {
      const stored = await config.saveStore.load(credential);
      if (!stored) {
        return {
          data: {
            game: createInitialState({ seed: config.seed, now: config.now }),
            loadStatus: "corrupt",
            loadError: "Anonymous save session is invalid or has expired",
          },
          setCookies: [clearSaveSessionCookie(config.secure)],
        };
      }
      loaded = stored;
    } else if (cookies.crm_save_meta) {
      loaded = await readCookieBundle(cookies, config.secret);
      credential = await config.saveStore.create(loaded);
      setCookies = migratedSessionHeaders(credential, config);
    } else {
      loaded = createInitialState({ seed: config.seed, now: config.now });
      credential = await config.saveStore.create(loaded);
      return {
        data: { game: loaded, loadStatus: "new" },
        setCookies: migratedSessionHeaders(credential, config),
      };
    }

    const compacted = compactGameState(loaded, DEFAULT_RULES);
    const result = advanceOffline(compacted, config.now);
    const unlocksChanged = result.state.unlocks.length !==
        loaded.unlocks.length ||
      result.state.unlocks.some((unlock) => !loaded.unlocks.includes(unlock));
    const changed = compacted !== loaded || unlocksChanged ||
      result.state.lastSimulatedAt !== loaded.lastSimulatedAt ||
      result.state.clock.gameMinute !== loaded.clock.gameMinute ||
      result.state.clock.status !== loaded.clock.status;
    const game = changed
      ? await prepareForStorage({
        ...result.state,
        revision: loaded.revision + 1,
        savedAt: config.now,
      }, config)
      : loaded;

    if (changed) {
      const update = await config.saveStore.update(
        credential,
        game,
        loaded.revision,
      );
      if (update !== "saved") {
        const latest = await config.saveStore.load(credential);
        if (!latest) throw new Error("Anonymous save no longer exists");
        return { data: { game: latest, loadStatus: "loaded" }, setCookies };
      }
    }

    const loadStatus: LoadStatus = result.summary.stoppedForCrisis
      ? "crisis"
      : result.summary.elapsedGameMinutes > 0
      ? "offline"
      : "loaded";
    return {
      data: {
        game,
        loadStatus,
        offlineSummary: result.summary.elapsedGameMinutes > 0 ||
            result.summary.stoppedForCrisis
          ? result.summary
          : undefined,
      },
      setCookies,
    };
  } catch (error) {
    return {
      data: {
        game: createInitialState({ seed: config.seed, now: config.now }),
        loadStatus: "corrupt",
        loadError: errorMessage(error),
      },
      setCookies,
    };
  }
}

export async function loadRoot(
  request: Request,
  config: RootConfig = getRootConfig(request),
): Promise<LoadedRoot> {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  if (config.saveStore) {
    return await loadDatabaseRoot(
      cookies,
      config as RootConfig & { saveStore: GameSaveStore },
    );
  }
  const previousChunkCount = cookieChunkCount(cookies);
  if (!cookies.crm_save_meta) {
    const game = createInitialState({ seed: config.seed, now: config.now });
    return {
      data: { game, loadStatus: "new" },
      setCookies: await signedHeaders(game, config, previousChunkCount),
    };
  }

  try {
    const loaded = await readCookieBundle(cookies, config.secret);
    const compacted = compactGameState(loaded, DEFAULT_RULES);
    const result = advanceOffline(compacted, config.now);
    const unlocksChanged = result.state.unlocks.length !==
        loaded.unlocks.length ||
      result.state.unlocks.some((unlock) => !loaded.unlocks.includes(unlock));
    const changed = compacted !== loaded || unlocksChanged ||
      result.state.lastSimulatedAt !== loaded.lastSimulatedAt ||
      result.state.clock.gameMinute !== loaded.clock.gameMinute ||
      result.state.clock.status !== loaded.clock.status;
    const game = changed
      ? await fitForCookies({
        ...result.state,
        revision: loaded.revision + 1,
        savedAt: config.now,
      })
      : loaded;
    const loadStatus: LoadStatus = result.summary.stoppedForCrisis
      ? "crisis"
      : result.summary.elapsedGameMinutes > 0
      ? "offline"
      : "loaded";

    return {
      data: {
        game,
        loadStatus,
        offlineSummary: result.summary.elapsedGameMinutes > 0 ||
            result.summary.stoppedForCrisis
          ? result.summary
          : undefined,
      },
      setCookies: changed
        ? await signedHeaders(game, config, previousChunkCount)
        : [],
    };
  } catch (error) {
    return {
      data: {
        game: createInitialState({ seed: config.seed, now: config.now }),
        loadStatus: "corrupt",
        loadError: errorMessage(error),
      },
      setCookies: [],
    };
  }
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin && origin !== requestOrigin(request)) return false;
  return request.headers.get("sec-fetch-site") !== "cross-site";
}

async function readAction(request: Request): Promise<RootAction> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_REQUEST_BYTES) {
    throw new RangeError("Request body is too large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    throw new RangeError("Request body is too large");
  }
  const value: unknown = contentType.startsWith("application/json")
    ? JSON.parse(text)
    : contentType.startsWith("application/x-www-form-urlencoded")
    ? Object.fromEntries(new URLSearchParams(text))
    : (() => {
      throw new TypeError(
        "Content-Type must be application/json or application/x-www-form-urlencoded",
      );
    })();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Action body must be an object");
  }
  const action = value as Record<string, unknown>;
  if (
    !["save", "reset", "begin", "export", "import"].includes(
      String(action.type),
    )
  ) {
    throw new TypeError("Unknown root action");
  }
  if (action.type === "save") return { type: "save", state: action.state };
  if (action.type === "import") return { type: "import", data: action.data };
  return { type: action.type as "reset" | "begin" | "export" };
}

async function currentGame(
  cookies: Readonly<Record<string, string>>,
  config: RootConfig,
): Promise<GameState | undefined> {
  if (!cookies.crm_save_meta) return undefined;
  return await readCookieBundle(cookies, config.secret);
}

async function databaseCurrent(
  cookies: Readonly<Record<string, string>>,
  config: RootConfig & { saveStore: GameSaveStore },
): Promise<{
  credential?: SaveCredential;
  game?: GameState;
  setCookies: string[];
}> {
  const credential = credentialFromCookies(cookies);
  if (credential) {
    return {
      credential,
      game: await config.saveStore.load(credential),
      setCookies: [],
    };
  }
  if (!cookies.crm_save_meta) return { setCookies: [] };

  const game = await readCookieBundle(cookies, config.secret);
  const migrated = await config.saveStore.create(game);
  return {
    credential: migrated,
    game,
    setCookies: migratedSessionHeaders(migrated, config),
  };
}

async function handleDatabasePost(
  action: RootAction,
  cookies: Readonly<Record<string, string>>,
  config: RootConfig & { saveStore: GameSaveStore },
): Promise<Response> {
  const current = await databaseCurrent(cookies, config);

  if (action.type === "reset") {
    if (current.credential && current.game) {
      await config.saveStore.delete(current.credential);
    }
    const game = createInitialState({ seed: config.seed, now: config.now });
    return appendSetCookies(jsonResponse({ game }), [
      clearSaveSessionCookie(config.secure),
      ...createClearCookieHeaders({ secure: config.secure }),
    ]);
  }

  if (action.type === "export") {
    if (!current.game) {
      return jsonResponse({ error: "No saved company exists" }, 404);
    }
    return appendSetCookies(
      new Response(JSON.stringify(current.game, null, 2), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition":
            `attachment; filename="crm-company-${current.game.seed}.json"`,
          "Content-Type": "application/json; charset=utf-8",
        },
      }),
      current.setCookies,
    );
  }

  if (action.type === "begin") {
    const initial = current.game ?? createInitialState({
      seed: config.seed,
      now: config.now,
    });
    const game = await prepareForStorage({
      ...initial,
      revision: initial.revision + 1,
      savedAt: config.now,
      narrative: { ...initial.narrative, pendingBriefing: false },
    }, config);
    let setCookies = current.setCookies;
    if (current.credential && current.game) {
      const update = await config.saveStore.update(
        current.credential,
        game,
        initial.revision,
      );
      if (update !== "saved") throw new Error("Save changed before game start");
    } else {
      const credential = await config.saveStore.create(game);
      setCookies = migratedSessionHeaders(credential, config);
    }
    return appendSetCookies(
      new Response(null, {
        status: 303,
        headers: { "Cache-Control": "no-store", "Location": "/" },
      }),
      setCookies,
    );
  }

  if (action.type === "import") {
    const imported = syncProgressionUnlocks(migrateGameState(action.data));
    const previousRevision = current.game?.revision ?? -1;
    const game = await prepareForStorage({
      ...imported,
      revision: previousRevision + 1,
      savedAt: config.now,
      lastSimulatedAt: config.now,
    }, config);
    let setCookies = current.setCookies;
    if (current.credential && current.game) {
      const update = await config.saveStore.update(
        current.credential,
        game,
        previousRevision,
      );
      if (update !== "saved") throw new Error("Save changed during import");
    } else {
      const credential = await config.saveStore.create(game);
      setCookies = migratedSessionHeaders(credential, config);
    }
    return appendSetCookies(jsonResponse({ game }), setCookies);
  }

  const submitted = await prepareForStorage(
    syncProgressionUnlocks(parseGameState(action.state)),
    config,
  );
  if (current.game && submitted.revision !== current.game.revision) {
    return jsonResponse({
      error: "This company was updated in another tab",
      revision: current.game.revision,
    }, 409);
  }
  if (!current.game && submitted.revision !== 0) {
    return jsonResponse(
      { error: "Save revision does not match the server" },
      409,
    );
  }

  const game = await prepareForStorage({
    ...submitted,
    revision: submitted.revision + 1,
    savedAt: config.now,
  }, config);
  let setCookies = current.setCookies;
  if (current.credential && current.game) {
    const update = await config.saveStore.update(
      current.credential,
      game,
      submitted.revision,
    );
    if (update === "conflict") {
      const latest = await config.saveStore.load(current.credential);
      return jsonResponse({
        error: "This company was updated in another tab",
        revision: latest?.revision,
      }, 409);
    }
    if (update === "missing") {
      return jsonResponse({ error: "Anonymous save session is invalid" }, 409);
    }
  } else {
    const credential = await config.saveStore.create(game);
    setCookies = migratedSessionHeaders(credential, config);
  }
  return appendSetCookies(jsonResponse({ game }), setCookies);
}

export async function handleRootPost(
  request: Request,
  config: RootConfig = getRootConfig(request),
): Promise<Response> {
  if (!sameOrigin(request)) {
    return jsonResponse({ error: "Cross-origin actions are not allowed" }, 403);
  }

  let action: RootAction;
  try {
    action = await readAction(request);
  } catch (error) {
    const status = error instanceof RangeError ? 413 : 400;
    return jsonResponse({ error: errorMessage(error) }, status);
  }

  const cookies = parseCookieHeader(request.headers.get("cookie"));
  if (config.saveStore) {
    try {
      return await handleDatabasePost(
        action,
        cookies,
        config as RootConfig & { saveStore: GameSaveStore },
      );
    } catch (error) {
      return jsonResponse({ error: errorMessage(error) }, 400);
    }
  }
  const previousChunkCount = cookieChunkCount(cookies);

  try {
    if (action.type === "reset") {
      const game = createInitialState({ seed: config.seed, now: config.now });
      return appendSetCookies(
        jsonResponse({ game }),
        createClearCookieHeaders({ secure: config.secure }),
      );
    }

    if (action.type === "begin") {
      const loaded = await currentGame(cookies, config);
      const initial = loaded ?? createInitialState({
        seed: config.seed,
        now: config.now,
      });
      const game = await fitForCookies({
        ...initial,
        revision: initial.revision + 1,
        savedAt: config.now,
        narrative: {
          ...initial.narrative,
          pendingBriefing: false,
        },
      });
      const response = new Response(null, {
        status: 303,
        headers: {
          "Cache-Control": "no-store",
          "Location": "/",
        },
      });
      return appendSetCookies(
        response,
        await signedHeaders(game, config, previousChunkCount),
      );
    }

    if (action.type === "export") {
      const game = await currentGame(cookies, config);
      if (!game) return jsonResponse({ error: "No saved company exists" }, 404);
      return new Response(JSON.stringify(game, null, 2), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition":
            `attachment; filename="crm-company-${game.seed}.json"`,
          "Content-Type": "application/json; charset=utf-8",
        },
      });
    }

    if (action.type === "import") {
      const imported = syncProgressionUnlocks(migrateGameState(action.data));
      let previousRevision = -1;
      try {
        previousRevision = (await currentGame(cookies, config))?.revision ?? -1;
      } catch {
        // A valid import may replace a corrupt save.
      }
      const game = await fitForCookies({
        ...imported,
        revision: previousRevision + 1,
        savedAt: config.now,
        lastSimulatedAt: config.now,
      });
      return appendSetCookies(
        jsonResponse({ game }),
        await signedHeaders(game, config, previousChunkCount),
      );
    }

    const submitted = await fitForCookies(
      syncProgressionUnlocks(parseGameState(action.state)),
    );
    let stored: GameState | undefined;
    try {
      stored = await currentGame(cookies, config);
    } catch (error) {
      return jsonResponse({
        error: "The stored save is corrupt; import or reset before saving",
        detail: errorMessage(error),
      }, 409);
    }
    if (stored && submitted.revision !== stored.revision) {
      return jsonResponse({
        error: "This company was updated in another tab",
        revision: stored.revision,
      }, 409);
    }
    if (!stored && submitted.revision !== 0) {
      return jsonResponse(
        { error: "Save revision does not match the server" },
        409,
      );
    }

    const game = await fitForCookies({
      ...submitted,
      revision: submitted.revision + 1,
      savedAt: config.now,
    });
    return appendSetCookies(
      jsonResponse({ game }),
      await signedHeaders(game, config, previousChunkCount),
    );
  } catch (error) {
    return jsonResponse({ error: errorMessage(error) }, 400);
  }
}
