import { assert, assertEquals, assertStringIncludes } from "$std/assert/mod.ts";
import { createInitialState } from "../game/state.ts";
import { createSetCookieHeaders } from "../persistence/cookies.ts";
import {
  getRootConfig,
  handleRootPost,
  loadRoot,
  type RootConfig,
} from "./root.ts";
import { SAVE_SCHEMA_VERSION } from "../game/types.ts";

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

function formPost(
  body: URLSearchParams,
  cookies: readonly string[] = [],
): Request {
  return new Request(URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(cookies),
      origin: "https://crm.example",
      "sec-fetch-site": "same-origin",
    },
    body,
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

Deno.test("production smoke requires COOKIE_SECRET", () => {
  const secret = Deno.env.get("COOKIE_SECRET");
  const deploymentId = Deno.env.get("DENO_DEPLOYMENT_ID");
  try {
    Deno.env.delete("COOKIE_SECRET");
    Deno.env.set("DENO_DEPLOYMENT_ID", "release-verification");
    let error: unknown;
    try {
      getRootConfig(new Request(URL));
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof Error);
    assertStringIncludes(error.message, "COOKIE_SECRET is required");
  } finally {
    if (secret === undefined) Deno.env.delete("COOKIE_SECRET");
    else Deno.env.set("COOKIE_SECRET", secret);
    if (deploymentId === undefined) Deno.env.delete("DENO_DEPLOYMENT_ID");
    else Deno.env.set("DENO_DEPLOYMENT_ID", deploymentId);
  }
});

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

Deno.test("production smoke sets secure cookie flags behind forwarded HTTPS", async () => {
  const request = new Request("http://127.0.0.1:8000/", {
    headers: { "x-forwarded-proto": "https" },
  });
  const secret = Deno.env.get("COOKIE_SECRET");
  const deploymentId = Deno.env.get("DENO_DEPLOYMENT_ID");
  let productionConfig: RootConfig;
  try {
    Deno.env.set("COOKIE_SECRET", SECRET);
    Deno.env.set("DENO_DEPLOYMENT_ID", "release-verification");
    productionConfig = { ...getRootConfig(request), now: 1_000, seed: 81 };
  } finally {
    if (secret === undefined) Deno.env.delete("COOKIE_SECRET");
    else Deno.env.set("COOKIE_SECRET", secret);
    if (deploymentId === undefined) Deno.env.delete("DENO_DEPLOYMENT_ID");
    else Deno.env.set("DENO_DEPLOYMENT_ID", deploymentId);
  }

  const loaded = await loadRoot(request, productionConfig);

  assertEquals(productionConfig.secure, true);
  assert(loaded.setCookies.length > 0);
  for (const header of loaded.setCookies) {
    assertStringIncludes(header, "Path=/");
    assertStringIncludes(header, "HttpOnly");
    assertStringIncludes(header, "SameSite=Strict");
    assertStringIncludes(header, "Secure");
  }
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

Deno.test("root GET repairs a pipeline unlock after requirements are met", async () => {
  const initial = createInitialState({ seed: 79, now: 1_000 });
  const lead = initial.records.leads.lead_1;
  const customer = (id: string) => ({
    id,
    companyId: lead.companyId,
    primaryLeadId: lead.id,
    monthlyValueCents: 50_000,
    health: 80,
    adoption: 50,
    lifecycle: "active" as const,
    accountPlan: "balanced" as const,
    startedAt: 0,
    nextBillingAt: 43_200,
    renewalAt: 43_200,
    lastSuccessAt: 0,
    expansions: 0,
  });
  const eligible = {
    ...initial,
    company: {
      ...initial.company,
      customerCount: 3,
      mrrCents: 150_000,
    },
    records: {
      ...initial.records,
      customers: {
        customer_1: customer("customer_1"),
        customer_2: customer("customer_2"),
        customer_3: customer("customer_3"),
      },
    },
    sequences: { ...initial.sequences, customer: 3 },
  };
  const cookies = await createSetCookieHeaders(eligible, SECRET, {
    secure: true,
  });
  const loaded = await loadRoot(requestWithCookies(cookies), config(1_000));

  assertEquals(loaded.data.game.unlocks.includes("pipeline"), true);
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

Deno.test("root reload and save compact excess unassigned active leads", async () => {
  const initial = createInitialState({ seed: 80, now: 1_000 });
  const templateCompany = initial.records.companies.company_1;
  const templateLead = initial.records.leads.lead_1;
  const companies = Object.fromEntries(
    Array.from({ length: 300 }, (_, index) => {
      const sequence = index + 1;
      const id = `company_${sequence}`;
      return [id, {
        ...templateCompany,
        id,
        name: `Company ${sequence}`,
        createdAt: sequence,
      }];
    }),
  );
  const leads = Object.fromEntries(
    Array.from({ length: 300 }, (_, index) => {
      const sequence = index + 1;
      const id = `lead_${sequence}`;
      return [id, {
        ...templateLead,
        id,
        companyId: `company_${sequence}`,
        firstName: `Contact${sequence}`,
        email: `contact-${sequence}@example.test`,
        status: "new" as const,
        createdAt: sequence,
        lastActivityAt: sequence,
      }];
    }),
  );
  const oversized = {
    ...initial,
    sequences: { ...initial.sequences, company: 300, lead: 300 },
    records: { ...initial.records, companies, leads },
  };
  const oversizedCookies = await createSetCookieHeaders(oversized, SECRET, {
    secure: true,
  });
  const reloaded = await loadRoot(
    requestWithCookies(oversizedCookies),
    config(1_000),
  );

  assertEquals(reloaded.data.loadStatus, "loaded");
  assertEquals(Object.keys(reloaded.data.game.records.leads).length, 120);
  assert(reloaded.setCookies.length > 0);

  const initialCookies = await createSetCookieHeaders(initial, SECRET, {
    secure: true,
  });
  const response = await handleRootPost(
    post({ type: "save", state: oversized }, initialCookies),
    config(2_000),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(Object.keys(body.game.records.leads).length, 120);
  assert(responseCookies(response).length <= 13);
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
  const resetGame = (await reset.json()).game;
  assertEquals(resetGame.seed, 76);
  assertEquals(resetGame.narrative, {
    chapter: 0,
    pendingBriefing: true,
  });
  assert(responseCookies(reset).some((cookie) => cookie.includes("Max-Age=0")));
});

Deno.test("production smoke saves and reloads a migrated company", async () => {
  const current = createInitialState({ seed: 82, now: 1_000 });
  const legacy = structuredClone(current) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 23;
  const records = legacy.records as Record<string, unknown>;
  records.customers = {
    customer_1: {
      id: "customer_1",
      companyId: "company_1",
      primaryLeadId: "lead_1",
      monthlyValueCents: 50_000,
      health: 80,
      adoption: 70,
      lifecycle: "active",
      startedAt: 0,
      nextBillingAt: 43_200,
      renewalAt: 43_200,
      lastSuccessAt: 0,
      expansions: 0,
    },
  };
  (legacy.company as Record<string, unknown>).customerCount = 1;
  (legacy.company as Record<string, unknown>).mrrCents = 50_000;

  const imported = await handleRootPost(
    post({ type: "import", data: legacy }),
    config(2_000, 82),
  );
  const saved = (await imported.clone().json()).game;
  const reloaded = await loadRoot(
    requestWithCookies(responseCookies(imported)),
    config(2_000, 82),
  );

  assertEquals(imported.status, 200);
  assertEquals(saved.schemaVersion, SAVE_SCHEMA_VERSION);
  assertEquals(saved.records.customers.customer_1.accountPlan, "balanced");
  assertEquals(reloaded.data.loadStatus, "loaded");
  assertEquals(reloaded.data.game, saved);
});

Deno.test("prologue form begins the company and redirects into the CRM", async () => {
  const initial = createInitialState({ seed: 78, now: 1_000 });
  const cookies = await createSetCookieHeaders(initial, SECRET, {
    secure: true,
  });
  const response = await handleRootPost(
    formPost(new URLSearchParams({ type: "begin" }), cookies),
    config(2_000),
  );

  assertEquals(response.status, 303);
  assertEquals(response.headers.get("location"), "/");
  const loaded = await loadRoot(
    requestWithCookies(responseCookies(response)),
    config(2_000),
  );
  assertEquals(loaded.data.game.narrative, {
    chapter: 0,
    pendingBriefing: false,
  });
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
