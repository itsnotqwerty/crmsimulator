import type { SaveCredential } from "./save_store.ts";

export const SAVE_SESSION_COOKIE = "crm_save_session";
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function formatCookie(value: string, maxAge: number, secure: boolean): string {
  const attributes = [
    `${SAVE_SESSION_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function parseSaveCredential(
  value: string | undefined,
): SaveCredential | undefined {
  if (!value) return undefined;
  const separator = value.indexOf(".");
  if (separator < 1 || value.indexOf(".", separator + 1) !== -1) {
    return undefined;
  }
  const id = value.slice(0, separator);
  const token = value.slice(separator + 1);
  return UUID_PATTERN.test(id) && TOKEN_PATTERN.test(token)
    ? { id, token }
    : undefined;
}

export function createSaveSessionCookie(
  credential: SaveCredential,
  secure: boolean,
): string {
  return formatCookie(
    `${credential.id}.${credential.token}`,
    MAX_AGE_SECONDS,
    secure,
  );
}

export function clearSaveSessionCookie(secure: boolean): string {
  return formatCookie("", 0, secure);
}
