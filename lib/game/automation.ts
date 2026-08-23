import type {
  AutomationAction,
  AutomationCondition,
  AutomationTrigger,
  DomainEvent,
  GameRules,
  GameState,
  WorkflowAutomation,
} from "./types.ts";
import {
  acknowledgeTicketWork,
  advanceLeadStatusWork,
  assignCustomerWork,
  assignLeadWork,
  assignTicketWork,
  createRelatedTaskWork,
  customerCheckInWork,
  outreachLeadWork,
  pickSalesRep,
  pickSuccessRep,
  pickSupportRep,
  runSuccessPlaybookWork,
  type WorkResult,
} from "./work.ts";

const MAX_AUTOMATION_RUNS = 20;
const SEQUENCE_BATCH = 3;

const EVENT_TRIGGERS: Partial<Record<DomainEvent["kind"], AutomationTrigger>> =
  {
    lead_created: "lead_created",
    lead_contacted: "lead_contacted",
    lead_qualified: "lead_qualified",
    quote_sent: "quote_sent",
    deal_won: "deal_won",
    customer_at_risk: "customer_at_risk",
    ticket_created: "ticket_created",
    ticket_sla_breached: "ticket_sla_breached",
  };

function relatedLead(state: GameState, event: DomainEvent) {
  if (!event.relatedId) return undefined;
  const lead = state.records.leads[event.relatedId];
  if (lead) return lead;
  const deal = state.records.deals[event.relatedId];
  if (deal) return state.records.leads[deal.leadId];
  const quote = state.records.quotes[event.relatedId];
  if (quote) {
    const quotedDeal = state.records.deals[quote.dealId];
    return quotedDeal ? state.records.leads[quotedDeal.leadId] : undefined;
  }
  const customer = state.records.customers[event.relatedId];
  return customer ? state.records.leads[customer.primaryLeadId] : undefined;
}

function matchesCondition(
  state: GameState,
  condition: AutomationCondition,
  event: DomainEvent,
): boolean {
  if (condition === "all") return true;
  const relatedId = event.relatedId;
  if (!relatedId) return false;
  const lead = relatedLead(state, event);
  const deal = state.records.deals[relatedId] ??
    (state.records.quotes[relatedId]
      ? state.records.deals[state.records.quotes[relatedId].dealId]
      : undefined);
  const customer = state.records.customers[relatedId] ??
    (state.records.tickets[relatedId]
      ? state.records.customers[state.records.tickets[relatedId].customerId]
      : undefined);
  const ticket = state.records.tickets[relatedId];
  const quote = state.records.quotes[relatedId];

  if (condition === "unassigned") {
    if (lead && ["new", "contacted", "cold"].includes(lead.status)) {
      return lead.ownerId === undefined;
    }
    if (deal && deal.stage !== "won" && deal.stage !== "lost") {
      return deal.ownerId === undefined;
    }
    if (customer) return customer.ownerId === undefined;
    if (ticket && ticket.status !== "resolved") {
      return ticket.ownerId === undefined;
    }
    return false;
  }
  if (condition === "high_intent") {
    return (lead?.engagement ?? 0) >= 70;
  }
  if (condition === "high_value") {
    return (lead?.fit ?? 0) >= 70 ||
      (deal?.monthlyValueCents ?? 0) >= 50_000 ||
      (customer?.monthlyValueCents ?? 0) >= 50_000 ||
      (quote?.monthlyValueCents ?? 0) >= 50_000;
  }
  if (condition === "overdue") {
    if (ticket && ticket.status !== "resolved") {
      return state.clock.gameMinute >= ticket.responseDueAt ||
        state.clock.gameMinute >= ticket.resolutionDueAt;
    }
    if (customer) {
      return state.clock.gameMinute - customer.lastSuccessAt >= 7 * 24 * 60;
    }
    return Object.values(state.records.tasks).some((task) =>
      task.relatedId === relatedId && task.status === "open" &&
      task.dueAt <= state.clock.gameMinute
    );
  }
  return false;
}

