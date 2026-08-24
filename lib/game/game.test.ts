import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
  assertStringIncludes,
} from "$std/assert/mod.ts";
import { applyCommand, closeLossRiskPercent } from "./actions.ts";
import { applyAutomations } from "./automation.ts";
import { generateLead } from "./catalog.ts";
import { campaignOutcomeSummary } from "./reports.ts";
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
import { createTicketWork } from "./work.ts";

function seedTicket(
  state: GameState,
  input: Parameters<typeof createTicketWork>[1],
): GameState {
  const result = createTicketWork(state, input, DEFAULT_RULES);
  assert(result.ok);
  return result.state;
}

Deno.test("initial state is deterministic and valid", () => {
  const first = createInitialState({ seed: 42, now: 1_000 });
  const second = createInitialState({ seed: 42, now: 1_000 });

  assertEquals(first, second);
  assertEquals(validateGameState(first), { ok: true });
  assertEquals(Object.keys(first.records.leads), ["lead_1"]);
  assertEquals(first.preferences.palette, "emerald");
});

Deno.test("color palette preference updates deterministically", () => {
  const state = createInitialState({ seed: 43, now: 1_000 });
  const changed = applyCommand(state, {
    type: "set_palette",
    palette: "sapphire",
  });

  assert(changed.accepted);
  assertEquals(changed.state.preferences.palette, "sapphire");
  assertEquals(
    applyCommand(changed.state, { type: "set_palette", palette: "sapphire" })
      .accepted,
    false,
  );
});

Deno.test("expanded gemstone palettes are accepted", () => {
  for (const palette of ["citrine", "amethyst", "obsidian"] as const) {
    const changed = applyCommand(createInitialState({ seed: 44, now: 1_000 }), {
      type: "set_palette",
      palette,
    });

    assert(changed.accepted);
    assertEquals(changed.state.preferences.palette, palette);
  }
});

Deno.test("random values depend only on seed and cursor", () => {
  assertEquals(randomAt(99, 7), randomAt(99, 7));
  assert(randomAt(99, 7) !== randomAt(99, 8));
});

Deno.test("generated company names use a broad, balanced catalog", () => {
  let cursor = 0;
  let juniperCount = 0;
  const prefixes = new Set<string>();
  const names = new Set<string>();
  for (let sequence = 1; sequence <= 2_400; sequence += 1) {
    const generated = generateLead(12_345, cursor, sequence, 0);
    cursor = generated.nextCursor;
    const prefix = generated.company.name.split(" ", 1)[0];
    prefixes.add(prefix);
    names.add(generated.company.name);
    if (prefix === "Juniper") juniperCount += 1;
  }

  assertEquals(prefixes.size, 24);
  assert(names.size >= 250);
  assert(juniperCount / 2_400 < 0.07);
});

