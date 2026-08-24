import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "$std/assert/mod.ts";
import { decodeBase64Url, encodeBase64Url } from "$std/encoding/base64url.ts";
import { applyCommand } from "../game/actions.ts";
import { compactGameState } from "../game/compaction.ts";
import { advanceGame } from "../game/simulation.ts";
import { createInitialState, DEFAULT_RULES } from "../game/state.ts";
import { type GameState, SAVE_SCHEMA_VERSION } from "../game/types.ts";
import { createTicketWork } from "../game/work.ts";
import {
  createCookieBundle,
  createSetCookieHeaders,
  DEFAULT_COOKIE_OPTIONS,
  readCookieBundle,
} from "./cookies.ts";
import { decodeGameState, encodeGameState } from "./codec.ts";
import { fitGameStateToEncodedBudget } from "./fit.ts";
import { migrateGameState } from "./migrations.ts";
import { parseGameState, SaveValidationError } from "./schema.ts";

const SECRET = "test-cookie-secret-123456";
const COOKIE_PAYLOAD_BUDGET = DEFAULT_COOKIE_OPTIONS.chunkSize *
  DEFAULT_COOKIE_OPTIONS.maxChunks;

function maximumString(label: string, length: number, index: number): string {
  const prefix = `${label} ${index} `;
  return (prefix + "reliable customer operations ".repeat(length)).slice(
    0,
    length,
  );
}

function variedString(seed: number, length: number): string {
  let value = seed >>> 0;
  return Array.from({ length }, () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return String.fromCharCode(33 + value % 90);
  }).join("");
}

