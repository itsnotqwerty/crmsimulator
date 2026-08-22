import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "$std/assert/mod.ts";
import { applyCommand } from "../game/actions.ts";
import { advanceGame } from "../game/simulation.ts";
import { createInitialState } from "../game/state.ts";
import {
  createCookieBundle,
  createSetCookieHeaders,
  readCookieBundle,
} from "./cookies.ts";
import { decodeGameState, encodeGameState } from "./codec.ts";
import { migrateGameState } from "./migrations.ts";
import { parseGameState, SaveValidationError } from "./schema.ts";

const SECRET = "test-cookie-secret-123456";

Deno.test("codec preserves a valid game state", async () => {
  const state = createInitialState({ seed: 21, now: 1_000 });
  const encoded = await encodeGameState(state);

  assertEquals(await decodeGameState(encoded), state);
  assert(encoded.length < 3_000);
});

Deno.test("codec preserves campaign records and attribution fields", async () => {
  const initial = createInitialState({ seed: 28, now: 1_000 });
  const created = applyCommand(
    { ...initial, unlocks: ["marketing" as const] },
    {
      type: "create_campaign",
      name: "Pipeline Clarity",
      channel: "paid_social",
      audience: "enterprise",
      dailyBudgetCents: 7_500,
      durationDays: 7,
      message: "Give revenue leaders a reliable view of every open handoff.",
    },
  );
  assert(created.accepted);
  const advanced = advanceGame(created.state, 4 * 60).state;

  assertEquals(
    await decodeGameState(await encodeGameState(advanced)),
    advanced,
  );
  assertEquals(advanced.records.leads.lead_2.campaignId, "campaign_1");
});

Deno.test("codec preserves sales representatives and deal ownership", async () => {
  let state = createInitialState({ seed: 30, now: 1_000 });
  state = applyCommand(state, {
    type: "contact_lead",
    leadId: "lead_1",
    channel: "email",
  }).state;
  state = applyCommand(state, {
    type: "qualify_lead",
    leadId: "lead_1",
  }).state;
  state = { ...state, unlocks: ["pipeline"] };
  state = applyCommand(state, {
    type: "hire_sales_rep",
    name: "Avery Chen",
    level: "mid",
    territory: "Europe",
    monthlyTargetCents: 1_500_000,
  }).state;
  state = applyCommand(state, {
    type: "assign_deal",
    dealId: "deal_1",
    ownerId: "sales_rep_1",
  }).state;

  const decoded = await decodeGameState(await encodeGameState(state));

  assertEquals(decoded, state);
  assertEquals(decoded.records.deals.deal_1.ownerId, "sales_rep_1");
  assertEquals(decoded.records.salesReps.sales_rep_1.skill, 65);
});

Deno.test("schema rejects malformed state", () => {
  const state = createInitialState({ seed: 22, now: 1_000 });
  const malformed = {
    ...state,
    company: { ...state.company, founderCapacityRemaining: -1 },
  };

  assertThrows(
    () => parseGameState(malformed),
    SaveValidationError,
  );
});

Deno.test("version 1 saves migrate with empty campaign state", () => {
  const legacy = structuredClone(
    createInitialState({ seed: 27, now: 1_000 }),
  ) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 1;
  delete (legacy.sequences as Record<string, unknown>).campaign;
  delete (legacy.records as Record<string, unknown>).campaigns;
  delete (legacy.history as Record<string, unknown>).campaignsArchived;
  delete (legacy.history as Record<string, unknown>)
    .campaignSpendArchivedCents;
  delete (legacy.history as Record<string, unknown>).campaignLeadsArchived;

  const migrated = migrateGameState(legacy);
  assertEquals(migrated.schemaVersion, 6);
  assertEquals(migrated.sequences.campaign, 0);
  assertEquals(migrated.records.campaigns, {});
  assertEquals(migrated.history.campaignsArchived, 0);
  assertEquals(migrated.sequences.salesRep, 0);
  assertEquals(migrated.records.salesReps, {});
  assertEquals(migrated.sequences.quote, 0);
  assertEquals(migrated.records.quotes, {});
});

Deno.test("version 3 deals migrate with an inferred product", () => {
  let state = createInitialState({ seed: 29, now: 1_000 });
  state = applyCommand(state, {
    type: "contact_lead",
    leadId: "lead_1",
    channel: "email",
  }).state;
  state = applyCommand(state, {
    type: "qualify_lead",
    leadId: "lead_1",
  }).state;
  const expectedProduct = state.records.deals.deal_1.product;
  const legacy = structuredClone(state) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 3;
  const deals = (legacy.records as Record<string, unknown>).deals as Record<
    string,
    Record<string, unknown>
  >;
  delete deals.deal_1.product;

  const migrated = migrateGameState(legacy);

  assertEquals(migrated.schemaVersion, 6);
  assertEquals(migrated.records.deals.deal_1.product, expectedProduct);
  assertEquals(migrated.records.salesReps, {});
  assertEquals(migrated.records.quotes, {});
});

Deno.test("signed cookie bundle round trips", async () => {
  const state = createInitialState({ seed: 23, now: 1_000 });
  const bundle = await createCookieBundle(state, SECRET);

  assertEquals(await readCookieBundle(bundle.cookies, SECRET), state);
  assertEquals(bundle.manifest.chunks, 1);
});

Deno.test("modified cookie payload is rejected", async () => {
  const state = createInitialState({ seed: 24, now: 1_000 });
  const bundle = await createCookieBundle(state, SECRET);
  const cookies = { ...bundle.cookies };
  const chunkName = Object.keys(cookies).find((name) => name.endsWith("_0"));
  assert(chunkName);
  cookies[chunkName] = `${cookies[chunkName].slice(0, -1)}x`;

  await assertRejects(
    () => readCookieBundle(cookies, SECRET),
    TypeError,
    "signature",
  );
});

Deno.test("cookie headers include security flags and stale cleanup", async () => {
  const state = createInitialState({ seed: 25, now: 1_000 });
  const headers = await createSetCookieHeaders(state, SECRET, {
    secure: true,
    previousChunkCount: 3,
  });

  assert(headers.length >= 4);
  assertStringIncludes(headers[0], "HttpOnly");
  assertStringIncludes(headers[0], "SameSite=Strict");
  assertStringIncludes(headers[0], "Secure");
  assert(headers.some((header) => header.startsWith("crm_save_1=;")));
  assert(headers.some((header) => header.includes("Max-Age=0")));
});

Deno.test("grown deterministic save remains inside cookie budget", async () => {
  const initial = createInitialState({ seed: 26, now: 1_000 });
  const funded = {
    ...initial,
    company: {
      ...initial.company,
      cashCents: 100_000_000,
      baselineMonthlyExpensesCents: 1,
    },
  };
  const grown = advanceGame(funded, 60 * 24 * 60).state;
  const bundle = await createCookieBundle(grown, SECRET);

  assert(bundle.manifest.chunks <= 12);
  assert(bundle.payload.length <= 36_000);
});