Deno.test("generated contact names use a broad catalog", () => {
  let cursor = 0;
  const names = new Set<string>();
  for (let sequence = 1; sequence <= 2_400; sequence += 1) {
    const generated = generateLead(54_321, cursor, sequence, 0);
    cursor = generated.nextCursor;
    names.add(`${generated.lead.firstName} ${generated.lead.lastName}`);
  }

  assertEquals(names.size, 2_400);
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

Deno.test("founders can prospect deterministic leads using capacity", () => {
  const initial = createInitialState({ seed: 101, now: 1_000 });
  const first = applyCommand(initial, { type: "prospect_lead" });
  const replay = applyCommand(initial, { type: "prospect_lead" });

  assert(first.accepted);
  assertEquals(first, replay);
  assertEquals(Object.keys(first.state.records.leads).length, 2);
  assertEquals(Object.keys(first.state.records.tasks).length, 2);
  assertEquals(
    first.state.company.founderCapacityRemaining,
    initial.company.founderCapacityRemaining -
      DEFAULT_RULES.prospectingCapacityMinutes,
  );
  assertEquals(first.state.history.leadsCreated, 2);
});

Deno.test("open tasks can be cancelled", () => {
  const initial = createInitialState({ seed: 102, now: 1_000 });
  const cancelled = applyCommand(initial, {
    type: "cancel_task",
    taskId: "task_1",
  });

  assert(cancelled.accepted);
  assertEquals(cancelled.state.records.tasks.task_1.status, "cancelled");
  assertEquals(cancelled.events[0].kind, "task_cancelled");
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
  assertEquals(state.narrative.chapter, 1);
  assertEquals(state.narrative.pendingBriefing, true);
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

Deno.test("premature close risk scales with intent", () => {
  assertEquals(closeLossRiskPercent(70), 0);
  assertEquals(closeLossRiskPercent(100), 0);
  assertEquals(closeLossRiskPercent(35), 48);
  assertEquals(closeLossRiskPercent(0), 95);
});

Deno.test("low-intent close attempts can lose the client", () => {
  let state = createInitialState({ seed: 42, now: 1_000 });
  state = applyCommand(state, {
    type: "contact_lead",
    leadId: "lead_1",
    channel: "email",
  }).state;
  state = applyCommand(state, {
    type: "qualify_lead",
    leadId: "lead_1",
  }).state;
  state = {
    ...state,
    records: {
      ...state.records,
      leads: {
        ...state.records.leads,
        lead_1: { ...state.records.leads.lead_1, engagement: 0 },
      },
      deals: {
        ...state.records.deals,
        deal_1: { ...state.records.deals.deal_1, stage: "negotiation" },
      },
    },
  };

  const closed = applyCommand(state, {
    type: "advance_deal",
    dealId: "deal_1",
  });
  assert(closed.accepted);
  assertEquals(closed.state.records.deals.deal_1.stage, "lost");
  assertEquals(closed.state.records.leads.lead_1.status, "cold");
  assertStringIncludes(closed.events[0].summary, "walked away");
});

Deno.test("safe-intent closes do not consume a random roll", () => {
  let state = createInitialState({ seed: 42, now: 1_000 });
  state = applyCommand(state, {
    type: "contact_lead",
    leadId: "lead_1",
    channel: "email",
  }).state;
  state = applyCommand(state, {
    type: "qualify_lead",
    leadId: "lead_1",
  }).state;
  state = {
    ...state,
    records: {
      ...state.records,
      leads: {
        ...state.records.leads,
        lead_1: { ...state.records.leads.lead_1, engagement: 70 },
      },
      deals: {
        ...state.records.deals,
        deal_1: { ...state.records.deals.deal_1, stage: "negotiation" },
      },
    },
  };
  const cursor = state.rngCursor;

  const closed = applyCommand(state, {
    type: "advance_deal",
    dealId: "deal_1",
  });
  assertEquals(closed.state.records.deals.deal_1.stage, "won");
  assertEquals(closed.state.rngCursor, cursor);
});

Deno.test("negotiation approaches create distinct deterministic tradeoffs", () => {
  const negotiationState = () => {
    let state = createInitialState({ seed: 42, now: 1_000 });
    state = applyCommand(state, {
      type: "contact_lead",
      leadId: "lead_1",
      channel: "email",
    }).state;
    state = applyCommand(state, {
      type: "qualify_lead",
      leadId: "lead_1",
    }).state;
    return {
      ...state,
      records: {
        ...state.records,
        leads: {
          ...state.records.leads,
          lead_1: { ...state.records.leads.lead_1, engagement: 70 },
        },
        deals: {
          ...state.records.deals,
          deal_1: {
            ...state.records.deals.deal_1,
            stage: "negotiation" as const,
          },
        },
      },
    };
  };
  const originalValue = negotiationState().records.deals.deal_1
    .monthlyValueCents;
  const discount = applyCommand(negotiationState(), {
    type: "negotiate_deal",
    dealId: "deal_1",
    approach: "discount",
  });
  const proof = applyCommand(negotiationState(), {
    type: "negotiate_deal",
    dealId: "deal_1",
    approach: "value_proof",
  });
  const pilot = applyCommand(negotiationState(), {
    type: "negotiate_deal",
    dealId: "deal_1",
    approach: "pilot",
  });

  assert(discount.accepted && proof.accepted && pilot.accepted);
  assertEquals(
    discount.state.company.mrrCents,
    Math.round(originalValue * 0.85),
  );
  assertEquals(proof.state.company.mrrCents, Math.round(originalValue * 1.05));
  assertEquals(pilot.state.company.mrrCents, Math.round(originalValue * 0.95));
  assertEquals(discount.state.company.founderCapacityRemaining, 440);
  assertEquals(proof.state.company.founderCapacityRemaining, 380);
  assertEquals(pilot.state.company.founderCapacityRemaining, 410);
  assertEquals(proof.state.company.cashCents, 2_485_000);
  assertEquals(pilot.state.company.cashCents, 2_460_000);
  assertEquals(discount.state.records.customers.customer_1.health, 72);
  assertEquals(proof.state.records.customers.customer_1.health, 86);
  assertEquals(pilot.state.records.customers.customer_1.health, 92);
  assertEquals(discount.events[0].kind, "deal_negotiation_decided");
  assertStringIncludes(discount.events[0].summary, "18% stronger forecast");

  const wrongStage = applyCommand(createInitialState({ seed: 1, now: 0 }), {
    type: "negotiate_deal",
    dealId: "deal_1",
    approach: "discount",
  });
  assertEquals(wrongStage.accepted, false);
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
  state = {
    ...state,
    records: {
      ...state.records,
      leads: {
        ...state.records.leads,
        lead_1: { ...state.records.leads.lead_1, engagement: 100 },
      },
    },
  };
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
          accountPlan: "balanced" as const,
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
          accountPlan: "balanced" as const,
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

  const fired = applyCommand(played.state, {
    type: "fire_success_rep",
    successRepId: "success_rep_1",
  });
  assert(fired.accepted);
  assertEquals(fired.state.records.successReps, {});
  assertEquals(
    fired.state.records.customers.customer_1.ownerId,
    undefined,
  );
  const replacement = applyCommand(fired.state, {
    type: "hire_success_rep",
    name: "Jordan Bell",
    level: "mid",
  });
  const reassigned = applyCommand(replacement.state, {
    type: "assign_customer",
    customerId: "customer_1",
    ownerId: "success_rep_2",
  });
  assert(reassigned.accepted);
  assertEquals(
    reassigned.state.records.customers.customer_1.ownerId,
    "success_rep_2",
  );
});

Deno.test("customer account plans can be changed through commands", () => {
  const initial = createInitialState({ seed: 51, now: 1_000 });
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
          health: 50,
          adoption: 50,
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
  };

  const changed = applyCommand(state, {
    type: "set_customer_plan",
    customerId: "customer_1",
    accountPlan: "relationship",
  });
  assert(changed.accepted);
  assertEquals(
    changed.state.records.customers.customer_1.accountPlan,
    "relationship",
  );
  assertEquals(changed.events[0]?.kind, "customer_plan_set");

  const unchanged = applyCommand(changed.state, {
    type: "set_customer_plan",
    customerId: "customer_1",
    accountPlan: "relationship",
  });
  assertEquals(unchanged.accepted, false);

  const invalid = applyCommand(state, {
    type: "set_customer_plan",
    customerId: "customer_1",
    accountPlan: "unbounded" as never,
  });
  assertEquals(invalid.accepted, false);
});

Deno.test("account plans create deterministic success-work tradeoffs", () => {
  const initial = createInitialState({ seed: 52, now: 1_000 });
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
          health: 50,
          adoption: 50,
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
  };

  const balanced = applyCommand(state, {
    type: "customer_check_in",
    customerId: "customer_1",
  }).state;
  const adoption = applyCommand({
    ...state,
    records: {
      ...state.records,
      customers: {
        customer_1: {
          ...state.records.customers.customer_1,
          accountPlan: "adoption",
        },
      },
    },
  }, {
    type: "customer_check_in",
    customerId: "customer_1",
  }).state;
  const stabilization = applyCommand({
    ...state,
    records: {
      ...state.records,
      customers: {
        customer_1: {
          ...state.records.customers.customer_1,
          accountPlan: "stabilization",
        },
      },
    },
  }, {
    type: "customer_check_in",
    customerId: "customer_1",
  }).state;

  assertEquals(balanced.records.customers.customer_1.health, 62);
  assertEquals(balanced.records.customers.customer_1.adoption, 58);
  assertEquals(adoption.records.customers.customer_1.health, 60);
  assertEquals(adoption.records.customers.customer_1.adoption, 64);
  assertEquals(adoption.company.founderCapacityRemaining, 445);
  assertEquals(stabilization.records.customers.customer_1.health, 70);
  assertEquals(stabilization.records.customers.customer_1.adoption, 53);
  assertEquals(stabilization.company.founderCapacityRemaining, 440);
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
          accountPlan: "balanced" as const,
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

Deno.test("automation sequences and workflows replay deterministically", () => {
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
  const first = advanceGame(state, 24 * 60).state;
  const replay = advanceGame(state, 24 * 60).state;
  assertEquals(first, replay);
  assert(first.platform.sequences[0].enrolled >= 1);
  assertEquals(
    first.records.leads.lead_1.status === "new" ||
      first.records.leads.lead_1.status === "contacted",
    true,
  );
});

Deno.test("workflows support expanded rules and safe removal", () => {
  const initial = createInitialState({ seed: 57, now: 1_000 });
  const first = applyCommand(initial, {
    type: "create_workflow",
    name: "Escalate SLA failures",
    trigger: "ticket_sla_breached",
    condition: "overdue",
    action: "notify_team",
  });
  const second = applyCommand(first.state, {
    type: "create_workflow",
    name: "Launch recovery",
    trigger: "customer_at_risk",
    condition: "high_value",
    action: "launch_playbook",
  });
  const removed = applyCommand(second.state, {
    type: "delete_workflow",
    workflowId: "workflow_1",
  });

  assert(removed.accepted);
  assertEquals(removed.state.platform.workflows.length, 1);
  assertEquals(removed.state.platform.workflows[0].id, "workflow_2");
  const replacement = applyCommand(removed.state, {
    type: "create_workflow",
    name: "Update hot leads",
    trigger: "lead_qualified",
    condition: "high_intent",
    action: "update_record",
  });
  assertEquals(replacement.state.platform.workflows[1].id, "workflow_3");

  const missing = applyCommand(replacement.state, {
    type: "delete_workflow",
    workflowId: "workflow_missing",
  });
  assertEquals(missing.accepted, false);
  assertStrictEquals(missing.state, replacement.state);
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
  state = advanceGame(state, 10).state;
  assertEquals(state.platform.departments[0].headcount, 2);
  assertEquals(state.platform.endlessGoal, 2);
});

Deno.test("initiatives require three timed choices and remain bounded", () => {
  let state: GameState = {
    ...createInitialState({ seed: 560, now: 1_000 }),
    company: {
      ...createInitialState({ seed: 560, now: 1_000 }).company,
      cashCents: 20_000_000,
      mrrCents: 1_000_000,
    },
  };

  for (let project = 0; project < 5; project += 1) {
    const started = applyCommand(state, {
      type: "start_initiative",
      initiativeType: project % 2 === 0 ? "growth" : "efficiency",
    });
    assert(started.accepted);
    state = started.state;
    const active = state.platform.initiatives.find((initiative) =>
      initiative.status === "active"
    )!;
    const duplicate = applyCommand(state, {
      type: "start_initiative",
      initiativeType: "retention",
    });
    assertEquals(duplicate.accepted, false);
    assertStrictEquals(duplicate.state, state);

    for (let milestone = 0; milestone < 3; milestone += 1) {
      const elapsed = active.milestoneAt[milestone] - state.clock.gameMinute;
      state = advanceGame(state, elapsed).state;
      const prompted = state.platform.initiatives.find((initiative) =>
        initiative.id === active.id
      )!;
      assertEquals(prompted.status, "active");
      assertEquals(prompted.decisions.length, milestone);
      assertEquals(prompted.promptedMilestone, milestone + 1);
      const decided = applyCommand(state, {
        type: "decide_initiative_milestone",
        initiativeId: active.id,
        approach: milestone === 0 ? "accelerate" : "stabilize",
      });
      assert(decided.accepted);
      state = decided.state;
    }
    assertEquals(
      state.platform.initiatives.find((initiative) =>
        initiative.id === active.id
      )?.status,
      "completed",
    );
  }

  assertEquals(state.platform.initiativesCompleted, 5);
  assertEquals(state.platform.initiatives.length, 4);
  assertEquals(
    state.platform.initiatives.filter((initiative) =>
      initiative.status === "active"
    ).length,
    0,
  );
  assert(
    state.recentActivities.some((activity) =>
      activity.kind === "initiative_completed"
    ),
  );
});

Deno.test("initiative completion adds the deterministic quarter bonus", () => {
  const initial = createInitialState({ seed: 5601, now: 1_000 });
  const state: GameState = {
    ...initial,
    clock: { ...initial.clock, gameMinute: 30 * 24 * 60 - 10 },
    company: {
      ...initial.company,
      mrrCents: 1_000_000,
      customerCount: 1,
    },
    platform: {
      ...initial.platform,
      growthTargetCents: 500_000,
      efficiencyTargetPercent: 50,
      retentionTargetPercent: 90,
      quarterInitiativeCompleted: true,
    },
  };

  const advanced = advanceGame(state, 10);
  const quarterEvent = advanced.events.find((event) =>
    event.kind === "quarter_completed"
  );
  assertEquals(quarterEvent?.amountCents, 1_000_000);
  assertEquals(advanced.state.platform.quarterInitiativeCompleted, false);
});

Deno.test("quarters close automatically with target rewards", () => {
  const initial = createInitialState({ seed: 561, now: 1_000 });
  const state: GameState = {
    ...initial,
    clock: { ...initial.clock, gameMinute: 30 * 24 * 60 - 10 },
    company: {
      ...initial.company,
      mrrCents: 1_000_000,
      customerCount: 1,
    },
    platform: {
      ...initial.platform,
      growthTargetCents: 500_000,
      efficiencyTargetPercent: 50,
      retentionTargetPercent: 90,
    },
  };

  const advanced = advanceGame(state, 10);
  const quarterEvent = advanced.events.find((event) =>
    event.kind === "quarter_completed"
  );
  assert(quarterEvent);
  assertEquals(quarterEvent.amountCents, 750_000);
  assertEquals(advanced.state.platform.quarter, 2);
  assert(advanced.state.platform.growthTargetCents > 500_000);
  assertEquals(advanced.state.platform.endlessGoal, 2);
});

Deno.test("resilience reduces automatic quarter miss pressure", () => {
  let state: GameState = {
    ...createInitialState({ seed: 562, now: 1_000 }),
    clock: { gameMinute: 30 * 24 * 60 - 10, status: "active" },
    unlocks: ["pipeline"],
  };
  state = applyCommand(state, {
    type: "hire_sales_rep",
    name: "Avery Chen",
    level: "mid",
    territory: "all",
    monthlyTargetCents: 1_500_000,
  }).state;
  state = {
    ...state,
    platform: { ...state.platform, resilienceLevel: 2 },
  };

  const advanced = advanceGame(state, 10).state;
  assertEquals(advanced.records.salesReps.sales_rep_1.burnout, 6);
});

Deno.test("operations hires one manager per unlocked department", () => {
  const initial = createInitialState({ seed: 57, now: 1_000 });
  const state: GameState = {
    ...initial,
    unlocks: ["marketing", "pipeline", "customer_success"],
  };
  const hired = applyCommand(state, {
    type: "hire_manager",
    name: "Morgan Lee",
    department: "sales",
  });

  assert(hired.accepted);
  assertEquals(hired.state.platform.managers[0].department, "sales");
  assertEquals(hired.state.platform.managers[0].monthlySalaryCents, 1_200_000);
  const duplicate = applyCommand(hired.state, {
    type: "hire_manager",
    name: "Taylor Singh",
    department: "sales",
  });
  assertEquals(duplicate.accepted, false);

  const fired = applyCommand(hired.state, {
    type: "fire_manager",
    department: "sales",
  });
  assert(fired.accepted);
  assertEquals(fired.state.platform.managers, []);
});

Deno.test("sales managers hire for uncovered workload deterministically", () => {
  const initial: GameState = {
    ...createInitialState({ seed: 58, now: 1_000 }),
    unlocks: ["pipeline"],
  };
  const managed = applyCommand(initial, {
    type: "hire_manager",
    name: "Morgan Lee",
    department: "sales",
  }).state;

  const first = advanceGame(managed, 24 * 60).state;
  const replay = advanceGame(managed, 24 * 60).state;

  assertEquals(first, replay);
  assertEquals(Object.keys(first.records.salesReps).length, 1);
  assertStringIncludes(
    first.platform.managers[0].lastDecision ?? "",
    "hired",
  );
});

Deno.test("managers fire only after sustained excess capacity", () => {
  let state: GameState = {
    ...createInitialState({ seed: 59, now: 1_000 }),
    unlocks: ["customer_success"],
  };
  state = applyCommand(state, {
    type: "hire_manager",
    name: "Morgan Lee",
    department: "customer_success",
  }).state;
  for (const name of ["Avery Chen", "Taylor Singh"]) {
    state = applyCommand(state, {
      type: "hire_success_rep",
      name,
      level: "mid",
    }).state;
  }

  const afterTwoReviews = advanceGame(state, 2 * 24 * 60).state;
  assertEquals(Object.keys(afterTwoReviews.records.successReps).length, 2);
  const afterThreeReviews = advanceGame(afterTwoReviews, 24 * 60).state;
  assertEquals(Object.keys(afterThreeReviews.records.successReps).length, 1);
  assertStringIncludes(
    afterThreeReviews.platform.managers[0].lastDecision ?? "",
    "reduced Customer Success headcount",
  );
});

Deno.test("marketing managers staff active campaigns", () => {
  let state: GameState = {
    ...createInitialState({ seed: 60, now: 1_000 }),
    unlocks: ["marketing"],
  };
  state = applyCommand(state, {
    type: "create_campaign",
    name: "Demand test",
    channel: "email",
    audience: "mid_market",
    objective: "balanced",
    dailyBudgetCents: 10_000,
    durationDays: 7,
    message: "A focused campaign message for operations testing.",
  }).state;
  state = applyCommand(state, {
    type: "hire_manager",
    name: "Jordan Kim",
    department: "marketing",
  }).state;

  const worked = advanceGame(state, 24 * 60).state;
  const marketing = worked.platform.departments.find((department) =>
    department.id === "department_marketing"
  );
  assert(marketing);
  assertEquals(marketing.headcount, 1);
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
          accountPlan: "balanced" as const,
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
  const created = createTicketWork(state, {
    customerId: "customer_1",
    channel: "chat",
    priority: "urgent",
    title: "Unable to publish reports",
  }, DEFAULT_RULES);

  assert(created.ok);
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
  assertEquals(state.history.ticketsResolved, 0);
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
  assertEquals(resolved.state.history.ticketsResolved, 1);
  assertEquals(
    resolved.state.records.tickets.ticket_1.ownerId,
    "support_rep_1",
  );

  const fired = applyCommand(resolved.state, {
    type: "fire_support_rep",
    supportRepId: "support_rep_1",
  });
  assert(fired.accepted);
  assertEquals(fired.state.records.supportReps, {});
  assertEquals(fired.state.records.tickets.ticket_1.ownerId, undefined);
});

Deno.test("support resolution approaches trade speed, spend, health, and risk", () => {
  const acknowledgedTicketState = () => {
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
            accountPlan: "balanced" as const,
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
    state = seedTicket(state, {
      customerId: "customer_1",
      channel: "chat",
      priority: "high",
      title: "Unable to publish reports",
    });
    state = applyCommand(state, {
      type: "assign_ticket",
      ticketId: "ticket_1",
      ownerId: "support_rep_1",
    }).state;
    return applyCommand(state, {
      type: "acknowledge_ticket",
      ticketId: "ticket_1",
    }).state;
  };
  const fast = applyCommand(acknowledgedTicketState(), {
    type: "resolve_ticket_with_approach",
    ticketId: "ticket_1",
    approach: "fast_workaround",
  });
  const thorough = applyCommand(acknowledgedTicketState(), {
    type: "resolve_ticket_with_approach",
    ticketId: "ticket_1",
    approach: "thorough_fix",
  });
  const specialist = applyCommand(acknowledgedTicketState(), {
    type: "resolve_ticket_with_approach",
    ticketId: "ticket_1",
    approach: "specialist_escalation",
  });

  assert(fast.accepted && thorough.accepted && specialist.accepted);
  assertEquals(fast.state.records.tickets.ticket_1.resolutionQuality, 45);
  assertEquals(thorough.state.records.tickets.ticket_1.resolutionQuality, 85);
  assertEquals(
    specialist.state.records.tickets.ticket_1.resolutionQuality,
    87,
  );
  assertEquals(fast.state.records.customers.customer_1.health, 66);
  assertEquals(thorough.state.records.customers.customer_1.health, 78);
  assertEquals(specialist.state.records.customers.customer_1.health, 75);
  assertEquals(fast.state.company.founderCapacityRemaining, 465);
  assertEquals(thorough.state.company.founderCapacityRemaining, 390);
  assertEquals(specialist.state.company.cashCents, 2_465_000);
  assertEquals(
    Object.values(fast.state.records.tasks).some((task) =>
      task.relatedId === "ticket_1" && task.status === "open"
    ),
    true,
  );
  assertEquals(
    specialist.state.records.tickets.ticket_1.escalated,
    true,
  );
  assertEquals(fast.events[0].kind, "ticket_resolution_decided");

  const constrained = acknowledgedTicketState();
  const rejected = applyCommand({
    ...constrained,
    company: {
      ...constrained.company,
      cashCents: 0,
      founderCapacityRemaining: 10,
    },
  }, {
    type: "resolve_ticket_with_approach",
    ticketId: "ticket_1",
    approach: "thorough_fix",
  });
  assertEquals(rejected.accepted, false);
  assertStrictEquals(
    rejected.state.records.tickets.ticket_1.status,
    "acknowledged",
  );
});

Deno.test("customers open inbound support tickets over time", () => {
  const initial = createInitialState({ seed: 206, now: 1_000 });
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
          health: 55,
          adoption: 40,
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
  };

  assertEquals(Object.keys(state.records.tickets), []);
  const first = advanceGame(state, DEFAULT_RULES.simulationStepMinutes);
  const replay = advanceGame(state, DEFAULT_RULES.simulationStepMinutes);
  assertEquals(first.state, replay.state);
  const tickets = Object.values(first.state.records.tickets);
  assertEquals(tickets.length, 1);
  assertEquals(tickets[0].customerId, "customer_1");
  assertEquals(tickets[0].status, "open");
  assertEquals(tickets[0].escalated, false);
  assert(
    first.events.some((event) => event.kind === "ticket_created"),
  );

  const withOpen = advanceGame(first.state, 12 * 60).state;
  assertEquals(
    Object.values(withOpen.records.tickets).filter((ticket) =>
      ticket.status !== "resolved"
    ).length,
    1,
  );
});

Deno.test("staffed support processes generated inbound tickets", () => {
  const initial = createInitialState({ seed: 210, now: 1_000 });
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
          accountPlan: "balanced" as const,
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

  const worked = advanceGame(state, 24 * 60).state;
  assert(worked.sequences.ticket >= 2);
  assert(worked.history.ticketsResolved >= 1);
  assertEquals(worked.history.ticketsBreached, 0);
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
          accountPlan: "balanced" as const,
          startedAt: 0,
          nextBillingAt: 43_200,
          renewalAt: 43_200,
          lastSuccessAt: 0,
          expansions: 0,
        },
      },
    },
  };
  const created = seedTicket(state, {
    customerId: "customer_1",
    channel: "phone",
    priority: "urgent",
    title: "Service unavailable",
  });

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
          accountPlan: "balanced" as const,
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
  state = seedTicket(state, {
    customerId: "customer_1",
    channel: "phone",
    priority: "high",
    title: "All users are locked out",
  });
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

Deno.test("pipeline unlock follows the three-customer campaign milestone", () => {
  const initial = createInitialState({ seed: 41, now: 1_000 });
  const lead = initial.records.leads.lead_1;
  const prepared = {
    ...initial,
    company: {
      ...initial.company,
      customerCount: 3,
      mrrCents: 100_000,
    },
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

  const fired = applyCommand(assigned.state, {
    type: "fire_sales_rep",
    salesRepId: "sales_rep_1",
  });
  assert(fired.accepted);
  assertEquals(fired.state.records.salesReps, {});
  assertEquals(fired.state.records.deals.deal_1.ownerId, undefined);
  assertEquals(fired.state.records.leads.lead_1.ownerId, undefined);

  const replacement = applyCommand(fired.state, {
    type: "hire_sales_rep",
    name: "Jordan Bell",
    level: "mid",
    territory: "all",
    monthlyTargetCents: 1_500_000,
  });
  const reassigned = applyCommand(replacement.state, {
    type: "assign_deal",
    dealId: "deal_1",
    ownerId: "sales_rep_2",
  });
  assert(reassigned.accepted);
  assertEquals(reassigned.state.records.deals.deal_1.ownerId, "sales_rep_2");
  assertEquals(reassigned.state.records.leads.lead_1.ownerId, "sales_rep_2");
});

Deno.test("Founder-owned qualified leads can be assigned through their deal", () => {
  let state = createInitialState({ seed: 440, now: 1_000 });
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

  const assigned = applyCommand(state, {
    type: "assign_deal",
    dealId: "deal_1",
    ownerId: "sales_rep_1",
  });

  assert(assigned.accepted);
  assertEquals(assigned.state.records.deals.deal_1.ownerId, "sales_rep_1");
  assertEquals(assigned.state.records.leads.lead_1.ownerId, "sales_rep_1");
});

Deno.test("active leads can be reassigned after their owner is fired", () => {
  let state = createInitialState({ seed: 441, now: 1_000 });
  state = { ...state, unlocks: ["pipeline"] };
  state = applyCommand(state, {
    type: "hire_sales_rep",
    name: "Avery Chen",
    level: "mid",
    territory: "all",
    monthlyTargetCents: 1_500_000,
  }).state;
  state = applyCommand(state, {
    type: "assign_lead",
    leadId: "lead_1",
    ownerId: "sales_rep_1",
  }).state;
  state = applyCommand(state, {
    type: "fire_sales_rep",
    salesRepId: "sales_rep_1",
  }).state;
  state = applyCommand(state, {
    type: "hire_sales_rep",
    name: "Jordan Bell",
    level: "mid",
    territory: "all",
    monthlyTargetCents: 1_500_000,
  }).state;

  const reassigned = applyCommand(state, {
    type: "assign_lead",
    leadId: "lead_1",
    ownerId: "sales_rep_2",
  });

  assert(reassigned.accepted);
  assertEquals(reassigned.state.records.leads.lead_1.ownerId, "sales_rep_2");
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

Deno.test("customer routing balances unassigned accounts by capacity", () => {
  let state: GameState = {
    ...createInitialState({ seed: 461, now: 1_000 }),
    unlocks: ["customer_success"],
  };
  for (const name of ["Avery Chen", "Morgan Lee"]) {
    state = applyCommand(state, {
      type: "hire_success_rep",
      name,
      level: "junior",
    }).state;
  }
  const customers = Object.fromEntries(
    Array.from({ length: 5 }, (_, index) => {
      const id = `customer_${index + 1}`;
      return [id, {
        id,
        companyId: "company_1",
        primaryLeadId: "lead_1",
        monthlyValueCents: 25_000,
        health: 75,
        adoption: 65,
        lifecycle: "active" as const,
        accountPlan: "balanced" as const,
        startedAt: index,
        nextBillingAt: 43_200,
        renewalAt: 43_200,
        lastSuccessAt: 0,
        expansions: 0,
      }];
    }),
  );
  state = { ...state, records: { ...state.records, customers } };

  const routed = applyCommand(state, { type: "route_customers" });
  assert(routed.accepted);
  const loads = Object.values(routed.state.records.customers).reduce(
    (counts, customer) => {
      if (customer.ownerId) counts[customer.ownerId] += 1;
      return counts;
    },
    { sales_rep_1: 0, success_rep_1: 0, success_rep_2: 0 } as Record<
      string,
      number
    >,
  );
  assertEquals(loads.success_rep_1, 3);
  assertEquals(loads.success_rep_2, 2);
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
    objective: "balanced" as const,
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
      objective: "balanced",
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
    objective: "quality",
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
    objective: "quality",
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
      objective: "balanced",
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

Deno.test("campaign objectives deterministically trade volume quality and spend", () => {
  const initial = {
    ...createInitialState({ seed: 118, now: 1_000 }),
    unlocks: ["marketing" as const],
  };
  const run = (objective: "balanced" | "reach" | "quality" | "efficiency") => {
    const created = applyCommand(initial, {
      type: "create_campaign",
      name: `${objective} campaign`,
      channel: "email",
      audience: "mid_market",
      objective,
      dailyBudgetCents: 4_800,
      durationDays: 2,
      message: "Test a measurable acquisition hypothesis with clear outcomes.",
    });
    assert(created.accepted);
    return advanceGame(created.state, 18 * 60, "active", {
      ...DEFAULT_RULES,
      leadArrivalIntervalMinutes: 100_000,
    }).state;
  };

  const balanced = run("balanced");
  const reach = run("reach");
  const quality = run("quality");
  const efficiency = run("efficiency");
  assertEquals(balanced.records.campaigns.campaign_1.leadsGenerated, 3);
  assertEquals(reach.records.campaigns.campaign_1.leadsGenerated, 4);
  assertEquals(quality.records.campaigns.campaign_1.leadsGenerated, 2);
  assertEquals(efficiency.records.campaigns.campaign_1.leadsGenerated, 2);
  assertEquals(balanced.records.campaigns.campaign_1.totalSpentCents, 3_600);
  assertEquals(reach.records.campaigns.campaign_1.totalSpentCents, 3_960);
  assertEquals(quality.records.campaigns.campaign_1.totalSpentCents, 4_140);
  assertEquals(efficiency.records.campaigns.campaign_1.totalSpentCents, 2_520);

  const qualityLead = Object.values(quality.records.leads).find((lead) =>
    lead.campaignId === "campaign_1"
  )!;
  const rawQualityLead = generateLead(initial.seed, initial.rngCursor, 2, 540);
  assertEquals(
    qualityLead.fit,
    Math.min(100, rawQualityLead.lead.fit + 14),
  );
  assertEquals(
    qualityLead.engagement,
    Math.min(100, rawQualityLead.lead.engagement + 14),
  );
});

Deno.test("campaign outcome summaries derive funnel and efficiency results", () => {
  const initial = createInitialState({ seed: 119, now: 1_000 });
  const created = applyCommand(
    { ...initial, unlocks: ["marketing" as const] },
    {
      type: "create_campaign",
      name: "Outcome test",
      channel: "email",
      audience: "mid_market",
      objective: "balanced",
      dailyBudgetCents: 4_800,
      durationDays: 2,
      message: "Measure spend through pipeline and retained customer outcomes.",
    },
  );
  assert(created.accepted);
  const advanced = advanceGame(created.state, 12 * 60).state;
  const lead = Object.values(advanced.records.leads).find((entry) =>
    entry.campaignId === "campaign_1"
  )!;
  const state: GameState = {
    ...advanced,
    records: {
      ...advanced.records,
      deals: {
        deal_1: {
          id: "deal_1",
          leadId: lead.id,
          companyId: lead.companyId,
          stage: "won",
          product: "growth",
          monthlyValueCents: 50_000,
          probability: 100,
          expectedCloseAt: 720,
          createdAt: 360,
          updatedAt: 720,
        },
      },
      customers: {
        customer_1: {
          id: "customer_1",
          companyId: lead.companyId,
          primaryLeadId: lead.id,
          monthlyValueCents: 50_000,
          health: 80,
          adoption: 70,
          lifecycle: "active",
          accountPlan: "balanced",
          startedAt: 720,
          nextBillingAt: 43_920,
          renewalAt: 518_400,
          lastSuccessAt: 720,
          expansions: 0,
        },
      },
    },
  };

  assertEquals(
    campaignOutcomeSummary(state, state.records.campaigns.campaign_1),
    {
      spendCents: 2_400,
      leads: 2,
      deals: 1,
      customers: 1,
      openPipelineCents: 0,
      wonMrrCents: 50_000,
      costPerLeadCents: 1_200,
      customerAcquisitionCostCents: 2_400,
    },
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
      objective: "reach",
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
      objective: "balanced",
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

  const freshLead = Object.values(
    advanceGame(created.state, 4 * 60).state.records.leads,
  ).find((lead) => lead.campaignId === "campaign_1")!;
  const saturatedLead = Object.values(
    advanceGame(saturated, 4 * 60).state.records.leads,
  ).find((lead) => lead.campaignId === "campaign_1")!;
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
      objective: "balanced",
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

  const iterated = applyCommand(state, {
    type: "duplicate_campaign",
    campaignId: "campaign_41",
  });
  assert(iterated.accepted);
  assertEquals(Object.keys(iterated.state.records.campaigns).length, 40);
  assertEquals(iterated.state.history.campaignsArchived, 2);
  assertEquals(
    iterated.state.records.campaigns.campaign_42.objective,
    "balanced",
  );
  assertEquals(iterated.state.records.campaigns.campaign_42.totalSpentCents, 0);
  assertEquals(validateGameState(iterated.state), { ok: true });
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

Deno.test("crisis pause permits payroll-cutting corrections", () => {
  const initial = createInitialState({ seed: 104, now: 1_000 });
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
  const endangered = {
    ...staffed,
    company: { ...staffed.company, cashCents: 1 },
  };
  const crisis = advanceOffline(endangered, 61_000).state;
  const fired = applyCommand(crisis, {
    type: "fire_sales_rep",
    salesRepId: "sales_rep_1",
  });

  assert(fired.accepted);
  assertEquals(fired.state.clock.status, "crisis");
  assertEquals(fired.state.records.salesReps, {});
  assert(applyCommand(fired.state, { type: "resume_crisis" }).accepted);
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

Deno.test("inactive simulation is capped at one game week", () => {
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
  const expectedGameMinutes = DEFAULT_RULES.maxInactiveGameMinutes;

  assertEquals(result.summary.elapsedGameMinutes, expectedGameMinutes);
  assertEquals(result.state.clock.gameMinute, expectedGameMinutes);
});

Deno.test("simulation speed preference controls offline game time", () => {
  const initial = createInitialState({ seed: 103, now: 1_000 });
  const normal = {
    ...initial,
    preferences: { ...initial.preferences, timeScale: 1 as const },
  };
  const fast = {
    ...initial,
    preferences: { ...initial.preferences, timeScale: 4 as const },
  };
  const now = initial.lastSimulatedAt + 10_000;

  assertEquals(advanceOffline(normal, now).state.clock.gameMinute, 10);
  assertEquals(advanceOffline(fast, now).state.clock.gameMinute, 40);
});

Deno.test("automated sales outreach does not apply the spam penalty", () => {
  let state = createInitialState({ seed: 205, now: 1_000 });
  state = { ...state, unlocks: ["pipeline"] };
  state = applyCommand(state, {
    type: "hire_sales_rep",
    name: "Avery Chen",
    level: "senior",
    territory: "all",
    monthlyTargetCents: 1_500_000,
  }).state;
  state = applyCommand(state, {
    type: "create_workflow",
    name: "First touch",
    trigger: "lead_created",
    condition: "all",
    action: "send_outreach",
  }).state;
  state = applyCommand(state, {
    type: "create_workflow",
    name: "Second touch",
    trigger: "lead_created",
    condition: "all",
    action: "send_outreach",
  }).state;
  state = {
    ...state,
    records: {
      ...state.records,
      leads: {
        ...state.records.leads,
        lead_1: { ...state.records.leads.lead_1, ownerId: "sales_rep_1" },
      },
    },
  };

  const prospected = applyCommand(state, { type: "prospect_lead" });
  const created = Object.values(prospected.state.records.leads).find((lead) =>
    lead.id !== "lead_1"
  );
  assert(created);
  assertEquals(created.status, "contacted");
  assertEquals(
    prospected.events.some((event) =>
      event.summary.includes("intent fell sharply")
    ),
    false,
  );

  const before = state.records.leads.lead_1.engagement;
  const worked = advanceGame(state, 60).state;
  assertEquals(worked.records.leads.lead_1.status, "contacted");
  assert(worked.records.leads.lead_1.engagement > before);
  assertEquals(
    worked.recentActivities.some((activity) =>
      activity.summary.includes("intent fell sharply")
    ),
    false,
  );
});

Deno.test("sales representatives contact and qualify owned leads over time", () => {
  let state = createInitialState({ seed: 201, now: 1_000 });
  state = { ...state, unlocks: ["pipeline"] };
  state = applyCommand(state, {
    type: "hire_sales_rep",
    name: "Avery Chen",
    level: "senior",
    territory: "all",
    monthlyTargetCents: 1_500_000,
  }).state;
  state = {
    ...state,
    records: {
      ...state.records,
      leads: {
        ...state.records.leads,
        lead_1: { ...state.records.leads.lead_1, ownerId: "sales_rep_1" },
      },
    },
  };
  const capacity = state.company.founderCapacityRemaining;
  const worked = advanceGame(state, 60).state;

  assertEquals(worked.records.leads.lead_1.ownerId, "sales_rep_1");
  assertEquals(worked.records.leads.lead_1.status, "contacted");
  assertEquals(worked.company.founderCapacityRemaining, capacity);

  const later = advanceGame(worked, 8 * 60).state;
  assert(
    later.records.leads.lead_1.status === "contacted" ||
      later.records.leads.lead_1.status === "qualified",
  );
  if (later.records.leads.lead_1.status === "qualified") {
    const ownedDeal = Object.values(later.records.deals).find((deal) =>
      deal.leadId === "lead_1"
    );
    assert(ownedDeal);
    assertEquals(ownedDeal.ownerId, "sales_rep_1");
  }
});

Deno.test("sales representatives wait for intent above 70 before qualifying", () => {
  let state = createInitialState({ seed: 206, now: 1_000 });
  state = applyCommand(
    { ...state, unlocks: ["pipeline"] },
    {
      type: "hire_sales_rep",
      name: "Avery Chen",
      level: "mid",
      territory: "all",
      monthlyTargetCents: 1_500_000,
    },
  ).state;
  state = {
    ...state,
    clock: { ...state.clock, gameMinute: 4 * 60 },
    records: {
      ...state.records,
      leads: {
        ...state.records.leads,
        lead_1: {
          ...state.records.leads.lead_1,
          ownerId: "sales_rep_1",
          status: "contacted",
          engagement: 70,
          lastActivityAt: 0,
        },
      },
    },
  };

  const worked = advanceGame(state, 60).state;
  assertEquals(worked.records.leads.lead_1.status, "contacted");
  assert(worked.records.leads.lead_1.engagement > 70);

  const qualified = advanceGame(worked, 60).state;
  assertEquals(qualified.records.leads.lead_1.status, "qualified");
});

Deno.test("sales representatives recover blocked negotiations", () => {
  let state = createInitialState({ seed: 207, now: 1_000 });
  state = applyCommand(
    { ...state, unlocks: ["pipeline"] },
    {
      type: "hire_sales_rep",
      name: "Avery Chen",
      level: "senior",
      territory: "all",
      monthlyTargetCents: 1_500_000,
    },
  ).state;
  const firstLead = {
    ...state.records.leads.lead_1,
    status: "qualified" as const,
    ownerId: "sales_rep_1",
    engagement: 60,
    lastActivityAt: 0,
  };
  const secondLead = {
    ...firstLead,
    id: "lead_2",
    engagement: 80,
  };
  state = {
    ...state,
    sequences: { ...state.sequences, deal: 2 },
    records: {
      ...state.records,
      leads: { lead_1: firstLead, lead_2: secondLead },
      deals: {
        deal_1: {
          id: "deal_1",
          leadId: "lead_1",
          companyId: "company_1",
          stage: "negotiation",
          product: "growth",
          ownerId: "sales_rep_1",
          monthlyValueCents: 50_000,
          probability: 75,
          expectedCloseAt: 1_440,
          createdAt: 0,
          updatedAt: 0,
        },
        deal_2: {
          id: "deal_2",
          leadId: "lead_2",
          companyId: "company_1",
          stage: "qualified",
          product: "growth",
          ownerId: "sales_rep_1",
          monthlyValueCents: 50_000,
          probability: 25,
          expectedCloseAt: 1_440,
          createdAt: 1,
          updatedAt: 0,
        },
      },
    },
  };

  const worked = advanceGame(state, 8 * 60).state;
  assertEquals(worked.records.deals.deal_2.stage, "discovery");
  assertEquals(worked.records.leads.lead_1.status, "qualified");
  assert(worked.records.leads.lead_1.engagement > 60);

  const recovered = advanceGame(worked, 4 * 60).state;
  assertEquals(recovered.records.deals.deal_1.stage, "won");
});

Deno.test("unassigned accounts create gradual team pressure", () => {
  let state = createInitialState({ seed: 208, now: 1_000 });
  const customers = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => {
      const id = `customer_${index + 1}`;
      return [id, {
        id,
        companyId: "company_1",
        primaryLeadId: "lead_1",
        monthlyValueCents: 50_000,
        health: 70,
        adoption: 65,
        lifecycle: "active" as const,
        accountPlan: "balanced" as const,
        startedAt: 0,
        nextBillingAt: 43_200,
        renewalAt: 43_200,
        lastSuccessAt: 0,
        expansions: 0,
      }];
    }),
  );
  state = {
    ...state,
    unlocks: ["customer_success"],
    company: { ...state.company, customerCount: 20, mrrCents: 1_000_000 },
    records: { ...state.records, customers },
  };
  state = applyCommand(state, {
    type: "hire_success_rep",
    name: "Morgan Lee",
    level: "mid",
  }).state;

  const pressured = advanceGame(state, 24 * 60).state;
  assertEquals(pressured.records.successReps.success_rep_1.burnout, 4);
  assertEquals(
    Object.values(pressured.records.customers).filter((customer) =>
      !customer.ownerId
    ).length,
    8,
  );
});

Deno.test("success and support staff work owned records without founder capacity", () => {
  let state = createInitialState({ seed: 202, now: 1_000 });
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
          adoption: 30,
          lifecycle: "at_risk" as const,
          accountPlan: "balanced" as const,
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
    level: "mid",
  }).state;
  state = applyCommand(state, {
    type: "assign_customer",
    customerId: "customer_1",
    ownerId: "success_rep_1",
  }).state;
  state = applyCommand(state, {
    type: "hire_support_rep",
    name: "Jordan Bell",
    level: "mid",
  }).state;
  state = seedTicket(state, {
    customerId: "customer_1",
    channel: "email",
    priority: "normal",
    title: "Login loop on reports",
  });
  state = applyCommand(state, {
    type: "assign_ticket",
    ticketId: "ticket_1",
    ownerId: "support_rep_1",
  }).state;
  const capacity = state.company.founderCapacityRemaining;
  const afterHour = advanceGame(state, 60).state;

  assert(
    afterHour.records.customers.customer_1.health >
      state.records.customers.customer_1.health,
  );
  assertEquals(afterHour.records.tickets.ticket_1.status, "acknowledged");
  assertEquals(afterHour.company.founderCapacityRemaining, capacity);

  const afterShift = advanceGame(afterHour, 3 * 60).state;
  assertEquals(afterShift.records.tickets.ticket_1.status, "resolved");
  assertEquals(afterShift.company.founderCapacityRemaining, capacity);
});

Deno.test("support agents claim and acknowledge tickets in one action", () => {
  let state = createInitialState({ seed: 209, now: 1_000 });
  state = {
    ...state,
    clock: { ...state.clock, gameMinute: 10 },
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
          accountPlan: "balanced" as const,
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
  state = seedTicket(state, {
    customerId: "customer_1",
    channel: "chat",
    priority: "urgent",
    title: "Unable to publish reports",
  });

  const triaged = advanceGame(state, 50).state;
  assertEquals(triaged.records.tickets.ticket_1.status, "acknowledged");
  assertEquals(
    triaged.records.tickets.ticket_1.ownerId,
    "support_rep_1",
  );
  assertEquals(triaged.history.ticketsBreached, 0);

  let queued = triaged;
  for (let index = 0; index < 4; index += 1) {
    queued = seedTicket(queued, {
      customerId: "customer_1",
      channel: "email",
      priority: "normal",
      title: `Queued support request ${index + 1}`,
    });
  }
  queued = { ...queued, clock: { ...queued.clock, gameMinute: 350 } };
  const pressured = advanceGame(queued, 10).state;
  assertEquals(pressured.records.supportReps.support_rep_1.burnout, 1);
});

Deno.test("workflows assign Sales leads and Customer Success accounts", () => {
  let state = createInitialState({ seed: 203, now: 1_000 });
  state = { ...state, unlocks: ["pipeline", "customer_success"] };
  state = applyCommand(state, {
    type: "hire_sales_rep",
    name: "Avery Chen",
    level: "mid",
    territory: "all",
    monthlyTargetCents: 1_500_000,
  }).state;
  state = applyCommand(state, {
    type: "hire_success_rep",
    name: "Morgan Lee",
    level: "mid",
  }).state;
  state = applyCommand(state, {
    type: "create_workflow",
    name: "Own inbound leads",
    trigger: "lead_created",
    condition: "unassigned",
    action: "assign_owner",
  }).state;
  state = applyCommand(state, {
    type: "create_workflow",
    name: "First touch",
    trigger: "lead_created",
    condition: "all",
    action: "send_outreach",
  }).state;
  state = applyCommand(state, {
    type: "create_workflow",
    name: "Own new accounts",
    trigger: "deal_won",
    condition: "unassigned",
    action: "assign_owner",
  }).state;

  const prospected = applyCommand(state, { type: "prospect_lead" });
  assert(prospected.accepted);
  const lead = Object.values(prospected.state.records.leads).find((entry) =>
    entry.id !== "lead_1"
  );
  assert(lead);
  assertEquals(lead.ownerId, "sales_rep_1");
  assertEquals(lead.status, "contacted");
  assert(prospected.state.platform.automationRunsArchived >= 2);

  const touched = applyCommand(prospected.state, {
    type: "create_workflow",
    name: "Promote ready leads",
    trigger: "lead_qualified",
    condition: "all",
    action: "create_task",
  }).state;
  const qualified = applyCommand(touched, {
    type: "qualify_lead",
    leadId: lead.id,
  });
  assert(qualified.accepted);
  assertEquals(qualified.state.records.leads[lead.id].status, "qualified");
  assert(
    Object.values(qualified.state.records.tasks).some((task) =>
      task.title.includes("Follow up") || task.relatedId === lead.id ||
      task.kind === "follow_up"
    ),
  );

  const deal = Object.values(qualified.state.records.deals).find((entry) =>
    entry.leadId === lead.id
  );
  assert(deal);
  const readyToClose = {
    ...qualified.state,
    records: {
      ...qualified.state.records,
      leads: {
        ...qualified.state.records.leads,
        [lead.id]: {
          ...qualified.state.records.leads[lead.id],
          engagement: 100,
        },
      },
      deals: {
        ...qualified.state.records.deals,
        [deal.id]: { ...deal, stage: "negotiation" as const },
      },
    },
  };
  const closed = applyCommand(readyToClose, {
    type: "advance_deal",
    dealId: deal.id,
  });
  assert(closed.accepted);
  const customer = Object.values(closed.state.records.customers).find(
    (entry) => entry.primaryLeadId === lead.id,
  );
  assert(customer);
  assertEquals(customer.ownerId, "success_rep_1");
});

Deno.test("qualification workflows require contacted leads over 70 intent", () => {
  let state = createInitialState({ seed: 204, now: 1_000 });
  state = applyCommand(state, {
    type: "create_workflow",
    name: "Promote engaged leads",
    trigger: "lead_contacted",
    condition: "high_intent",
    action: "qualify_lead",
  }).state;
  state = {
    ...state,
    records: {
      ...state.records,
      leads: {
        ...state.records.leads,
        lead_1: {
          ...state.records.leads.lead_1,
          status: "contacted",
          engagement: 70,
        },
      },
    },
  };
  const contactedEvent = {
    kind: "lead_contacted" as const,
    summary: "Lead contacted",
    relatedId: "lead_1",
    gameMinute: state.clock.gameMinute,
  };

  const atThreshold = applyAutomations(state, [contactedEvent], DEFAULT_RULES);
  assertEquals(atThreshold.state.records.leads.lead_1.status, "contacted");

  const overThreshold = applyAutomations(
    {
      ...state,
      records: {
        ...state.records,
        leads: {
          ...state.records.leads,
          lead_1: { ...state.records.leads.lead_1, engagement: 71 },
        },
      },
    },
    [contactedEvent],
    DEFAULT_RULES,
  );
  assertEquals(overThreshold.state.records.leads.lead_1.status, "qualified");
  assert(
    Object.values(overThreshold.state.records.deals).some((deal) =>
      deal.leadId === "lead_1"
    ),
  );
});