function worstCasePersistenceFixture() {
  const initial = createInitialState({ seed: 260, now: 1_000 });
  const companies = Object.fromEntries(
    Array.from({ length: DEFAULT_RULES.maxLeadRecords + 1 }, (_, index) => {
      const sequence = index + 1;
      return [`company_${sequence}`, {
        id: `company_${sequence}`,
        name: maximumString("Company", 60, sequence),
        industry: maximumString("Industry", 60, sequence),
        employeeCount: 10_000 + sequence,
        region: maximumString("Region", 60, sequence),
        createdAt: sequence,
      }];
    }),
  );
  const leads = Object.fromEntries(
    Array.from({ length: DEFAULT_RULES.maxLeadRecords + 1 }, (_, index) => {
      const sequence = index + 1;
      return [`lead_${sequence}`, {
        id: `lead_${sequence}`,
        companyId: `company_${sequence}`,
        firstName: maximumString("Contact", 60, sequence),
        lastName: maximumString("Owner", 60, sequence),
        email: `contact-${sequence}@maximum-fixture.example`,
        role: maximumString("Revenue operations leader", 60, sequence),
        source: "organic" as const,
        fit: sequence % 101,
        engagement: (sequence * 3) % 101,
        status: sequence > DEFAULT_RULES.maxLeadRecords
          ? "converted" as const
          : "qualified" as const,
        createdAt: sequence,
        lastActivityAt: sequence,
      }];
    }),
  );
  const deals = Object.fromEntries(
    Array.from({ length: DEFAULT_RULES.maxDealRecords + 1 }, (_, index) => {
      const sequence = index + 1;
      return [`deal_${sequence}`, {
        id: `deal_${sequence}`,
        leadId: `lead_${sequence}`,
        companyId: `company_${sequence}`,
        stage: sequence > DEFAULT_RULES.maxDealRecords
          ? "lost" as const
          : "negotiation" as const,
        product: ["starter", "growth", "scale"][sequence % 3] as
          | "starter"
          | "growth"
          | "scale",
        ...(sequence > DEFAULT_RULES.maxDealRecords
          ? { lossReason: "no_decision" as const }
          : {}),
        ownerId: `sales_rep_${sequence % DEFAULT_RULES.maxSalesReps + 1}`,
        monthlyValueCents: 50_000 + sequence,
        probability: sequence > DEFAULT_RULES.maxDealRecords ? 0 : 75,
        expectedCloseAt: 10_000 + sequence,
        createdAt: sequence,
        updatedAt: sequence,
      }];
    }),
  );
  const accountPlans = [
    "balanced",
    "adoption",
    "relationship",
    "expansion",
    "stabilization",
  ] as const;
  const customers = Object.fromEntries(
    Array.from({ length: DEFAULT_RULES.maxTicketRecords }, (_, index) => {
      const sequence = index + 1;
      return [`customer_${sequence}`, {
        id: `customer_${sequence}`,
        companyId: `company_${sequence}`,
        primaryLeadId: `lead_${sequence}`,
        monthlyValueCents: 50_000 + sequence,
        health: 100,
        adoption: 100,
        lifecycle: "active" as const,
        accountPlan: accountPlans[index % accountPlans.length],
        startedAt: sequence,
        nextBillingAt: 50_000 + sequence,
        renewalAt: 50_000 + sequence,
        lastSuccessAt: sequence,
        expansions: sequence,
        ownerId: `success_rep_${sequence % DEFAULT_RULES.maxSuccessReps + 1}`,
        lastNpsScore: 10,
        lastFeedback: maximumString("Customer feedback", 200, sequence),
        lastSurveyAt: sequence,
      }];
    }),
  );
  const tasks = Object.fromEntries(
    Array.from({ length: DEFAULT_RULES.maxTaskRecords + 1 }, (_, index) => {
      const sequence = index + 1;
      const overflow = sequence > DEFAULT_RULES.maxTaskRecords;
      return [`task_${sequence}`, {
        id: `task_${sequence}`,
        kind: "follow_up" as const,
        status: overflow ? "completed" as const : "open" as const,
        relatedId: `lead_${sequence}`,
        title: maximumString("Follow up on account", 100, sequence),
        dueAt: 20_000 + sequence,
        createdAt: sequence,
        ...(overflow ? { completedAt: 20_000 + sequence } : {}),
      }];
    }),
  );
  const objectives = ["balanced", "reach", "quality", "efficiency"] as const;
  const campaigns = Object.fromEntries(
    Array.from({ length: DEFAULT_RULES.maxCampaignRecords }, (_, index) => {
      const sequence = index + 1;
      return [`campaign_${sequence}`, {
        id: `campaign_${sequence}`,
        name: maximumString("Campaign", 60, sequence),
        channel: ["email", "paid_social", "events"][sequence % 3] as
          | "email"
          | "paid_social"
          | "events",
        audience: ["small_business", "mid_market", "enterprise"][
          sequence % 3
        ] as "small_business" | "mid_market" | "enterprise",
        objective: objectives[index % objectives.length],
        status: sequence <= DEFAULT_RULES.maxActiveCampaigns
          ? "active" as const
          : "archived" as const,
        message: maximumString("Campaign message", 200, sequence),
        dailyBudgetCents: 100_000,
        createdAt: sequence,
        endsAt: 50_000 + sequence,
        totalSpentCents: 3_000_000,
        leadsGenerated: 10_000,
      }];
    }),
  );
  const salesReps = Object.fromEntries(
    Array.from({ length: DEFAULT_RULES.maxSalesReps }, (_, index) => {
      const sequence = index + 1;
      return [`sales_rep_${sequence}`, {
        id: `sales_rep_${sequence}`,
        name: maximumString("Sales representative", 60, sequence),
        level: "senior" as const,
        territory: "Asia Pacific" as const,
        monthlySalaryCents: 1_000_000,
        monthlyTargetCents: 10_000_000,
        skill: 100,
        dealCapacity: 100,
        burnout: 100,
        hiredAt: sequence,
      }];
    }),
  );
  const successReps = Object.fromEntries(
    Array.from({ length: DEFAULT_RULES.maxSuccessReps }, (_, index) => {
      const sequence = index + 1;
      return [`success_rep_${sequence}`, {
        id: `success_rep_${sequence}`,
        name: maximumString("Success representative", 60, sequence),
        level: "senior" as const,
        monthlySalaryCents: 1_000_000,
        skill: 100,
        accountCapacity: 100,
        burnout: 100,
        hiredAt: sequence,
      }];
    }),
  );
  const supportReps = Object.fromEntries(
    Array.from({ length: DEFAULT_RULES.maxSupportReps }, (_, index) => {
      const sequence = index + 1;
      return [`support_rep_${sequence}`, {
        id: `support_rep_${sequence}`,
        name: maximumString("Support representative", 60, sequence),
        level: "senior" as const,
        monthlySalaryCents: 1_000_000,
        skill: 100,
        ticketCapacity: 100,
        burnout: 100,
        hiredAt: sequence,
      }];
    }),
  );
  const quotes = Object.fromEntries(
    Array.from({ length: DEFAULT_RULES.maxQuoteRecords }, (_, index) => {
      const sequence = index + 1;
      return [`quote_${sequence}`, {
        id: `quote_${sequence}`,
        dealId: `deal_${sequence}`,
        product: "scale" as const,
        billingCycle: "annual" as const,
        seats: 500,
        discountPercent: 30,
        monthlyValueCents: 1_000_000,
        status: "sent" as const,
        validUntil: 50_000 + sequence,
        createdAt: sequence,
        updatedAt: sequence,
      }];
    }),
  );
  const tickets = Object.fromEntries(
    Array.from({ length: DEFAULT_RULES.maxTicketRecords }, (_, index) => {
      const sequence = index + 1;
      return [`ticket_${sequence}`, {
        id: `ticket_${sequence}`,
        customerId: `customer_${sequence}`,
        channel: ["email", "chat", "phone"][sequence % 3] as
          | "email"
          | "chat"
          | "phone",
        priority: "urgent" as const,
        status: "acknowledged" as const,
        title: maximumString(
          "Production-impacting support request",
          100,
          sequence,
        ),
        createdAt: sequence,
        responseDueAt: 10_000 + sequence,
        resolutionDueAt: 20_000 + sequence,
        ownerId: `support_rep_${sequence % DEFAULT_RULES.maxSupportReps + 1}`,
        acknowledgedAt: sequence,
        responseBreachedAt: 10_000 + sequence,
        resolutionBreachedAt: 20_000 + sequence,
        escalated: sequence <= DEFAULT_RULES.maxIncidentRecords,
        resolutionQuality: 100,
      }];
    }),
  );
  const incidents = Object.fromEntries(
    Array.from({ length: DEFAULT_RULES.maxIncidentRecords }, (_, index) => {
      const sequence = index + 1;
      return [`incident_${sequence}`, {
        id: `incident_${sequence}`,
        ticketId: `ticket_${sequence}`,
        customerId: `customer_${sequence}`,
        title: maximumString("Escalated customer incident", 100, sequence),
        severity: "critical" as const,
        status: "investigating" as const,
        createdAt: sequence,
      }];
    }),
  );

  return {
    ...initial,
    company: {
      ...initial.company,
      name: maximumString("CRM operations company", 60, 1),
      cashCents: 1_000_000_000,
      mrrCents: 100_000_000,
      customerCount: DEFAULT_RULES.maxTicketRecords,
      peakMrrCents: 100_000_000,
    },
    sequences: {
      company: DEFAULT_RULES.maxLeadRecords + 1,
      lead: DEFAULT_RULES.maxLeadRecords + 1,
      deal: DEFAULT_RULES.maxDealRecords + 1,
      customer: DEFAULT_RULES.maxTicketRecords,
      task: DEFAULT_RULES.maxTaskRecords + 1,
      activity: DEFAULT_RULES.maxRecentActivities,
      campaign: DEFAULT_RULES.maxCampaignRecords,
      salesRep: DEFAULT_RULES.maxSalesReps,
      quote: DEFAULT_RULES.maxQuoteRecords,
      successRep: DEFAULT_RULES.maxSuccessReps,
      ticket: DEFAULT_RULES.maxTicketRecords,
      supportRep: DEFAULT_RULES.maxSupportReps,
      incident: DEFAULT_RULES.maxIncidentRecords,
    },
    records: {
      companies,
      leads,
      deals,
      customers,
      tasks,
      campaigns,
      salesReps,
      quotes,
      successReps,
      tickets,
      supportReps,
      incidents,
    },
    recentActivities: Array.from(
      { length: DEFAULT_RULES.maxRecentActivities },
      (_, index) => ({
        id: `activity_${index + 1}`,
        kind: "automation_ran" as const,
        summary: maximumString("Automation completed", 200, index + 1),
        relatedId: `lead_${index + 1}`,
        gameMinute: index + 1,
      }),
    ),
    unlocks: [
      "marketing",
      "pipeline",
      "customer_success",
    ] as GameState["unlocks"],
    platform: {
      ...initial.platform,
      sequences: Array.from({ length: 12 }, (_, index) => ({
        id: `sequence_${index + 1}`,
        name: maximumString("Lifecycle sequence", 60, index + 1),
        audience: index % 2 === 0 ? "leads" as const : "customers" as const,
        enabled: true,
        enrolled: 10_000,
        completed: 9_000,
      })),
      workflows: Array.from({ length: 20 }, (_, index) => ({
        id: `workflow_${index + 1}`,
        name: maximumString("Operations workflow", 60, index + 1),
        trigger: "ticket_created" as const,
        condition: "high_value" as const,
        action: "notify_team" as const,
        enabled: true,
        runs: 10_000,
        errors: 100,
        lastRunAt: 50_000 + index,
      })),
      dashboardWidgets: Array.from(
        { length: 20 },
        (_, index) => maximumString("Dashboard widget", 60, index + 1),
      ),
      departments: Array.from({ length: 8 }, (_, index) => ({
        id: `department_${index + 1}`,
        name: maximumString("Department", 60, index + 1),
        manager: maximumString("Department manager", 60, index + 1),
        monthlyBudgetCents: 100_000_000,
        headcountPlan: 1_000,
        headcount: 1_000,
        burnout: 100,
      })),
      managers: [
        "sales",
        "marketing",
        "customer_success",
        "support",
      ].map((department, index) => ({
        id: `manager_${department}`,
        name: maximumString("Operating manager", 60, index + 1),
        department: department as
          | "sales"
          | "marketing"
          | "customer_success"
          | "support",
        monthlySalaryCents: 2_000_000,
        hiredAt: index + 1,
        lastReviewedAt: 50_000 + index,
        underCapacityReviews: 10_000,
        lastDecision: maximumString("Staffing decision", 200, index + 1),
      })),
      initiativeSequence: 4,
      initiatives: Array.from({ length: 4 }, (_, index) => {
        const sequence = index + 1;
        return {
          id: `initiative_${sequence}`,
          type: ["growth", "efficiency", "retention", "resilience"][index] as
            | "growth"
            | "efficiency"
            | "retention"
            | "resilience",
          status: index === 3 ? "active" as const : "completed" as const,
          startedAt: sequence,
          endsAt: 60_000 + sequence,
          startCostCents: 10_000_000,
          milestoneAt: [
            10_000 + sequence,
            20_000 + sequence,
            30_000 + sequence,
          ] as [number, number, number],
          promptedMilestone: 3,
          decisions: [1, 2, 3].slice(0, index === 3 ? 2 : 3).map((
            milestone,
          ) => ({
            milestone,
            approach: milestone % 2 === 0
              ? "stabilize" as const
              : "accelerate" as const,
            decidedAt: milestone * 10_000 + sequence,
          })),
          ...(index === 3 ? {} : {
            completedAt: 60_000 + sequence,
            rewardCents: 20_000_000,
            outcome: maximumString("Initiative outcome", 200, sequence),
          }),
        };
      }),
      initiativesCompleted: 3,
      quarterInitiativeCompleted: true,
    },
  };
}

function copyToBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function rewriteEncodedState(
  encoded: string,
  rewrite: (compact: Record<string, unknown>) => void,
): Promise<string> {
  const decompressed = await new Response(
    new Blob([copyToBuffer(decodeBase64Url(encoded))]).stream().pipeThrough(
      new DecompressionStream("gzip"),
    ),
  ).arrayBuffer();
  const compact = JSON.parse(
    new TextDecoder().decode(decompressed),
  ) as Record<string, unknown>;
  rewrite(compact);
  const compressed = await new Response(
    new Blob([JSON.stringify(compact)]).stream().pipeThrough(
      new CompressionStream("gzip"),
    ),
  ).arrayBuffer();
  return encodeBase64Url(compressed);
}

Deno.test("codec preserves a valid game state", async () => {
  const state = createInitialState({ seed: 21, now: 1_000 });
  const encoded = await encodeGameState(state);

  assertEquals(await decodeGameState(encoded), state);
  assert(encoded.length < 3_000);
});

Deno.test("codec preserves bounded company initiatives", async () => {
  const initial = createInitialState({ seed: 210, now: 1_000 });
  const mature = {
    ...initial,
    company: {
      ...initial.company,
      cashCents: 5_000_000,
      mrrCents: 1_000_000,
    },
  };
  const started = applyCommand(mature, {
    type: "start_initiative",
    initiativeType: "retention",
  }).state;
  const prompted = advanceGame(
    started,
    started.platform.initiatives[0].milestoneAt[0],
  ).state;
  const decided = applyCommand(prompted, {
    type: "decide_initiative_milestone",
    initiativeId: "initiative_1",
    approach: "stabilize",
  }).state;
  const encoded = await encodeGameState(decided);
  const bundle = await createCookieBundle(decided, SECRET);

  assertEquals(await decodeGameState(encoded), decided);
  assert(encoded.length < 12_000);
  assert(bundle.manifest.chunks <= 4);
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
      objective: "quality",
      dailyBudgetCents: 7_500,
      durationDays: 7,
      message: "Give revenue leaders a reliable view of every open handoff.",
    },
  );
  assert(created.accepted);
  const advanced = advanceGame(created.state, 9 * 60).state;

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

