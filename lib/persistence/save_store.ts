import postgres from "postgres";
import { decodeBase64Url, encodeBase64Url } from "$std/encoding/base64url.ts";
import type { GameState } from "../game/types.ts";
import { parseGameState } from "./schema.ts";

export interface SaveCredential {
  id: string;
  token: string;
}

export type SaveUpdateResult = "saved" | "conflict" | "missing";

export interface GameSaveStore {
  create(state: GameState): Promise<SaveCredential>;
  load(credential: SaveCredential): Promise<GameState | undefined>;
  update(
    credential: SaveCredential,
    state: GameState,
    expectedRevision: number,
  ): Promise<SaveUpdateResult>;
  delete(credential: SaveCredential): Promise<void>;
}

interface SaveRow {
  state: unknown;
}

function randomToken(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function tokenHash(token: string): Promise<string> {
  const bytes = decodeBase64Url(token);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export class PostgresGameSaveStore implements GameSaveStore {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async create(state: GameState): Promise<SaveCredential> {
    const credential = { id: crypto.randomUUID(), token: randomToken() };
    await this.sql`
      INSERT INTO crm_anonymous_saves (id, token_hash, state, revision)
      VALUES (${credential.id}, ${await tokenHash(credential.token)},
        ${
      this.sql.json(state as unknown as postgres.JSONValue)
    }, ${state.revision})
    `;
    return credential;
  }

  async load(credential: SaveCredential): Promise<GameState | undefined> {
    const [row] = await this.sql<SaveRow[]>`
      SELECT state FROM crm_anonymous_saves
      WHERE id = ${credential.id}
        AND token_hash = ${await tokenHash(credential.token)}
    `;
    return row ? parseGameState(row.state) : undefined;
  }

  async update(
    credential: SaveCredential,
    state: GameState,
    expectedRevision: number,
  ): Promise<SaveUpdateResult> {
    const hash = await tokenHash(credential.token);
    const updated = await this.sql`
      UPDATE crm_anonymous_saves
      SET state = ${
      this.sql.json(state as unknown as postgres.JSONValue)
    }, revision = ${state.revision},
        updated_at = ${new Date(state.savedAt).toISOString()}
      WHERE id = ${credential.id} AND token_hash = ${hash}
        AND revision = ${expectedRevision}
      RETURNING id
    `;
    if (updated.length) return "saved";
    const [existing] = await this.sql`
      SELECT id FROM crm_anonymous_saves
      WHERE id = ${credential.id} AND token_hash = ${hash}
    `;
    return existing ? "conflict" : "missing";
  }

  async delete(credential: SaveCredential): Promise<void> {
    await this.sql`
      DELETE FROM crm_anonymous_saves WHERE id = ${credential.id}
        AND token_hash = ${await tokenHash(credential.token)}
    `;
  }
}

const stores = new Map<string, GameSaveStore>();

export function createPostgresGameSaveStore(url: string): GameSaveStore {
  let store = stores.get(url);
  if (!store) {
    store = new PostgresGameSaveStore(postgres(url, { max: 5 }));
    stores.set(url, store);
  }
  return store;
}
