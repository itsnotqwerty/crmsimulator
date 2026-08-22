import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
  assertStringIncludes,
} from "$std/assert/mod.ts";
import { applyCommand } from "./actions.ts";
import { randomAt } from "./rng.ts";
import {
  advanceGame,
  advanceOffline,
  campaignSaturation,
} from "./simulation.ts";
import {
  createInitialState,
  DEFAULT_RULES,
  validateGameState,
} from "./state.ts";
import type { GameState } from "./types.ts";

Deno.test("initial state is deterministic and valid", () => {
  const first = createInitialState({ seed: 42, now: 1_000 });
  const second = createInitialState({ seed: 42, now: 1_000 });

  assertEquals(first, second);
  assertEquals(validateGameState(first), { ok: true });
  assertEquals(Object.keys(first.records.leads), ["lead_1"]);
});

Deno.test("random values depend only on seed and cursor", () => {
  assertEquals(randomAt(99, 7), randomAt(99, 7));
  assert(randomAt(99, 7) !== randomAt(99, 8));
});

Deno.test("segmented and batched simulation are equivalent", () => {
  const initial = createInitialState({ seed: 11, now: 1_000 });
  const batched = advanceGame(initial, 60).state;
  let segmented = initial;
  for (let index = 0; index < 6; index += 1) {
    segmented = advanceGame(segmented, 10).state;
  }

  assertEquals(segmented, batched);
});

Deno.test("rejected commands preserve the original state reference", () => {
  const state = createInitialState({ seed: 4, now: 1_000 });
  const result = applyCommand(state, {
    type: "qualify_lead",
    leadId: "lead_1",
  });

  assertEquals(result.accepted, false);
  assertStrictEquals(result.state, state);
});

Deno.test("lead commands create a customer and recurring revenue", () => {
  let state = createInitialState({ seed: 5, now: 1_000 });
  const contacted = applyCommand(state, {
    type: "contact_lead",
    leadId: "lead_1",
    channel: "email",
  });
  assert(contacted.accepted);
  state = contacted.state;

  const qualified = applyCommand(state, {
    type: "qualify_lead",
    leadId: "lead_1",
  });
  assert(qualified.accepted);
  state = qualified.state;

  const dealId = Object.keys(state.records.deals)[0];
  for (let step = 0; step < 4; step += 1) {
    const advanced = applyCommand(state, { type: "advance_deal", dealId });
    assert(advanced.accepted);
    state = advanced.state;
  }

  assertEquals(state.records.deals[dealId].stage, "won");
  assertEquals(state.company.customerCount, 1);
  assert(state.company.mrrCents > 0);
  assertNotStrictEquals(state, qualified.state);
});

Deno.test("rapid repeated contact sharply reduces lead intent", () => {
  const initial = createInitialState({ seed: 5, now: 1_000 });
  const firstContact = applyCommand(initial, {
    type: "contact_lead",
    leadId: "lead_1",
    channel: "email",
  });
  assert(firstContact.accepted);
  const initialIntent = firstContact.state.records.leads.lead_1.engagement;

  const secondContact = applyCommand(firstContact.state, {
    type: "contact_lead",
    leadId: "lead_1",
    channel: "email",
  });
  assert(secondContact.accepted);
  const thirdContact = applyCommand(secondContact.state, {
    type: "contact_lead",
    leadId: "lead_1",
    channel: "call",
  });
  assert(thirdContact.accepted);

  assertEquals(
    secondContact.state.records.leads.lead_1.engagement,
    Math.max(0, initialIntent - 20),
  );
  assertEquals(
    thirdContact.state.records.leads.lead_1.engagement,
    Math.max(0, initialIntent - 50),
  );
  assertStringIncludes(
    thirdContact.events[0].summary,
    "intent fell sharply",
  );
});

Deno.test("customer onboarding and expansion grow account value", () => {
  let state = createInitialState({ seed: 48, now: 1_000 });
  state = applyCommand(state, {
    type: "contact_lead",
    leadId: "lead_1",
    channel: "email",
  }).state;
  state = applyCommand(state, {
    type: "qualify_lead",
    leadId: "lead_1",
  }).state;
  for (let step = 0; step < 4; step += 1) {
    state = applyCommand(state, {
      type: "advance_deal",
      dealId: "deal_1",
    }).state;
  }
  const customer = state.records.customers.customer_1;
  assertEquals(customer.lifecycle, "onboarding");
  assertEquals(customer.adoption, 25);

  state = applyCommand(state, {
    type: "complete_customer_onboarding",
    customerId: customer.id,
  }).state;
  state = applyCommand(state, {
    type: "customer_check_in",
    customerId: customer.id,
  }).state;
  assertEquals(state.records.customers.customer_1.lifecycle, "active");
  assertEquals(state.records.customers.customer_1.adoption, 68);

  state = advanceGame(state, 2 * 24 * 60).state;
  const beforeExpansionMrr = state.company.mrrCents;
  const expanded = applyCommand(state, {
    type: "expand_customer",
    customerId: customer.id,
  });
  assert(expanded.accepted);
  assert(expanded.state.company.mrrCents > beforeExpansionMrr);
  assertEquals(expanded.state.records.customers.customer_1.expansions, 1);
});

