import { assert, assertEquals, assertStringIncludes } from "$std/assert/mod.ts";
import { createInitialState } from "../game/state.ts";
import { createSetCookieHeaders } from "../persistence/cookies.ts";
import {
  getRootConfig,
  handleRootPost,
  loadRoot,
  type RootConfig,
} from "./root.ts";

const SECRET = "root-adapter-test-secret";
const URL = "https://crm.example/";

function config(now: number, seed = 71): RootConfig {
  return { secret: SECRET, now, seed, secure: true };
}

function cookieHeader(setCookies: readonly string[]): string {
  return setCookies.map((header) => header.split(";", 1)[0]).join("; ");
}

function requestWithCookies(cookies: readonly string[]): Request {
  return new Request(URL, { headers: { cookie: cookieHeader(cookies) } });
}

function post(
  body: unknown,
  cookies: readonly string[] = [],
  origin = "https://crm.example",
): Request {
  return new Request(URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader(cookies),
      origin,
      "sec-fetch-site": origin === "https://crm.example"
        ? "same-origin"
        : "cross-site",
    },
    body: JSON.stringify(body),
  });
}

function responseCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

function corruptChunk(setCookies: readonly string[]): string[] {
  return setCookies.map((header) => {
    if (!header.startsWith("crm_save_0=")) return header;
    const separator = header.indexOf(";");
    const pair = header.slice(0, separator);
    const replacement = pair.endsWith("x") ? "y" : "x";
    return `${pair.slice(0, -1)}${replacement}${header.slice(separator)}`;
  });
}

Deno.test("root GET initializes a signed cookie save", async () => {
  const loaded = await loadRoot(new Request(URL), config(1_000));

  assertEquals(loaded.data.loadStatus, "new");
  assertEquals(loaded.data.game.seed, 71);
  assert(
    loaded.setCookies.some((cookie) => cookie.startsWith("crm_save_meta=")),
  );
  assert(loaded.setCookies.every((cookie) => cookie.includes("HttpOnly")));
  assert(loaded.setCookies.every((cookie) => cookie.includes("Secure")));
});

Deno.test("forwarded HTTPS marks proxy-served cookies secure", () => {
  const request = new Request("http://127.0.0.1:8000/", {
    headers: { "x-forwarded-proto": "https" },
  });

  assertEquals(getRootConfig(request).secure, true);
});

Deno.test("root GET loads cookies and advances offline time", async () => {
  const initial = createInitialState({ seed: 72, now: 1_000 });
  const cookies = await createSetCookieHeaders(initial, SECRET, {
    secure: true,
  });
  const loaded = await loadRoot(requestWithCookies(cookies), config(61_000));

  assertEquals(loaded.data.loadStatus, "offline");
  assert(loaded.data.game.clock.gameMinute > initial.clock.gameMinute);
  assertEquals(loaded.data.game.revision, initial.revision + 1);
  assert(loaded.setCookies.length > 0);
});

Deno.test("root GET preserves corrupt save cookies", async () => {
  const initial = createInitialState({ seed: 73, now: 1_000 });
  const cookies = await createSetCookieHeaders(initial, SECRET, {
    secure: true,
  });
  const corrupt = corruptChunk(cookies);
  const loaded = await loadRoot(requestWithCookies(corrupt), config(2_000));

  assertEquals(loaded.data.loadStatus, "corrupt");
  assertEquals(loaded.setCookies, []);
  assert(loaded.data.loadError);
});

Deno.test("root save increments revision and rejects stale updates", async () => {
  const initial = createInitialState({ seed: 74, now: 1_000 });
  const initialCookies = await createSetCookieHeaders(initial, SECRET, {
    secure: true,
  });
  const saved = await handleRootPost(
    post({ type: "save", state: initial }, initialCookies),
    config(2_000),
  );
  const savedBody = await saved.json();

  assertEquals(saved.status, 200);
  assertEquals(savedBody.game.revision, 1);

  const stale = await handleRootPost(
    post({ type: "save", state: initial }, responseCookies(saved)),
    config(3_000),
  );
  assertEquals(stale.status, 409);
  assertStringIncludes((await stale.json()).error, "another tab");
});

Deno.test("root POST rejects cross-origin actions", async () => {
  const response = await handleRootPost(
    post({ type: "reset" }, [], "https://attacker.example"),
    config(1_000),
  );

  assertEquals(response.status, 403);
});

Deno.test("root POST accepts same-origin actions through an HTTPS proxy", async () => {
  const request = new Request("http://crm.example/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://crm.example",
      "sec-fetch-site": "same-origin",
      "x-forwarded-proto": "https",
    },
    body: JSON.stringify({ type: "reset" }),
  });

  const response = await handleRootPost(request, config(1_000));

  assertEquals(response.status, 200);
});

Deno.test("root export, import, and reset preserve cookie contract", async () => {
  const initial = createInitialState({ seed: 75, now: 1_000 });
  const initialCookies = await createSetCookieHeaders(initial, SECRET, {
    secure: true,
  });
  const exported = await handleRootPost(
    post({ type: "export" }, initialCookies),
    config(2_000),
  );
  const exportBody = await exported.json();

  assertEquals(exported.status, 200);
  assertEquals(exportBody.seed, initial.seed);
  assertStringIncludes(
    exported.headers.get("content-disposition") ?? "",
    "crm-company-75.json",
  );

  const imported = await handleRootPost(
    post({ type: "import", data: exportBody }, initialCookies),
    config(3_000),
  );
  assertEquals(imported.status, 200);
  assertEquals((await imported.clone().json()).game.revision, 1);
  assert(
    responseCookies(imported).some((cookie) => cookie.includes("HttpOnly")),
  );

  const reset = await handleRootPost(
    post({ type: "reset" }, responseCookies(imported)),
    config(4_000, 76),
  );
  assertEquals(reset.status, 200);
  assertEquals((await reset.json()).game.seed, 76);
  assert(responseCookies(reset).some((cookie) => cookie.includes("Max-Age=0")));
});

Deno.test("ordinary save cannot replace corrupt cookies but import can", async () => {
  const initial = createInitialState({ seed: 77, now: 1_000 });
  const cookies = await createSetCookieHeaders(initial, SECRET, {
    secure: true,
  });
  const corrupt = corruptChunk(cookies);

  const save = await handleRootPost(
    post({ type: "save", state: initial }, corrupt),
    config(2_000),
  );
  assertEquals(save.status, 409);

  const imported = await handleRootPost(
    post({ type: "import", data: initial }, corrupt),
    config(3_000),
  );
  assertEquals(imported.status, 200);
  assert(
    responseCookies(imported).some((cookie) =>
      cookie.startsWith("crm_save_meta=")
    ),
  );
});