Deno.test("schema rejects an active initiative with every decision", () => {
  const initial = createInitialState({ seed: 241, now: 1_000 });
  const initiative = {
    id: "initiative_1",
    type: "retention" as const,
    status: "active" as const,
    startedAt: 0,
    endsAt: 30 * 24 * 60,
    startCostCents: 100_000,
    milestoneAt: [10, 20, 30] as [number, number, number],
    promptedMilestone: 3,
    decisions: [1, 2, 3].map((milestone) => ({
      milestone,
      approach: "stabilize" as const,
      decidedAt: milestone * 10,
    })),
  };
  const malformed = {
    ...initial,
    platform: {
      ...initial.platform,
      initiativeSequence: 1,
      initiatives: [initiative],
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

Deno.test("version 23 customers migrate to the neutral account plan", () => {
  const current = createInitialState({ seed: 115, now: 1_000 });
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
  const company = legacy.company as Record<string, unknown>;
  company.customerCount = 1;
  company.mrrCents = 50_000;

  const migrated = migrateGameState(legacy);

  assertEquals(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
  assertEquals(
    migrated.records.customers.customer_1.accountPlan,
    "balanced",
  );
});

Deno.test("version 24 campaigns migrate to the neutral objective", () => {
  const initial = createInitialState({ seed: 117, now: 1_000 });
  const created = applyCommand(
    { ...initial, unlocks: ["marketing" as const] },
    {
      type: "create_campaign",
      name: "Legacy campaign",
      channel: "email",
      audience: "mid_market",
      objective: "quality",
      dailyBudgetCents: 5_000,
      durationDays: 7,
      message: "A legacy campaign needs a neutral migrated hypothesis.",
    },
  );
  assert(created.accepted);
  const legacy = structuredClone(created.state) as unknown as Record<
    string,
    unknown
  >;
  legacy.schemaVersion = 24;
  const campaigns = (legacy.records as Record<string, unknown>)
    .campaigns as Record<string, Record<string, unknown>>;
  delete campaigns.campaign_1.objective;

  const migrated = migrateGameState(legacy);

  assertEquals(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
  assertEquals(migrated.records.campaigns.campaign_1.objective, "balanced");
});

Deno.test("version 25 saves gain bounded initiative state", () => {
  const current = createInitialState({ seed: 251, now: 1_000 });
  const legacy = structuredClone(current) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 25;
  const platform = legacy.platform as Record<string, unknown>;
  delete platform.initiativeSequence;
  delete platform.initiatives;
  delete platform.initiativesCompleted;
  delete platform.quarterInitiativeCompleted;

  const migrated = migrateGameState(legacy);

  assertEquals(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
  assertEquals(migrated.platform.initiatives, []);
  assertEquals(migrated.platform.initiativesCompleted, 0);
  assertEquals(migrated.platform.quarterInitiativeCompleted, false);
});

Deno.test("version 26 saves migrate Opal to Moonstone", () => {
  const current = createInitialState({ seed: 261, now: 1_000 });
  const legacy = structuredClone(current) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 26;
  (legacy.preferences as Record<string, unknown>).palette = "opal";

  const migrated = migrateGameState(legacy);

  assertEquals(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
  assertEquals(migrated.preferences.palette, "moonstone");
});

Deno.test("version 27 saves migrate with dark mode disabled", () => {
  const current = createInitialState({ seed: 271, now: 1_000 });
  const legacy = structuredClone(current) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 27;
  delete (legacy.preferences as Record<string, unknown>).darkMode;

  const migrated = migrateGameState(legacy);

  assertEquals(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
  assertEquals(migrated.preferences.darkMode, false);
});

Deno.test("save validation rejects unknown customer account plans", () => {
  const current = createInitialState({ seed: 116, now: 1_000 });
  const invalid = structuredClone(current) as unknown as Record<
    string,
    unknown
  >;
  const records = invalid.records as Record<string, unknown>;
  records.customers = {
    customer_1: {
      id: "customer_1",
      companyId: "company_1",
      primaryLeadId: "lead_1",
      monthlyValueCents: 50_000,
      health: 80,
      adoption: 70,
      lifecycle: "active",
      accountPlan: "revenue-at-any-cost",
      startedAt: 0,
      nextBillingAt: 43_200,
      renewalAt: 43_200,
      lastSuccessAt: 0,
      expansions: 0,
    },
  };
  const company = invalid.company as Record<string, unknown>;
  company.customerCount = 1;
  company.mrrCents = 50_000;

  assertThrows(() => parseGameState(invalid), SaveValidationError);
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
          accountPlan: "expansion" as const,
          startedAt: 0,
          nextBillingAt: 43_200,
          renewalAt: 43_200,
          lastSuccessAt: 0,
          expansions: 0,
        },
      },
    },
  };
  const ticket = createTicketWork(withCustomer, {
    customerId: "customer_1",
    channel: "email",
    priority: "high",
    title: "Dashboard export is unavailable",
  }, DEFAULT_RULES);
  assert(ticket.ok);
  const state = ticket.state;

  const decoded = await decodeGameState(await encodeGameState(state));

  assertEquals(decoded, state);
  assertEquals(decoded.records.tickets.ticket_1.resolutionDueAt, 12 * 60);
  assertEquals(
    decoded.records.customers.customer_1.primaryLeadId,
    "lead_1",
  );
  assertEquals(decoded.records.customers.customer_1.accountPlan, "expansion");
  assertEquals(decoded.preferences.palette, "emerald");
});

Deno.test("codec reads legacy ambiguous customer and manager keys", async () => {
  const initial = createInitialState({ seed: 114, now: 1_000 });
  const state = {
    ...initial,
    company: { ...initial.company, customerCount: 1, mrrCents: 50_000 },
    records: {
      ...initial.records,
      deals: {
        deal_1: {
          id: "deal_1",
          leadId: "lead_1",
          companyId: "company_1",
          stage: "lost" as const,
          product: "starter" as const,
          lossReason: "poor_fit" as const,
          monthlyValueCents: 50_000,
          probability: 0,
          expectedCloseAt: 1_440,
          createdAt: 0,
          updatedAt: 0,
        },
      },
      customers: {
        customer_1: {
          id: "customer_1",
          companyId: "company_1",
          primaryLeadId: "lead_1",
          monthlyValueCents: 50_000,
          health: 80,
          adoption: 70,
          lifecycle: "active" as const,
          accountPlan: "balanced" as const,
          startedAt: 0,
          nextBillingAt: 43_200,
          renewalAt: 43_200,
          lastSuccessAt: 0,
          expansions: 0,
        },
      },
    },
    preferences: { ...initial.preferences, palette: "sapphire" as const },
    platform: {
      ...initial.platform,
      managers: [{
        id: "manager_sales",
        name: "Morgan Lee",
        department: "sales" as const,
        monthlySalaryCents: 1_200_000,
        hiredAt: 0,
        lastReviewedAt: 0,
        underCapacityReviews: 0,
      }],
    },
  };
  const legacyEncoded = await rewriteEncodedState(
    await encodeGameState(state),
    (compact) => {
      const preferences = compact.p as Record<string, unknown>;
      preferences.pl = preferences.pa;
      delete preferences.pa;

      const platform = compact.pf as Record<string, unknown>;
      const manager = (platform.mgs as Record<string, unknown>[])[0];
      manager.lr = manager.lrv;
      delete manager.lrv;
    },
  );

  assertEquals(await decodeGameState(legacyEncoded), state);
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
  const headers = await createSetCookieHeaders(grown, SECRET, { secure: true });

  assert(bundle.manifest.chunks <= 12);
  assert(bundle.payload.length <= 36_000);
  assert(
    headers.every((header) => new TextEncoder().encode(header).length <= 4_096),
  );
});

Deno.test("worst-case bounded save satisfies the release cookie contract", async () => {
  const oversized = worstCasePersistenceFixture();
  const compacted = compactGameState(oversized, DEFAULT_RULES);
  const encoded = await encodeGameState(compacted);
  const bundle = await createCookieBundle(compacted, SECRET);
  const headers = await createSetCookieHeaders(compacted, SECRET, {
    secure: true,
    previousChunkCount: DEFAULT_COOKIE_OPTIONS.maxChunks,
  });

  assertEquals(Object.keys(compacted.records.leads).length, 120);
  assertEquals(Object.keys(compacted.records.deals).length, 80);
  assertEquals(Object.keys(compacted.records.tasks).length, 120);
  assertEquals(Object.keys(compacted.records.companies).length, 120);
  assertEquals(Object.keys(compacted.records.campaigns).length, 40);
  assertEquals(Object.keys(compacted.records.salesReps).length, 8);
  assertEquals(Object.keys(compacted.records.successReps).length, 8);
  assertEquals(Object.keys(compacted.records.supportReps).length, 12);
  assertEquals(Object.keys(compacted.records.tickets).length, 80);
  assertEquals(Object.keys(compacted.records.incidents).length, 30);
  assertEquals(compacted.platform.workflows.length, 20);
  assertEquals(compacted.platform.initiatives.length, 4);
  assertEquals(
    new Set(
      Object.values(compacted.records.customers).map((customer) =>
        customer.accountPlan
      ),
    ),
    new Set([
      "balanced",
      "adoption",
      "relationship",
      "expansion",
      "stabilization",
    ]),
  );
  assertEquals(
    new Set(
      Object.values(compacted.records.campaigns).map((campaign) =>
        campaign.objective
      ),
    ),
    new Set(["balanced", "reach", "quality", "efficiency"]),
  );
  assertEquals(compacted.records.leads.lead_121, undefined);
  assertEquals(compacted.records.deals.deal_81, undefined);
  assertEquals(compacted.records.tasks.task_121, undefined);
  assertEquals(compacted.records.companies.company_121, undefined);
  assertEquals(await decodeGameState(encoded), compacted);
  assertEquals(await readCookieBundle(bundle.cookies, SECRET), compacted);
  assert(encoded.length <= COOKIE_PAYLOAD_BUDGET);
  assert(bundle.manifest.chunks <= DEFAULT_COOKIE_OPTIONS.maxChunks);
  assert(
    headers.every((header) =>
      new TextEncoder().encode(header).byteLength <= 4_096
    ),
  );
  for (
    let index = bundle.manifest.chunks;
    index < DEFAULT_COOKIE_OPTIONS.maxChunks;
    index += 1
  ) {
    assert(
      headers.some((header) =>
        header.startsWith(`crm_save_${index}=;`) &&
        header.includes("Max-Age=0")
      ),
    );
  }
});

Deno.test("activity history compacts a 13-chunk save to the cookie budget", async () => {
  const compacted = compactGameState(
    worstCasePersistenceFixture(),
    DEFAULT_RULES,
  );
  let oversized: GameState | undefined;

  for (
    let varied = 10;
    varied <= compacted.recentActivities.length;
    varied += 10
  ) {
    const candidate = {
      ...compacted,
      recentActivities: compacted.recentActivities.map((activity, index) =>
        index < varied
          ? { ...activity, summary: variedString(index + 1, 200) }
          : activity
      ),
    };
    const length = (await encodeGameState(candidate)).length;
    if (length > COOKIE_PAYLOAD_BUDGET && length <= 39_000) {
      oversized = candidate;
      break;
    }
  }

  assert(oversized, "Fixture must require exactly 13 cookie chunks");
  const before = await encodeGameState(oversized);
  assertEquals(Math.ceil(before.length / DEFAULT_COOKIE_OPTIONS.chunkSize), 13);

  const fitted = await fitGameStateToEncodedBudget(
    oversized,
    DEFAULT_RULES,
    COOKIE_PAYLOAD_BUDGET,
  );
  const bundle = await createCookieBundle(fitted, SECRET);

  assert(fitted.recentActivities.length < oversized.recentActivities.length);
  assert(
    fitted.history.activitiesArchived > oversized.history.activitiesArchived,
  );
  assert(bundle.payload.length <= COOKIE_PAYLOAD_BUDGET);
  assert(bundle.manifest.chunks <= DEFAULT_COOKIE_OPTIONS.maxChunks);
  assertEquals(await decodeGameState(bundle.payload), fitted);
});

Deno.test("long-running saves compact inactive sales history", async () => {
  const initial = createInitialState({ seed: 27, now: 1_000 });
  const funded = {
    ...initial,
    company: {
      ...initial.company,
      cashCents: 10_000_000_000,
      baselineMonthlyExpensesCents: 1,
    },
  };
  const grown = advanceGame(funded, 480 * 24 * 60).state;
  const bundle = await createCookieBundle(grown, SECRET);

  assert(Object.keys(grown.records.leads).length <= 120);
  assertEquals(
    Object.keys(grown.records.companies).length,
    Object.keys(grown.records.leads).length,
  );
  assert(bundle.manifest.chunks <= 12);
  assert(bundle.payload.length <= 36_000);
});

Deno.test("compaction archives excess unassigned active leads", async () => {
  const initial = createInitialState({ seed: 28, now: 1_000 });
  const templateCompany = initial.records.companies.company_1;
  const templateLead = initial.records.leads.lead_1;
  const companies = Object.fromEntries(
    Array.from({ length: 300 }, (_, index) => {
      const sequence = index + 1;
      const id = `company_${sequence}`;
      return [id, {
        ...templateCompany,
        id,
        name: `Company ${sequence} ${sequence.toString(36)}`,
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
        firstName: `Contact${sequence.toString(36)}`,
        email: `contact-${sequence}-${
          (sequence * 2_654_435_761 >>> 0).toString(36)
        }@example.test`,
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
  const compacted = compactGameState(oversized, DEFAULT_RULES);
  const bundle = await createCookieBundle(compacted, SECRET);

  assertEquals(Object.keys(compacted.records.leads).length, 120);
  assertEquals(Object.keys(compacted.records.companies).length, 120);
  assert(compacted.records.leads.lead_300);
  assertEquals(compacted.records.leads.lead_1, undefined);
  assert(bundle.manifest.chunks <= 12);
});