Deno.test("unhealthy customers churn at renewal", () => {
  const initial = createInitialState({ seed: 49, now: 1_000 });
  const state = {
    ...initial,
    company: { ...initial.company, customerCount: 1, mrrCents: 50_000 },
    records: {
      ...initial.records,
      customers: {
        customer_1: {
          id: "customer_1",
          companyId: "company_1",
          primaryLeadId: "lead_1",
          monthlyValueCents: 50_000,
          health: 20,
          adoption: 20,
          lifecycle: "at_risk" as const,
          startedAt: 0,
          nextBillingAt: 60,
          renewalAt: 60,
          lastSuccessAt: 0,
          expansions: 0,
        },
      },
    },
  };

  const advanced = advanceGame(state, 60).state;
  assertEquals(advanced.records.customers, {});
  assertEquals(advanced.company.customerCount, 0);
  assertEquals(advanced.company.mrrCents, 0);
  assertEquals(advanced.history.customersLost, 1);
});

Deno.test("success representatives own accounts and improve playbooks", () => {
  let state = createInitialState({ seed: 50, now: 1_000 });
  state = {
    ...state,
    unlocks: ["customer_success"],
    company: { ...state.company, customerCount: 1, mrrCents: 50_000 },
    records: {
      ...state.records,
      customers: {
        customer_1: {
          id: "customer_1",
          companyId: "company_1",
          primaryLeadId: "lead_1",
          monthlyValueCents: 50_000,
          health: 40,
          adoption: 35,
          lifecycle: "at_risk" as const,
          startedAt: 0,
          nextBillingAt: 43_200,
          renewalAt: 43_200,
          lastSuccessAt: 0,
          expansions: 0,
        },
      },
    },
  };
  state = applyCommand(state, {
    type: "hire_success_rep",
    name: "Morgan Lee",
    level: "senior",
  }).state;
  state = applyCommand(state, {
    type: "assign_customer",
    customerId: "customer_1",
    ownerId: "success_rep_1",
  }).state;
  const played = applyCommand(state, {
    type: "run_success_playbook",
    customerId: "customer_1",
    playbook: "recovery",
  });

  assert(played.accepted);
  assertEquals(
    played.state.records.customers.customer_1.ownerId,
    "success_rep_1",
  );
  assert(played.state.records.customers.customer_1.health > 60);
  assertEquals(
    played.state.company.founderCapacityRemaining,
    state.company.founderCapacityRemaining,
  );
});