function applyWorkflowAction(
  state: GameState,
  workflow: WorkflowAutomation,
  event: DomainEvent,
): WorkResult {
  const relatedId = event.relatedId;
  if (!relatedId) return { ok: false, reason: "Workflow event has no record" };
  const lead = relatedLead(state, event);
  const deal = state.records.deals[relatedId] ??
    (state.records.quotes[relatedId]
      ? state.records.deals[state.records.quotes[relatedId].dealId]
      : undefined);
  const customer = state.records.customers[relatedId] ??
    (state.records.tickets[relatedId]
      ? state.records.customers[state.records.tickets[relatedId].customerId]
      : undefined);
  const ticket = state.records.tickets[relatedId];
  const action: AutomationAction = workflow.action;

  if (action === "notify_team") {
    return {
      ok: true,
      state,
      events: [{
        kind: "automation_ran",
        summary: `${workflow.name} notified the team`,
        relatedId,
        gameMinute: state.clock.gameMinute,
      }],
    };
  }
  if (action === "create_task") {
    const title = lead
      ? `Follow up with ${lead.firstName} ${lead.lastName}`
      : customer
      ? `Success follow-up for ${customer.id}`
      : ticket
      ? `Work ticket: ${ticket.title}`
      : `Follow up on ${relatedId}`;
    return createRelatedTaskWork(
      state,
      lead?.id ?? customer?.id ?? ticket?.id ?? relatedId,
      title,
      customer?.lifecycle === "onboarding" ? "onboarding" : "follow_up",
    );
  }
  if (action === "send_outreach") {
    if (lead) return outreachLeadWork(state, lead);
    if (customer) return customerCheckInWork(state, customer.id, false);
    return { ok: false, reason: "No record available for outreach" };
  }
  if (action === "update_record") {
    if (lead) return advanceLeadStatusWork(state, lead);
    if (ticket?.status === "open") {
      return acknowledgeTicketWork(state, ticket.id);
    }
    if (customer) {
      const playbook = customer.lifecycle === "at_risk"
        ? "recovery"
        : customer.lifecycle === "onboarding"
        ? "onboarding"
        : "adoption";
      return runSuccessPlaybookWork(state, customer.id, playbook, false);
    }
    return { ok: false, reason: "No record status to advance" };
  }
  if (action === "assign_owner") {
    if (lead && ["new", "contacted", "cold"].includes(lead.status)) {
      const owner = pickSalesRep(
        state,
        state.records.companies[lead.companyId]?.region,
      );
      if (!owner) return { ok: false, reason: "No sales owner available" };
      return assignLeadWork(state, lead.id, owner.id);
    }
    if (deal && deal.stage !== "won" && deal.stage !== "lost") {
      const owner = pickSalesRep(
        state,
        state.records.companies[deal.companyId]?.region,
      );
      if (!owner) return { ok: false, reason: "No sales owner available" };
      const leadResult = lead && !lead.ownerId
        ? assignLeadWork(state, lead.id, owner.id)
        : { ok: true as const, state, events: [] };
      if (!leadResult.ok) return leadResult;
      const nextDeal = {
        ...leadResult.state.records.deals[deal.id],
        ownerId: owner.id,
        updatedAt: state.clock.gameMinute,
      };
      return {
        ok: true,
        state: {
          ...leadResult.state,
          records: {
            ...leadResult.state.records,
            deals: {
              ...leadResult.state.records.deals,
              [deal.id]: nextDeal,
            },
          },
        },
        events: [
          ...leadResult.events,
          {
            kind: "deal_assigned",
            summary: `Deal assigned to ${owner.name}`,
            relatedId: deal.id,
            gameMinute: state.clock.gameMinute,
          },
        ],
      };
    }
    if (customer) {
      const owner = pickSuccessRep(state);
      if (!owner) return { ok: false, reason: "No success owner available" };
      return assignCustomerWork(state, customer.id, owner.id);
    }
    if (ticket && ticket.status !== "resolved") {
      const owner = pickSupportRep(state);
      if (!owner) return { ok: false, reason: "No support owner available" };
      return assignTicketWork(state, ticket.id, owner.id);
    }
    return { ok: false, reason: "No owner could be assigned" };
  }
  if (action === "launch_playbook") {
    if (!customer) return { ok: false, reason: "Playbooks require a customer" };
    const playbook = customer.lifecycle === "at_risk"
      ? "recovery"
      : customer.lifecycle === "onboarding"
      ? "onboarding"
      : "adoption";
    return runSuccessPlaybookWork(state, customer.id, playbook, false);
  }
  return { ok: false, reason: "Unsupported workflow action" };
}

