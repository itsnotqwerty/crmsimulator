import { decodeBase64Url, encodeBase64Url } from "$std/encoding/base64url.ts";
import type { GameState } from "../game/types.ts";
import { decodeGameState, encodeGameState } from "./codec.ts";

const COOKIE_FORMAT_VERSION = 1;

export const DEFAULT_COOKIE_OPTIONS = {
  prefix: "crm_save",
  chunkSize: 3_000,
  maxChunks: 12,
  maxAgeSeconds: 365 * 24 * 60 * 60,
} as const;

export interface CookieOptions {
  prefix?: string;
  chunkSize?: number;
  maxChunks?: number;
  maxAgeSeconds?: number;
  secure?: boolean;
  previousChunkCount?: number;
}

interface CookieManifest {
  version: number;
  chunks: number;
  size: number;
  revision: number;
  signature: string;
}

export interface CookieBundle {
  manifest: CookieManifest;
  payload: string;
  cookies: Record<string, string>;
}

function resolvedOptions(options: CookieOptions) {
  return { ...DEFAULT_COOKIE_OPTIONS, ...options };
}

function metadataName(prefix: string): string {
  return `${prefix}_meta`;
}

function chunkName(prefix: string, index: number): string {
  return `${prefix}_${index}`;
}

function signatureInput(
  chunks: number,
  revision: number,
  payload: string,
): string {
  return `${COOKIE_FORMAT_VERSION}.${chunks}.${revision}.${payload}`;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 16) {
    throw new TypeError("Cookie secret must contain at least 16 characters");
  }
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(value: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importHmacKey(secret),
    new TextEncoder().encode(value),
  );
  return encodeBase64Url(signature);
}

async function verify(
  value: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64Url(signature);
  } catch {
    return false;
  }
  const signatureBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(signatureBuffer).set(bytes);
  return await crypto.subtle.verify(
    "HMAC",
    await importHmacKey(secret),
    signatureBuffer,
    new TextEncoder().encode(value),
  );
}

function encodeManifest(manifest: CookieManifest): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(manifest)));
}

function decodeManifest(value: string): CookieManifest {
  const parsed: unknown = JSON.parse(
    new TextDecoder().decode(decodeBase64Url(value)),
  );
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Cookie manifest must be an object");
  }
  const manifest = parsed as Record<string, unknown>;
  if (
    manifest.version !== COOKIE_FORMAT_VERSION ||
    !Number.isInteger(manifest.chunks) || Number(manifest.chunks) < 1 ||
    !Number.isInteger(manifest.size) || Number(manifest.size) < 1 ||
    !Number.isInteger(manifest.revision) || Number(manifest.revision) < 0 ||
    typeof manifest.signature !== "string"
  ) {
    throw new TypeError("Cookie manifest is invalid");
  }
  return manifest as unknown as CookieManifest;
}

export async function createCookieBundle(
  state: GameState,
  secret: string,
  options: CookieOptions = {},
): Promise<CookieBundle> {
  const resolved = resolvedOptions(options);
  if (!Number.isInteger(resolved.chunkSize) || resolved.chunkSize < 512) {
    throw new RangeError(
      "Cookie chunk size must be an integer of at least 512 bytes",
    );
  }
  if (!Number.isInteger(resolved.maxChunks) || resolved.maxChunks < 1) {
    throw new RangeError("Maximum cookie chunks must be a positive integer");
  }

  const payload = await encodeGameState(state);
  const chunks = Math.ceil(payload.length / resolved.chunkSize);
  if (chunks > resolved.maxChunks) {
    throw new RangeError(
      `Encoded save needs ${chunks} cookie chunks; limit is ${resolved.maxChunks}`,
    );
  }
  const signature = await sign(
    signatureInput(chunks, state.revision, payload),
    secret,
  );
  const manifest: CookieManifest = {
    version: COOKIE_FORMAT_VERSION,
    chunks,
    size: payload.length,
    revision: state.revision,
    signature,
  };
  const cookies: Record<string, string> = {
    [metadataName(resolved.prefix)]: encodeManifest(manifest),
  };
  for (let index = 0; index < chunks; index += 1) {
    cookies[chunkName(resolved.prefix, index)] = payload.slice(
      index * resolved.chunkSize,
      (index + 1) * resolved.chunkSize,
    );
  }

  return { manifest, payload, cookies };
}

export async function readCookieBundle(
  cookies: Readonly<Record<string, string>>,
  secret: string,
  options: CookieOptions = {},
): Promise<GameState> {
  const resolved = resolvedOptions(options);
  const encodedManifest = cookies[metadataName(resolved.prefix)];
  if (!encodedManifest) throw new TypeError("Save metadata cookie is missing");
  const manifest = decodeManifest(encodedManifest);
  if (manifest.chunks > resolved.maxChunks) {
    throw new RangeError("Save declares too many cookie chunks");
  }

  let payload = "";
  for (let index = 0; index < manifest.chunks; index += 1) {
    const chunk = cookies[chunkName(resolved.prefix, index)];
    if (!chunk) throw new TypeError(`Save cookie chunk ${index} is missing`);
    payload += chunk;
  }
  if (payload.length !== manifest.size) {
    throw new TypeError("Save cookie payload size does not match its manifest");
  }
  const validSignature = await verify(
    signatureInput(manifest.chunks, manifest.revision, payload),
    manifest.signature,
    secret,
  );
  if (!validSignature) throw new TypeError("Save cookie signature is invalid");

  const state = await decodeGameState(payload);
  if (state.revision !== manifest.revision) {
    throw new TypeError("Save revision does not match its cookie manifest");
  }
  return state;
}

function formatCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  const attributes = [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export async function createSetCookieHeaders(
  state: GameState,
  secret: string,
  options: CookieOptions = {},
): Promise<string[]> {
  const resolved = resolvedOptions(options);
  const bundle = await createCookieBundle(state, secret, resolved);
  const headers = Object.entries(bundle.cookies).map(([name, value]) =>
    formatCookie(name, value, resolved.maxAgeSeconds, resolved.secure ?? false)
  );
  const previousChunkCount = Math.max(
    bundle.manifest.chunks,
    resolved.previousChunkCount ?? 0,
  );
  for (
    let index = bundle.manifest.chunks;
    index < previousChunkCount;
    index += 1
  ) {
    headers.push(formatCookie(
      chunkName(resolved.prefix, index),
      "",
      0,
      resolved.secure ?? false,
    ));
  }
  return headers;
}

export function createClearCookieHeaders(
  options: CookieOptions = {},
): string[] {
  const resolved = resolvedOptions(options);
  const headers = [formatCookie(
    metadataName(resolved.prefix),
    "",
    0,
    resolved.secure ?? false,
  )];
  for (let index = 0; index < resolved.maxChunks; index += 1) {
    headers.push(formatCookie(
      chunkName(resolved.prefix, index),
      "",
      0,
      resolved.secure ?? false,
    ));
  }
  return headers;
}

export function parseCookieHeader(
  header: string | null,
): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator < 1) return [];
      return [[
        part.slice(0, separator).trim(),
        part.slice(separator + 1).trim(),
      ]];
    }),
  );
}
