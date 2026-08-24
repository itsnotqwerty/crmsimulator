import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

export class SupabaseGameSaveStore implements GameSaveStore {
  constructor(private readonly client: SupabaseClient) {}

  async create(state: GameState): Promise<SaveCredential> {
    const credential = { id: crypto.randomUUID(), token: randomToken() };
    const { error } = await this.client.from("crm_anonymous_saves").insert({
      id: credential.id,
      token_hash: await tokenHash(credential.token),
      state,
      revision: state.revision,
    });
    if (error) throw new Error(`Could not create save: ${error.message}`);
    return credential;
  }

  async load(credential: SaveCredential): Promise<GameState | undefined> {
    const { data, error } = await this.client.from("crm_anonymous_saves")
      .select("state")
      .eq("id", credential.id)
      .eq("token_hash", await tokenHash(credential.token))
      .maybeSingle<SaveRow>();
    if (error) throw new Error(`Could not load save: ${error.message}`);
    return data ? parseGameState(data.state) : undefined;
  }

  async update(
    credential: SaveCredential,
    state: GameState,
    expectedRevision: number,
  ): Promise<SaveUpdateResult> {
    const hash = await tokenHash(credential.token);
    const { data, error } = await this.client.from("crm_anonymous_saves")
      .update({
        state,
        revision: state.revision,
        updated_at: new Date(state.savedAt).toISOString(),
      })
      .eq("id", credential.id)
      .eq("token_hash", hash)
      .eq("revision", expectedRevision)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`Could not update save: ${error.message}`);
    if (data) return "saved";

    const { data: existing, error: loadError } = await this.client.from(
      "crm_anonymous_saves",
    )
      .select("id")
      .eq("id", credential.id)
      .eq("token_hash", hash)
      .maybeSingle();
    if (loadError) {
      throw new Error(`Could not check save revision: ${loadError.message}`);
    }
    return existing ? "conflict" : "missing";
  }

  async delete(credential: SaveCredential): Promise<void> {
    const { error } = await this.client.from("crm_anonymous_saves").delete()
      .eq("id", credential.id)
      .eq("token_hash", await tokenHash(credential.token));
    if (error) throw new Error(`Could not delete save: ${error.message}`);
  }
}

export function createSupabaseGameSaveStore(
  url: string,
  serviceRoleKey: string,
): GameSaveStore {
  return new SupabaseGameSaveStore(createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }));
}
