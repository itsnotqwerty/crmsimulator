import { assertEquals } from "$std/assert/mod.ts";
import { selectGuidance } from "./guidance.ts";
import { createInitialState } from "./state.ts";
import type { Customer, Deal, GameState, Ticket } from "./types.ts";

function baseState(): GameState {
  const state = createInitialState({ seed: 41, now: 1_000 });
  return {
    ...state,
    onboarding: { step: "complete", dismissed: false },
    records: {
      ...state.records,
      leads: {},
      tasks: {},
    },
  };
}

function customer(
  id: string,
  lifecycle: Customer["lifecycle"],
  overrides: Partial<Customer> = {},
): Customer {
  return {
    id,
    companyId: "company_1",
    primaryLeadId: "lead_1",
    monthlyValueCents: 30_000,
    health: 70,
    adoption: 60,
    lifecycle,
    accountPlan: "balanced",
    startedAt: 0,
    nextBillingAt: 30 * 24 * 60,
    renewalAt: 30 * 24 * 60,
    lastSuccessAt: 0,
    expansions: 0,
    ...overrides,
  };
}

function ticket(
  id: string,
  priority: Ticket["priority"],
  status: Ticket["status"] = "open",
): Ticket {
  return {
    id,
    customerId: "customer_1",
    channel: "email",
    priority,
    status,
    title: `${priority} request`,
    createdAt: 0,
    responseDueAt: 60,
    resolutionDueAt: 240,
    escalated: false,
  };
}

function deal(
  id: string,
  stage: Deal["stage"],
  overrides: Partial<Deal> = {},
): Deal {
  return {
    id,
    leadId: "lead_1",
    companyId: "company_1",
    stage,
    product: "growth",
    monthlyValueCents: 40_000,
    probability: 50,
    expectedCloseAt: 1_000,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

Deno.test("guidance starts with deterministic first-lead outreach", () => {
  const state = createInitialState({ seed: 42, now: 1_000 });

  assertEquals(selectGuidance(state), {
    targetId: "lead_1",
    workspace: "leads",
    actionLabel: "Inspect and contact lead",
    reason:
      `${state.records.companies.company_1.name} is ready for the first outreach.`,
  });
});

Deno.test("guidance qualifies contacted high-intent leads before stale work", () => {
  const state = baseState();
  state.clock.gameMinute = 1_000;
  state.records.leads = {
    lead_cold: {
      ...createInitialState({ seed: 1, now: 1 }).records.leads.lead_1,
      id: "lead_cold",
      status: "cold",
      engagement: 10,
      lastActivityAt: 0,
    },
    lead_hot: {
      ...createInitialState({ seed: 2, now: 1 }).records.leads.lead_1,
      id: "lead_hot",
      status: "contacted",
      engagement: 85,
      lastActivityAt: 900,
    },
  };

  assertEquals(selectGuidance(state).targetId, "lead_hot");
  assertEquals(selectGuidance(state).actionLabel, "Qualify lead");
});

Deno.test("guidance follows up the stalest cold or contacted lead", () => {
  const state = baseState();
  state.clock.gameMinute = 1_000;
  const initialLead = createInitialState({ seed: 3, now: 1 }).records.leads
    .lead_1;
  state.records.leads = {
    lead_later: {
      ...initialLead,
      id: "lead_later",
      status: "contacted",
      engagement: 40,
      lastActivityAt: 500,
    },
    lead_first: {
      ...initialLead,
      id: "lead_first",
      status: "cold",
      engagement: 20,
      lastActivityAt: 100,
    },
  };

  assertEquals(selectGuidance(state).targetId, "lead_first");
  assertEquals(selectGuidance(state).actionLabel, "Follow up with lead");
});

Deno.test("guidance advances the earliest eligible deal", () => {
  const state = baseState();
  const initialLead = createInitialState({ seed: 4, now: 1 }).records.leads
    .lead_1;
  state.records.leads = {
    lead_1: { ...initialLead, status: "qualified", engagement: 80 },
  };
  state.records.deals = {
    deal_later: deal("deal_later", "evaluation", { expectedCloseAt: 2_000 }),
    deal_first: deal("deal_first", "negotiation", { expectedCloseAt: 1_000 }),
  };

  assertEquals(selectGuidance(state), {
    targetId: "deal_first",
    workspace: "pipeline",
    actionLabel: "Close deal",
    reason: "This is the next eligible opportunity in the pipeline.",
  });
});

Deno.test("guidance prioritizes at-risk then onboarding customers", () => {
  const state = baseState();
  state.records.customers = {
    customer_onboarding: customer("customer_onboarding", "onboarding"),
    customer_healthier: customer("customer_healthier", "at_risk", {
      health: 40,
    }),
    customer_critical: customer("customer_critical", "at_risk", {
      health: 20,
    }),
  };

  assertEquals(selectGuidance(state).targetId, "customer_critical");
  assertEquals(selectGuidance(state).actionLabel, "Run recovery playbook");

  delete state.records.customers.customer_healthier;
  delete state.records.customers.customer_critical;
  assertEquals(selectGuidance(state).targetId, "customer_onboarding");
  assertEquals(selectGuidance(state).actionLabel, "Complete onboarding");
});

Deno.test("guidance puts unresolved tickets ahead of other records", () => {
  const state = baseState();
  state.records.customers.customer_1 = customer("customer_1", "at_risk");
  state.records.tickets = {
    ticket_normal: ticket("ticket_normal", "normal"),
    ticket_urgent: ticket("ticket_urgent", "urgent", "acknowledged"),
  };

  assertEquals(selectGuidance(state), {
    targetId: "ticket_urgent",
    workspace: "customers",
    actionLabel: "Resolve ticket",
    reason: "An urgent support request needs immediate attention.",
  });
});

Deno.test("guidance reports founder shortage and a steady-state fallback", () => {
  const shortage = baseState();
  const lead = createInitialState({ seed: 5, now: 1 }).records.leads.lead_1;
  shortage.records.leads = { lead_1: lead };
  shortage.company.founderCapacityRemaining = 0;
  assertEquals(selectGuidance(shortage), {
    targetId: "company",
    workspace: "dashboard",
    actionLabel: "Restore founder capacity",
    reason: "Founder capacity is too low for the next lead outreach.",
  });

  const steady = baseState();
  const before = structuredClone(steady);
  assertEquals(selectGuidance(steady), {
    targetId: "company",
    workspace: "dashboard",
    actionLabel: "Review company pulse",
    reason:
      "No urgent records need attention; review performance and plan ahead.",
  });
  assertEquals(steady, before);
});
