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
import { SAVE_SCHEMA_VERSION } from "../game/types.ts";
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
  assert(
    Object.values(advanced.records.leads).some((lead) =>
      lead.campaignId === "campaign_1"
    ),
  );
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

Deno.test("schema rejects malformed operating managers", () => {
  const state = createInitialState({ seed: 24, now: 1_000 });
  const malformed = {
    ...state,
    platform: {
      ...state.platform,
      managers: [{
        id: "manager_sales",
        name: "Morgan Lee",
        department: "finance",
        monthlySalaryCents: 1_200_000,
        hiredAt: 0,
        lastReviewedAt: 0,
        underCapacityReviews: 0,
      }],
    },
  };

  assertThrows(() => parseGameState(malformed), SaveValidationError);
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
  assertEquals(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
  assertEquals(migrated.sequences.campaign, 0);
  assertEquals(migrated.records.campaigns, {});
  assertEquals(migrated.history.campaignsArchived, 0);
  assertEquals(migrated.sequences.salesRep, 0);
  assertEquals(migrated.records.salesReps, {});
  assertEquals(migrated.sequences.quote, 0);
  assertEquals(migrated.records.quotes, {});
  assertEquals(migrated.sequences.ticket, 0);
  assertEquals(migrated.records.tickets, {});
  assertEquals(migrated.sequences.supportRep, 0);
  assertEquals(migrated.records.supportReps, {});
  assertEquals(migrated.sequences.incident, 0);
  assertEquals(migrated.records.incidents, {});
  assertEquals(migrated.preferences.timeScale, 2);
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

  assertEquals(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
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

Deno.test("codec preserves populated quote records", async () => {
  let state = createInitialState({ seed: 27, now: 1_000 });
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
    type: "create_quote",
    dealId: "deal_1",
    product: "scale",
    billingCycle: "annual",
    seats: 75,
    discountPercent: 15,
    validDays: 21,
  }).state;

  assertEquals(await decodeGameState(await encodeGameState(state)), state);
});

Deno.test("version 8 customers migrate into active lifecycle records", () => {
  const current = createInitialState({ seed: 28, now: 1_000 });
  const legacy = {
    ...current,
    schemaVersion: 8,
    company: { ...current.company, customerCount: 1, mrrCents: 50_000 },
    records: {
      ...current.records,
      customers: {
        customer_1: {
          id: "customer_1",
          companyId: "company_1",
          primaryLeadId: "lead_1",
          monthlyValueCents: 50_000,
          health: 80,
          startedAt: 0,
          nextBillingAt: 43_200,
        },
      },
    },
  };

  const migrated = migrateGameState(legacy);
  assertEquals(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
  assertEquals(migrated.records.customers.customer_1.lifecycle, "active");
  assertEquals(migrated.records.customers.customer_1.adoption, 65);
  assertEquals(migrated.records.customers.customer_1.renewalAt, 43_200);
});

Deno.test("version 11 tickets migrate to dedicated support ownership", () => {
  const current = createInitialState({ seed: 32, now: 1_000 });
  const legacy = structuredClone(current) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 11;
  const sequences = legacy.sequences as Record<string, unknown>;
  delete sequences.supportRep;
  delete sequences.incident;
  const records = legacy.records as Record<string, unknown>;
  delete records.supportReps;
  delete records.incidents;
  records.tickets = {
    ticket_1: {
      id: "ticket_1",
      customerId: "customer_1",
      channel: "email",
      priority: "normal",
      status: "open",
      title: "Legacy issue",
      createdAt: 0,
      responseDueAt: 480,
      resolutionDueAt: 1_440,
      ownerId: "success_rep_1",
    },
  };
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

  const migrated = migrateGameState(legacy);

  assertEquals(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
  assertEquals(migrated.records.tickets.ticket_1.ownerId, undefined);
  assertEquals(migrated.records.tickets.ticket_1.escalated, false);
  assertEquals(migrated.records.supportReps, {});
  assertEquals(migrated.records.incidents, {});
});

Deno.test("version 16 migration repairs assignment-inflated ticket history", () => {
  const current = createInitialState({ seed: 105, now: 1_000 });
  const legacy = structuredClone(current) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 16;
  delete (legacy.preferences as Record<string, unknown>).timeScale;
  const history = legacy.history as Record<string, unknown>;
  history.ticketsResolved = 5;
  history.ticketResolutionMinutes = 200;

  const migrated = migrateGameState(legacy);

  assertEquals(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
  assertEquals(migrated.history.ticketsResolved, 0);
  assertEquals(migrated.history.ticketResolutionMinutes, 0);
  assertEquals(migrated.preferences.timeScale, 2);
});

Deno.test("version 18 saves drop unused data-ops platform fields", () => {
  const current = createInitialState({ seed: 110, now: 1_000 });
  const legacy = structuredClone(current) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 18;
  const platform = legacy.platform as Record<string, unknown>;
  platform.integrations = [{
    id: "integration_1",
    name: "Ledger",
    mapping: "company → account",
    status: "connected",
    recordsSynced: 25,
    failures: 0,
  }];
  platform.customFields = ["Renewal priority"];
  platform.savedViews = ["At-risk accounts"];
  platform.duplicateReviews = 3;
  platform.duplicatesMerged = 2;

  const migrated = migrateGameState(legacy);

  assertEquals(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
  assertEquals("integrations" in migrated.platform, false);
  assertEquals("customFields" in migrated.platform, false);
  assertEquals("savedViews" in migrated.platform, false);
  assertEquals("duplicateReviews" in migrated.platform, false);
  assertEquals("duplicatesMerged" in migrated.platform, false);
  assertEquals(migrated.platform.workflows, []);
});

Deno.test("version 19 saves migrate with an empty manager roster", () => {
  const current = createInitialState({ seed: 111, now: 1_000 });
  const legacy = structuredClone(current) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 19;
  delete (legacy.platform as Record<string, unknown>).managers;

  const migrated = migrateGameState(legacy);

  assertEquals(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
  assertEquals(migrated.platform.managers, []);
  assertEquals(migrated.preferences.palette, "emerald");
});

Deno.test("version 21 saves migrate the Berry palette to Pearl", () => {
  const current = createInitialState({ seed: 112, now: 1_000 });
  const legacy = structuredClone(current) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 21;
  (legacy.preferences as Record<string, unknown>).palette = "berry";

  const migrated = migrateGameState(legacy);

  assertEquals(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
  assertEquals(migrated.preferences.palette, "pearl");
});

Deno.test("version 22 saves migrate legacy palette names to gemstones", () => {
  const current = createInitialState({ seed: 113, now: 1_000 });
  const legacy = structuredClone(current) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 22;
  (legacy.preferences as Record<string, unknown>).palette = "graphite";

  const migrated = migrateGameState(legacy);

  assertEquals(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
  assertEquals(migrated.preferences.palette, "onyx");
});

Deno.test("codec preserves success representatives and account ownership", async () => {
  const initial = createInitialState({ seed: 29, now: 1_000 });
  const state = applyCommand(
    { ...initial, unlocks: ["customer_success"] },
    { type: "hire_success_rep", name: "Morgan Lee", level: "mid" },
  ).state;

  assertEquals(await decodeGameState(await encodeGameState(state)), state);
  assertEquals(state.records.successReps.success_rep_1.accountCapacity, 12);
});

Deno.test("codec preserves support tickets and SLA deadlines", async () => {
  const initial = createInitialState({ seed: 31, now: 1_000 });
  const withCustomer = {
    ...initial,
    unlocks: ["customer_success" as const],
    company: { ...initial.company, customerCount: 1, mrrCents: 50_000 },
    records: {
      ...initial.records,
      customers: {
        customer_1: {
          id: "customer_1",
          companyId: "company_1",
          primaryLeadId: "lead_1",
          monthlyValueCents: 50_000,
          health: 80,
          adoption: 70,
          lifecycle: "active" as const,
          startedAt: 0,
          nextBillingAt: 43_200,
          renewalAt: 43_200,
          lastSuccessAt: 0,
          expansions: 0,
        },
      },
    },
  };
  const state = applyCommand(withCustomer, {
    type: "create_ticket",
    customerId: "customer_1",
    channel: "email",
    priority: "high",
    title: "Dashboard export is unavailable",
  }).state;

  const decoded = await decodeGameState(await encodeGameState(state));

  assertEquals(decoded, state);
  assertEquals(decoded.records.tickets.ticket_1.resolutionDueAt, 12 * 60);
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