function recordWorkflowRun(
  state: GameState,
  workflowId: string,
  failed: boolean,
): GameState {
  return {
    ...state,
    platform: {
      ...state.platform,
      workflows: state.platform.workflows.map((workflow) =>
        workflow.id === workflowId
          ? {
            ...workflow,
            runs: workflow.runs + 1,
            errors: workflow.errors + Number(failed),
            lastRunAt: state.clock.gameMinute,
          }
          : workflow
      ),
      automationRunsArchived: state.platform.automationRunsArchived + 1,
      automationErrorsArchived: state.platform.automationErrorsArchived +
        Number(failed),
    },
  };
}

export function applyAutomations(
  state: GameState,
  incoming: readonly DomainEvent[],
  _rules: GameRules,
): { state: GameState; events: DomainEvent[] } {
  if (incoming.length === 0 || state.platform.workflows.length === 0) {
    return { state, events: [] };
  }

  let current = state;
  const produced: DomainEvent[] = [];
  const queue = [...incoming];
  const seen = new Set<string>();
  let runs = 0;

  while (queue.length > 0 && runs < MAX_AUTOMATION_RUNS) {
    const event = queue.shift();
    if (!event) break;
    const trigger = EVENT_TRIGGERS[event.kind];
    if (!trigger) continue;
    for (const workflow of current.platform.workflows) {
      if (!workflow.enabled || workflow.trigger !== trigger) continue;
      if (!matchesCondition(current, workflow.condition, event)) continue;
      const key = `${workflow.id}:${event.relatedId ?? event.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (runs >= MAX_AUTOMATION_RUNS) break;
      runs += 1;
      const result = applyWorkflowAction(current, workflow, event);
      current = recordWorkflowRun(
        result.ok ? result.state : current,
        workflow.id,
        !result.ok,
      );
      if (result.ok && result.events.length > 0) {
        produced.push(...result.events);
        queue.push(...result.events);
      }
    }
  }

  return { state: current, events: produced };
}

export function advanceSequences(
  state: GameState,
  startMinute: number,
  endMinute: number,
): { state: GameState; events: DomainEvent[] } {
  if (Math.floor(startMinute / 1_440) === Math.floor(endMinute / 1_440)) {
    return { state, events: [] };
  }
  const enabled = state.platform.sequences.filter((sequence) =>
    sequence.enabled
  );
  if (enabled.length === 0) return { state, events: [] };

  let current = state;
  const events: DomainEvent[] = [];
  const sequences = current.platform.sequences.map((sequence) => {
    if (!sequence.enabled) return sequence;
    let enrolled = sequence.enrolled;
    let completed = sequence.completed;
    if (sequence.audience === "leads") {
      const leads = Object.values(current.records.leads).filter((lead) =>
        ["new", "contacted", "cold"].includes(lead.status) &&
        (lead.status === "new" ||
          endMinute - lead.lastActivityAt >= 4 * 60)
      ).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
        .slice(0, SEQUENCE_BATCH);
      for (const lead of leads) {
        const result = outreachLeadWork(
          current,
          current.records.leads[lead.id],
        );
        enrolled += 1;
        if (!result.ok) continue;
        current = result.state;
        events.push(...result.events);
        completed += 1;
      }
    } else {
      const customers = Object.values(current.records.customers).filter((
        customer,
      ) => endMinute - customer.lastSuccessAt >= 2 * 24 * 60).sort((a, b) =>
        a.lastSuccessAt - b.lastSuccessAt || a.id.localeCompare(b.id)
      ).slice(0, SEQUENCE_BATCH);
      for (const customer of customers) {
        const result = customerCheckInWork(current, customer.id, false);
        enrolled += 1;
        if (!result.ok) continue;
        current = result.state;
        events.push(...result.events);
        completed += 1;
      }
    }
    return { ...sequence, enrolled, completed };
  });

  return {
    state: {
      ...current,
      platform: { ...current.platform, sequences },
    },
    events,
  };
}