Deno.test("NPS surveys produce deterministic bounded feedback", () => {
  const initial = createInitialState({ seed: 54, now: 1_000 });
  const state = {
    ...initial,
    company: { ...initial.company, customerCount: 1, mrrCents: 50_000 },
    records: {
      ...initial.records,
      customers: {
        customer_1: {
          id: "customer_1",
          companyId: "company_1",
          primaryLeadId: "lead_1",
          monthlyValueCents: 50_000,
          health: 70,
          adoption: 65,
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

  const first = applyCommand(state, {
    type: "send_nps_survey",
    customerId: "customer_1",
  });
  const replay = applyCommand(state, {
    type: "send_nps_survey",
    customerId: "customer_1",
  });

  assert(first.accepted);
  assertEquals(first, replay);
  assert(first.state.records.customers.customer_1.lastNpsScore !== undefined);
  assert(first.state.records.customers.customer_1.lastFeedback);
  assertEquals(first.state.records.customers.customer_1.lastSurveyAt, 0);
  const repeated = applyCommand(first.state, {
    type: "send_nps_survey",
    customerId: "customer_1",
  });
  assertEquals(repeated.accepted, false);
  assertStrictEquals(repeated.state, first.state);
  assertEquals(first.state.history.npsResponses, 1);
});

Deno.test("automation and simulated integrations replay deterministically", () => {
  let state = createInitialState({ seed: 55, now: 1_000 });
  state = applyCommand(state, {
    type: "create_sequence",
    name: "Founder follow-up",
    audience: "leads",
  }).state;
  state = applyCommand(state, {
    type: "create_workflow",
    name: "Route hot leads",
    trigger: "lead_created",
    condition: "high_value",
    action: "assign_owner",
  }).state;
  state = applyCommand(state, {
    type: "connect_integration",
    name: "Ledger sync",
    mapping: "company -> account",
  }).state;
  const first = advanceGame(state, 24 * 60).state;
  const replay = advanceGame(state, 24 * 60).state;
  assertEquals(first, replay);
  assertEquals(first.platform.automationRunsArchived, 1);
  assertEquals(first.platform.sequences[0].enrolled, 1);
  assert(
    ["connected", "failed"].includes(first.platform.integrations[0].status),
  );
});

Deno.test("mature operations enforce plans and escalating goals", () => {
  let state = createInitialState({ seed: 56, now: 1_000 });
  state = {
    ...state,
    company: { ...state.company, cashCents: 5_000_000, mrrCents: 1_000_000 },
  };
  state = applyCommand(state, {
    type: "create_department",
    name: "Revenue Operations",
    manager: "Taylor Morgan",
    monthlyBudgetCents: 500_000,
    headcountPlan: 3,
  }).state;
  state = applyCommand(state, {
    type: "hire_department_staff",
    departmentId: "department_1",
  }).state;
  const goal = applyCommand(state, { type: "advance_endless_goal" });
  assert(goal.accepted);
  assertEquals(goal.state.platform.departments[0].headcount, 2);
  assertEquals(goal.state.platform.endlessGoal, 2);
});

Deno.test("support tickets follow an assigned SLA lifecycle", () => {
  let state = createInitialState({ seed: 51, now: 1_000 });
  state = {
    ...state,
    unlocks: ["customer_success"],
    company: { ...state.company, customerCount: 1, mrrCents: 50_000 },
    records: {
      ...state.records,
      customers: {
        customer_1: {
          id: "customer_1",
          companyId: "company_1",
          primaryLeadId: "lead_1",
          monthlyValueCents: 50_000,
          health: 70,
          adoption: 65,
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
  state = applyCommand(state, {
    type: "hire_support_rep",
    name: "Jordan Bell",
    level: "mid",
  }).state;
  const created = applyCommand(state, {
    type: "create_ticket",
    customerId: "customer_1",
    channel: "chat",
    priority: "urgent",
    title: "Unable to publish reports",
  });

  assert(created.accepted);
  assertEquals(created.state.records.tickets.ticket_1.responseDueAt, 60);
  assertEquals(created.state.records.tickets.ticket_1.resolutionDueAt, 240);
  assertEquals(
    applyCommand(created.state, {
      type: "resolve_ticket",
      ticketId: "ticket_1",
    }).accepted,
    false,
  );

  state = applyCommand(created.state, {
    type: "assign_ticket",
    ticketId: "ticket_1",
    ownerId: "support_rep_1",
  }).state;
  state = applyCommand(state, {
    type: "acknowledge_ticket",
    ticketId: "ticket_1",
  }).state;
  const resolved = applyCommand(state, {
    type: "resolve_ticket",
    ticketId: "ticket_1",
  });

  assert(resolved.accepted);
  assertEquals(resolved.state.records.tickets.ticket_1.status, "resolved");
  assertEquals(
    resolved.state.records.tickets.ticket_1.ownerId,
    "support_rep_1",
  );
});

Deno.test("missed ticket SLAs fire once and damage account health", () => {
  const initial = createInitialState({ seed: 52, now: 1_000 });
  const state = {
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
          health: 70,
          adoption: 65,
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
  const created = applyCommand(state, {
    type: "create_ticket",
    customerId: "customer_1",
    channel: "phone",
    priority: "urgent",
    title: "Service unavailable",
  }).state;

  const responseMissed = advanceGame(created, 60);
  assertEquals(
    responseMissed.events.filter((event) =>
      event.kind === "ticket_sla_breached"
    ).length,
    1,
  );
  assertEquals(responseMissed.state.records.customers.customer_1.health, 62);
  const resolutionMissed = advanceGame(responseMissed.state, 180);
  assertEquals(
    resolutionMissed.events.filter((event) =>
      event.kind === "ticket_sla_breached"
    ).length,
    1,
  );
  assertEquals(resolutionMissed.state.records.customers.customer_1.health, 47);
  assertEquals(
    advanceGame(resolutionMissed.state, 60).events.filter((event) =>
      event.kind === "ticket_sla_breached"
    ).length,
    0,
  );
});

Deno.test("escalated incidents resolve with staffed service quality", () => {
  const initial = createInitialState({ seed: 53, now: 1_000 });
  let state: GameState = {
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
          health: 70,
          adoption: 65,
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
  state = applyCommand(state, {
    type: "hire_support_rep",
    name: "Alex Rivera",
    level: "senior",
  }).state;
  state = applyCommand(state, {
    type: "create_ticket",
    customerId: "customer_1",
    channel: "phone",
    priority: "high",
    title: "All users are locked out",
  }).state;
  state = applyCommand(state, {
    type: "assign_ticket",
    ticketId: "ticket_1",
    ownerId: "support_rep_1",
  }).state;
  state = applyCommand(state, {
    type: "escalate_ticket",
    ticketId: "ticket_1",
  }).state;
  state = applyCommand(state, {
    type: "declare_incident",
    ticketId: "ticket_1",
    severity: "critical",
  }).state;
  const incidentDamage = advanceGame(state, 24 * 60).state;
  assert(
    incidentDamage.records.customers.customer_1.health <
      state.records.customers.customer_1.health,
  );
  state = applyCommand(incidentDamage, {
    type: "acknowledge_ticket",
    ticketId: "ticket_1",
  }).state;
  state = applyCommand(state, {
    type: "resolve_ticket",
    ticketId: "ticket_1",
  }).state;
  const resolved = applyCommand(state, {
    type: "resolve_incident",
    incidentId: "incident_1",
  });

  assert(resolved.accepted);
  assertEquals(resolved.state.records.incidents.incident_1.status, "resolved");
  assert(
    (resolved.state.records.tickets.ticket_1.resolutionQuality ?? 0) > 50,
  );
});

Deno.test("pipeline unlock requires sustained MRR and open deal volume", () => {
  const initial = createInitialState({ seed: 41, now: 1_000 });
  const lead = initial.records.leads.lead_1;
  const prepared = {
    ...initial,
    company: { ...initial.company, mrrCents: 100_000 },
    records: {
      ...initial.records,
      leads: {
        ...initial.records.leads,
        [lead.id]: { ...lead, status: "contacted" as const },
      },
      deals: {
        deal_1: {
          id: "deal_1",
          leadId: lead.id,
          companyId: lead.companyId,
          stage: "discovery" as const,
          product: "growth" as const,
          monthlyValueCents: 40_000,
          probability: 45,
          expectedCloseAt: 5_000,
          createdAt: 0,
          updatedAt: 0,
        },
        deal_2: {
          id: "deal_2",
          leadId: lead.id,
          companyId: lead.companyId,
          stage: "evaluation" as const,
          product: "growth" as const,
          monthlyValueCents: 50_000,
          probability: 65,
          expectedCloseAt: 5_000,
          createdAt: 0,
          updatedAt: 0,
        },
      },
    },
    sequences: { ...initial.sequences, deal: 2 },
  };

  const result = applyCommand(prepared, {
    type: "qualify_lead",
    leadId: lead.id,
  });

  assertEquals(result.accepted, true);
  assertEquals(result.state.unlocks.includes("pipeline"), true);
  assertEquals(
    result.events.some((event) =>
      event.kind === "unlock_earned" &&
      event.summary === "Pipeline workspace unlocked"
    ),
    true,
  );
});

Deno.test("pipeline deals can be edited and closed with a loss reason", () => {
  let state = createInitialState({ seed: 43, now: 1_000 });
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
  const dealId = Object.keys(state.records.deals)[0];

  const updated = applyCommand(state, {
    type: "update_deal",
    dealId,
    product: "scale",
    monthlyValueCents: 225_000,
    expectedCloseInDays: 14,
  });
  assert(updated.accepted);
  assertEquals(updated.state.records.deals[dealId].product, "scale");
  assertEquals(updated.state.records.deals[dealId].monthlyValueCents, 225_000);

  const lost = applyCommand(updated.state, {
    type: "lose_deal",
    dealId,
    reason: "competition",
  });
  assert(lost.accepted);
  assertEquals(lost.state.records.deals[dealId].stage, "lost");
  assertEquals(lost.state.records.deals[dealId].probability, 0);
  assertEquals(lost.state.records.deals[dealId].lossReason, "competition");
});

Deno.test("sent quotes close negotiation deals with subscription terms", () => {
  let state = createInitialState({ seed: 46, now: 1_000 });
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
  for (let step = 0; step < 3; step += 1) {
    state = applyCommand(state, {
      type: "advance_deal",
      dealId: "deal_1",
    }).state;
  }

  const created = applyCommand(state, {
    type: "create_quote",
    dealId: "deal_1",
    product: "growth",
    billingCycle: "annual",
    seats: 20,
    discountPercent: 10,
    validDays: 14,
  });
  assert(created.accepted);
  assertEquals(created.state.records.quotes.quote_1.monthlyValueCents, 60_750);

  const sent = applyCommand(created.state, {
    type: "set_quote_status",
    quoteId: "quote_1",
    status: "sent",
  });
  const accepted = applyCommand(sent.state, {
    type: "accept_quote",
    quoteId: "quote_1",
  });

  assert(accepted.accepted);
  assertEquals(accepted.state.records.quotes.quote_1.status, "accepted");
  assertEquals(accepted.state.records.deals.deal_1.stage, "won");
  assertEquals(accepted.state.company.mrrCents, 60_750);
  assertEquals(accepted.state.history.dealsWon, 1);
});

Deno.test("sales representatives can be hired and assigned to deals", () => {
  let state = createInitialState({ seed: 44, now: 1_000 });
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

  const hired = applyCommand(state, {
    type: "hire_sales_rep",
    name: "  Avery   Chen  ",
    level: "senior",
    territory: "all",
    monthlyTargetCents: 2_000_000,
  });
  assert(hired.accepted);
  assertEquals(hired.state.records.salesReps.sales_rep_1.name, "Avery Chen");
  assertEquals(
    hired.state.records.salesReps.sales_rep_1.monthlySalaryCents,
    1_000_000,
  );

  const assigned = applyCommand(hired.state, {
    type: "assign_deal",
    dealId: "deal_1",
    ownerId: "sales_rep_1",
  });
  assert(assigned.accepted);
  assertEquals(assigned.state.records.deals.deal_1.ownerId, "sales_rep_1");

  const advanced = applyCommand(assigned.state, {
    type: "advance_deal",
    dealId: "deal_1",
  });
  assertEquals(advanced.state.records.deals.deal_1.probability, 51);
});

Deno.test("sales compensation accrues as a deterministic operating cost", () => {
  const initial = createInitialState({ seed: 45, now: 1_000 });
  const staffed = applyCommand(
    { ...initial, unlocks: ["pipeline"] },
    {
      type: "hire_sales_rep",
      name: "Avery Chen",
      level: "senior",
      territory: "all",
      monthlyTargetCents: 2_000_000,
    },
  ).state;

  const baseline = advanceGame(initial, 10).state;
  const withPayroll = advanceGame(staffed, 10).state;
  const expectedPayroll = Math.floor(
    10 * 1_000_000 / DEFAULT_RULES.billingIntervalMinutes,
  );

  assertEquals(
    baseline.company.cashCents - withPayroll.company.cashCents,
    expectedPayroll,
  );
});

Deno.test("overload builds burnout and training improves representative skill", () => {
  const initial = createInitialState({ seed: 47, now: 1_000 });
  let state = applyCommand(
    { ...initial, unlocks: ["pipeline"] },
    {
      type: "hire_sales_rep",
      name: "Avery Chen",
      level: "junior",
      territory: "all",
      monthlyTargetCents: 1_500_000,
    },
  ).state;
  const rep = state.records.salesReps.sales_rep_1;
  const deals = Object.fromEntries(
    Array.from({ length: rep.dealCapacity + 1 }, (_, index) => [
      `deal_${index + 1}`,
      {
        id: `deal_${index + 1}`,
        leadId: "lead_1",
        companyId: "company_1",
        stage: "qualified" as const,
        product: "starter" as const,
        ownerId: rep.id,
        monthlyValueCents: 25_000,
        probability: 25,
        expectedCloseAt: 10_000,
        createdAt: 0,
        updatedAt: 0,
      },
    ]),
  );
  state = { ...state, records: { ...state.records, deals } };
  state = advanceGame(state, 60).state;
  assertEquals(state.records.salesReps.sales_rep_1.burnout, 2);

  const trained = applyCommand(state, {
    type: "train_sales_rep",
    salesRepId: "sales_rep_1",
  });
  assert(trained.accepted);
  assertEquals(trained.state.records.salesReps.sales_rep_1.skill, 50);
  assertEquals(trained.state.records.salesReps.sales_rep_1.burnout, 0);
  assertEquals(
    trained.state.company.cashCents,
    state.company.cashCents - 100_000,
  );
});

Deno.test("lead routing respects territory and carries ownership into deals", () => {
  let state = createInitialState({ seed: 46, now: 1_000 });
  const territory = state.records.companies.company_1.region as
    | "North America"
    | "Europe"
    | "Asia Pacific";
  state = { ...state, unlocks: ["pipeline"] };
  state = applyCommand(state, {
    type: "hire_sales_rep",
    name: "Avery Chen",
    level: "mid",
    territory,
    monthlyTargetCents: 1_500_000,
  }).state;

  const routed = applyCommand(state, { type: "route_leads" });
  assert(routed.accepted);
  assertEquals(routed.state.records.leads.lead_1.ownerId, "sales_rep_1");

  state = applyCommand(routed.state, {
    type: "contact_lead",
    leadId: "lead_1",
    channel: "email",
  }).state;
  state = applyCommand(state, {
    type: "qualify_lead",
    leadId: "lead_1",
  }).state;
  assertEquals(state.records.deals.deal_1.ownerId, "sales_rep_1");
});

Deno.test("detailed sales activity compacts into bounded history", () => {
  let state = createInitialState({ seed: 47, now: 1_000 });
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
    territory: "all",
    monthlyTargetCents: 1_500_000,
  }).state;

  for (let index = 0; index < 110; index += 1) {
    state = applyCommand(state, {
      type: "assign_deal",
      dealId: "deal_1",
      ownerId: index % 2 === 0 ? "sales_rep_1" : undefined,
    }).state;
  }

  assertEquals(
    state.recentActivities.length,
    DEFAULT_RULES.maxRecentActivities,
  );
  assert(state.history.activitiesArchived > 0);
  assertEquals(validateGameState(state), { ok: true });
});

Deno.test("follow-up consumes capacity and refreshes lead engagement", () => {
  const initial = createInitialState({ seed: 6, now: 1_000 });
  const contacted = applyCommand(initial, {
    type: "contact_lead",
    leadId: "lead_1",
    channel: "email",
  });
  assert(contacted.accepted);
  const beforeLead = contacted.state.records.leads.lead_1;
  const followedUp = applyCommand(contacted.state, {
    type: "follow_up_lead",
    leadId: "lead_1",
  });

  assert(followedUp.accepted);
  assert(
    followedUp.state.company.founderCapacityRemaining <
      contacted.state.company.founderCapacityRemaining,
  );
  assert(
    followedUp.state.records.leads.lead_1.engagement > beforeLead.engagement,
  );
});

Deno.test("referrals require marketing unlock and are deterministic", () => {
  const initial = createInitialState({ seed: 61, now: 1_000 });
  const blocked = applyCommand(initial, { type: "request_referrals" });
  assertEquals(blocked.accepted, false);
  assertStrictEquals(blocked.state, initial);

  const unlocked = { ...initial, unlocks: ["marketing" as const] };
  const first = applyCommand(unlocked, { type: "request_referrals" });
  const second = applyCommand(unlocked, { type: "request_referrals" });

  assert(first.accepted);
  assertEquals(first, second);
  assertEquals(Object.keys(first.state.records.leads).length, 2);
  assertEquals(first.state.records.leads.lead_2.source, "referral");
  assertEquals(
    first.state.company.founderCapacityRemaining,
    initial.company.founderCapacityRemaining - 60,
  );
});

Deno.test("campaign commands enforce unlocks and lifecycle", () => {
  const initial = createInitialState({ seed: 64, now: 1_000 });
  const command = {
    type: "create_campaign" as const,
    name: "  Operations Leaders  ",
    channel: "email" as const,
    audience: "mid_market" as const,
    dailyBudgetCents: 5_000,
    durationDays: 7,
    message: "See how revenue teams keep every handoff moving.",
  };
  assertEquals(applyCommand(initial, command).accepted, false);

  const unlocked = { ...initial, unlocks: ["marketing" as const] };
  const created = applyCommand(unlocked, command);
  assert(created.accepted);
  assertEquals(
    created.state.records.campaigns.campaign_1.name,
    "Operations Leaders",
  );
  assertEquals(created.state.records.campaigns.campaign_1.status, "active");

  const paused = applyCommand(created.state, {
    type: "set_campaign_status",
    campaignId: "campaign_1",
    status: "paused",
  });
  assert(paused.accepted);
  assertEquals(paused.state.records.campaigns.campaign_1.status, "paused");
  assertStrictEquals(
    created.state.records.campaigns.campaign_1.status,
    "active",
  );
});

Deno.test("campaigns can be edited, duplicated, and archived safely", () => {
  const initial = createInitialState({ seed: 67, now: 1_000 });
  const created = applyCommand(
    { ...initial, unlocks: ["marketing" as const] },
    {
      type: "create_campaign",
      name: "Operations Leaders",
      channel: "email",
      audience: "mid_market",
      dailyBudgetCents: 5_000,
      durationDays: 7,
      message: "Keep every revenue handoff visible and accountable.",
    },
  );
  assert(created.accepted);

  const activeEdit = applyCommand(created.state, {
    type: "update_campaign",
    campaignId: "campaign_1",
    name: "Revenue Leaders",
    channel: "events",
    audience: "enterprise",
    dailyBudgetCents: 8_000,
    durationDays: 14,
    message: "Build a more reliable operating rhythm across revenue teams.",
  });
  assertEquals(activeEdit.accepted, false);
  assertStrictEquals(activeEdit.state, created.state);

  const paused = applyCommand(created.state, {
    type: "set_campaign_status",
    campaignId: "campaign_1",
    status: "paused",
  });
  const edited = applyCommand(paused.state, {
    type: "update_campaign",
    campaignId: "campaign_1",
    name: "Revenue Leaders",
    channel: "events",
    audience: "enterprise",
    dailyBudgetCents: 8_000,
    durationDays: 14,
    message: "Build a more reliable operating rhythm across revenue teams.",
  });
  assert(edited.accepted);
  assertEquals(
    edited.state.records.campaigns.campaign_1.name,
    "Revenue Leaders",
  );
  assertEquals(edited.state.records.campaigns.campaign_1.status, "paused");

  const duplicated = applyCommand(edited.state, {
    type: "duplicate_campaign",
    campaignId: "campaign_1",
  });
  assert(duplicated.accepted);
  assertEquals(duplicated.state.records.campaigns.campaign_2.status, "paused");
  assertEquals(
    duplicated.state.records.campaigns.campaign_2.totalSpentCents,
    0,
  );

  const archived = applyCommand(duplicated.state, {
    type: "archive_campaign",
    campaignId: "campaign_1",
  });
  assert(archived.accepted);
  assertEquals(archived.state.records.campaigns.campaign_1.status, "archived");
});

Deno.test("campaign simulation is deterministic and attributes spend and leads", () => {
  const initial = createInitialState({ seed: 65, now: 1_000 });
  const created = applyCommand(
    { ...initial, unlocks: ["marketing" as const] },
    {
      type: "create_campaign",
      name: "Revenue Operations",
      channel: "email",
      audience: "enterprise",
      dailyBudgetCents: 4_800,
      durationDays: 2,
      message: "Give every revenue handoff a clear owner and next step.",
    },
  );
  assert(created.accepted);

  const batched = advanceGame(created.state, 12 * 60).state;
  let segmented = created.state;
  for (let step = 0; step < 72; step += 1) {
    segmented = advanceGame(segmented, 10).state;
  }

  assertEquals(segmented, batched);
  assertEquals(batched.records.campaigns.campaign_1.totalSpentCents, 2_400);
  assertEquals(batched.records.campaigns.campaign_1.leadsGenerated, 2);
  assertEquals(
    Object.values(batched.records.leads).filter((lead) =>
      lead.campaignId === "campaign_1"
    ).length,
    2,
  );
});

Deno.test("campaign spend can trigger offline crisis pause", () => {
  const initial = createInitialState({ seed: 66, now: 1_000 });
  const created = applyCommand(
    {
      ...initial,
      unlocks: ["marketing" as const],
      company: {
        ...initial.company,
        cashCents: 100,
        baselineMonthlyExpensesCents: 0,
      },
    },
    {
      type: "create_campaign",
      name: "High Intent Accounts",
      channel: "paid_social",
      audience: "mid_market",
      dailyBudgetCents: 100_000,
      durationDays: 1,
      message: "Reach operations teams evaluating their next revenue system.",
    },
  );
  assert(created.accepted);

  const result = advanceOffline(created.state, 11_000);
  assertEquals(result.state.clock.status, "crisis");
  assertEquals(result.state.records.campaigns.campaign_1.totalSpentCents, 0);
});

Deno.test("campaign saturation rises with volume and reduces lead quality", () => {
  const initial = createInitialState({ seed: 68, now: 1_000 });
  const created = applyCommand(
    { ...initial, unlocks: ["marketing" as const] },
    {
      type: "create_campaign",
      name: "Scaled Demand",
      channel: "paid_social",
      audience: "mid_market",
      dailyBudgetCents: 5_000,
      durationDays: 7,
      message: "Reach operations teams looking for a clearer revenue process.",
    },
  );
  assert(created.accepted);
  const saturated = {
    ...created.state,
    records: {
      ...created.state.records,
      campaigns: {
        campaign_1: {
          ...created.state.records.campaigns.campaign_1,
          leadsGenerated: 30,
        },
      },
    },
  };

  const freshLead =
    advanceGame(created.state, 4 * 60).state.records.leads.lead_2;
  const saturatedLead =
    advanceGame(saturated, 4 * 60).state.records.leads.lead_2;
  assertEquals(campaignSaturation(30), 100);
  assertEquals(saturatedLead.fit, Math.max(0, freshLead.fit - 30));
});

Deno.test("old archived campaigns compact into bounded history", () => {
  let state = createInitialState({ seed: 69, now: 1_000 });
  state = { ...state, unlocks: ["marketing"] };
  for (let index = 1; index <= 41; index += 1) {
    const created = applyCommand(state, {
      type: "create_campaign",
      name: `Campaign ${index}`,
      channel: "paid_social",
      audience: "mid_market",
      dailyBudgetCents: 5_000,
      durationDays: 7,
      message: "Reach operations teams with a reliable revenue workflow.",
    });
    assert(created.accepted);
    state = index === 1
      ? advanceGame(created.state, 4 * 60).state
      : created.state;
    const paused = applyCommand(state, {
      type: "set_campaign_status",
      campaignId: `campaign_${index}`,
      status: "paused",
    });
    assert(paused.accepted);
    const archived = applyCommand(paused.state, {
      type: "archive_campaign",
      campaignId: `campaign_${index}`,
    });
    assert(archived.accepted);
    state = archived.state;
  }

  assertEquals(Object.keys(state.records.campaigns).length, 40);
  assertEquals(state.history.campaignsArchived, 1);
  assert(state.history.campaignSpendArchivedCents > 0);
  assertEquals(state.history.campaignLeadsArchived, 1);
  assertEquals(validateGameState(state), { ok: true });
});

Deno.test("company names are normalized and validated", () => {
  const initial = createInitialState({ seed: 62, now: 1_000 });
  const named = createInitialState({
    seed: 59,
    now: 1_000,
    companyName: "  Northstar   Revenue Labs  ",
  });
  const renamed = applyCommand(initial, {
    type: "rename_company",
    name: "  Northstar   Revenue Labs  ",
  });

  assertEquals(named.company.name, "Northstar Revenue Labs");
  assert(renamed.accepted);
  assertEquals(renamed.state.company.name, "Northstar Revenue Labs");
  assertStrictEquals(
    applyCommand(initial, { type: "rename_company", name: " " }).state,
    initial,
  );
  assertStrictEquals(
    applyCommand(initial, { type: "rename_company", name: "x".repeat(61) })
      .state,
    initial,
  );
  assertEquals(
    validateGameState({
      ...initial,
      company: { ...initial.company, name: "x".repeat(61) },
    }).ok,
    false,
  );
});

Deno.test("reduced motion preference updates immutably", () => {
  const initial = createInitialState({ seed: 63, now: 1_000 });
  const updated = applyCommand(initial, {
    type: "set_reduced_motion",
    enabled: true,
  });

  assert(updated.accepted);
  assertEquals(updated.state.preferences.reducedMotion, true);
  assertEquals(initial.preferences.reducedMotion, false);
});

Deno.test("sound preferences are independent and reject no-op updates", () => {
  const initial = createInitialState({ seed: 64, now: 1_000 });
  const pings = applyCommand(initial, {
    type: "set_sound_enabled",
    enabled: true,
  });
  const music = applyCommand(pings.state, {
    type: "set_music_enabled",
    enabled: true,
  });

  assert(pings.accepted);
  assert(music.accepted);
  assertEquals(music.state.preferences.soundEnabled, true);
  assertEquals(music.state.preferences.musicEnabled, true);
  assertEquals(initial.preferences.musicEnabled, false);
  assertStrictEquals(
    applyCommand(music.state, { type: "set_music_enabled", enabled: true })
      .state,
    music.state,
  );

  const quieter = applyCommand(music.state, {
    type: "set_music_volume",
    volume: 20,
  });
  assert(quieter.accepted);
  assertEquals(quieter.state.preferences.musicVolume, 20);
  assertStrictEquals(
    applyCommand(quieter.state, { type: "set_music_volume", volume: 101 })
      .state,
    quieter.state,
  );
});

Deno.test("new company command restarts a bankrupt run", () => {
  const initial = createInitialState({ seed: 7, now: 1_000 });
  const bankrupt = {
    ...initial,
    clock: {
      gameMinute: 120,
      status: "bankrupt" as const,
      bankruptAt: 120,
    },
  };
  const restarted = applyCommand(bankrupt, {
    type: "new_company",
    seed: 99,
    now: 2_000,
    companyName: "New Signal Software",
  });

  assert(restarted.accepted);
  assertEquals(restarted.state.seed, 99);
  assertEquals(restarted.state.clock.status, "active");
  assertEquals(restarted.state.company.name, "New Signal Software");
});

Deno.test("offline simulation pauses before bankruptcy", () => {
  const initial = createInitialState({ seed: 8, now: 1_000 });
  const endangered = {
    ...initial,
    company: { ...initial.company, cashCents: 1 },
  };
  const result = advanceOffline(endangered, 61_000);

  assertEquals(result.state.clock.status, "crisis");
  assertEquals(result.state.clock.gameMinute, 0);
  assertEquals(result.state.company.cashCents, 1);
  assertEquals(result.summary.stoppedForCrisis, true);
});

Deno.test("active simulation can declare bankruptcy", () => {
  const initial = createInitialState({ seed: 8, now: 1_000 });
  const endangered = {
    ...initial,
    company: { ...initial.company, cashCents: 1 },
  };
  const result = advanceGame(endangered, DEFAULT_RULES.simulationStepMinutes);

  assertEquals(result.state.clock.status, "bankrupt");
  assertEquals(result.summary.bankruptcyDeclared, true);
  assert(result.state.company.cashCents < 0);
});

Deno.test("offline elapsed time is capped at 24 hours", () => {
  const initial = createInitialState({ seed: 17, now: 1_000 });
  const wealthy = {
    ...initial,
    company: {
      ...initial.company,
      cashCents: 100_000_000,
      baselineMonthlyExpensesCents: 1,
    },
  };
  const result = advanceOffline(
    wealthy,
    initial.lastSimulatedAt + 7 * 24 * 60 * 60 * 1_000,
  );
  const expectedGameMinutes = Math.floor(
    DEFAULT_RULES.maxOfflineRealMilliseconds /
      DEFAULT_RULES.realMillisecondsPerGameMinute,
  );

  assertEquals(result.summary.elapsedGameMinutes, expectedGameMinutes);
  assertEquals(result.state.clock.gameMinute, expectedGameMinutes);
});
