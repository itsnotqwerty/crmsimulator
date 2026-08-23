import { randomInteger } from "./rng.ts";
import type {
  DealStage,
  DomainEvent,
  GameRules,
  GameState,
  Lead,
  SalesRep,
  SuccessRep,
  SupportRep,
  TaskKind,
  TicketChannel,
  TicketPriority,
} from "./types.ts";

export const TICKET_SLA_MINUTES: Record<
  TicketPriority,
  { response: number; resolution: number }
> = {
  urgent: { response: 60, resolution: 4 * 60 },
  high: { response: 4 * 60, resolution: 12 * 60 },
  normal: { response: 8 * 60, resolution: 24 * 60 },
  low: { response: 24 * 60, resolution: 3 * 24 * 60 },
};

export type WorkResult =
  | { ok: true; state: GameState; events: DomainEvent[] }
  | { ok: false; reason: string };

const ACTIVE_LEAD_STATUSES = new Set(["new", "contacted", "cold"]);

const fail = (reason: string): WorkResult => ({ ok: false, reason });
const ok = (state: GameState, events: DomainEvent[]): WorkResult => ({
  ok: true,
  state,
  events,
});

export function closeLossRiskPercent(intent: number): number {
  const boundedIntent = Math.max(0, Math.min(100, intent));
  if (boundedIntent >= 70) return 0;
  return Math.round((70 - boundedIntent) / 70 * 95);
}

export function nextDealStage(stage: DealStage): DealStage | undefined {
  const stages: DealStage[] = [
    "qualified",
    "discovery",
    "evaluation",
    "negotiation",
    "won",
  ];
  return stages[stages.indexOf(stage) + 1];
}

export function salesWorkload(state: GameState, repId: string): number {
  const leads =
    Object.values(state.records.leads).filter((lead) =>
      lead.ownerId === repId && ACTIVE_LEAD_STATUSES.has(lead.status)
    ).length;
  const deals =
    Object.values(state.records.deals).filter((deal) =>
      deal.ownerId === repId && deal.stage !== "won" && deal.stage !== "lost"
    ).length;
  return leads + deals;
}

export function successWorkload(state: GameState, repId: string): number {
  return Object.values(state.records.customers).filter((customer) =>
    customer.ownerId === repId
  ).length;
}

export function supportWorkload(state: GameState, repId: string): number {
  return Object.values(state.records.tickets).filter((ticket) =>
    ticket.ownerId === repId && ticket.status !== "resolved"
  ).length;
}

export function pickSalesRep(
  state: GameState,
  region?: string,
): SalesRep | undefined {
  return Object.values(state.records.salesReps).filter((rep) =>
    (rep.territory === "all" || rep.territory === region) &&
    salesWorkload(state, rep.id) < rep.dealCapacity
  ).sort((a, b) =>
    salesWorkload(state, a.id) - salesWorkload(state, b.id) ||
    a.hiredAt - b.hiredAt || a.id.localeCompare(b.id)
  )[0];
}

export function pickSuccessRep(state: GameState): SuccessRep | undefined {
  return Object.values(state.records.successReps).filter((rep) =>
    successWorkload(state, rep.id) < rep.accountCapacity
  ).sort((a, b) =>
    successWorkload(state, a.id) - successWorkload(state, b.id) ||
    a.hiredAt - b.hiredAt || a.id.localeCompare(b.id)
  )[0];
}

export function pickSupportRep(state: GameState): SupportRep | undefined {
  return Object.values(state.records.supportReps).filter((rep) =>
    supportWorkload(state, rep.id) < rep.ticketCapacity
  ).sort((a, b) =>
    supportWorkload(state, a.id) - supportWorkload(state, b.id) ||
    a.hiredAt - b.hiredAt || a.id.localeCompare(b.id)
  )[0];
}

export function contactLeadWork(
  state: GameState,
  leadId: string,
  channel: "call" | "email",
  options: { consumeFounderCapacity?: boolean; paced?: boolean } = {},
): WorkResult {
  const consumeFounderCapacity = options.consumeFounderCapacity ?? true;
  const paced = options.paced ?? false;
  const lead = state.records.leads[leadId];
  if (!lead) return fail("Lead does not exist");
  if (!ACTIVE_LEAD_STATUSES.has(lead.status)) {
    return fail("This lead can no longer be contacted");
  }
  const capacityCost = channel === "call" ? 20 : 10;
  if (
    consumeFounderCapacity &&
    state.company.founderCapacityRemaining < capacityCost
  ) {
    return fail("Not enough founder capacity");
  }

  const gameMinute = state.clock.gameMinute;
  const rapidRepeat = lead.status === "contacted" &&
    gameMinute - lead.lastActivityAt < 60;
  if (paced && rapidRepeat) {
    return ok(state, []);
  }
  const engagementChange = rapidRepeat
    ? { value: channel === "call" ? -30 : -20, cursor: state.rngCursor }
    : randomInteger(state.seed, state.rngCursor, 6, 16);
  const createTask = !paced;
  const taskSequence = createTask
    ? state.sequences.task + 1
    : state.sequences.task;
  const taskId = `task_${taskSequence}`;
  const nextLead = {
    ...lead,
    status: "contacted" as const,
    engagement: Math.max(
      0,
      Math.min(100, lead.engagement + engagementChange.value),
    ),
    lastActivityAt: gameMinute,
  };
  const events: DomainEvent[] = [{
    kind: "lead_contacted",
    summary: rapidRepeat
      ? `Over-contacted ${lead.firstName} ${lead.lastName}; intent fell sharply`
      : `${
        channel === "call" ? "Called" : "Emailed"
      } ${lead.firstName} ${lead.lastName}`,
    relatedId: lead.id,
    gameMinute,
  }];
  if (createTask) {
    events.push({
      kind: "task_created",
      summary: `Follow-up task created for ${lead.firstName} ${lead.lastName}`,
      relatedId: taskId,
      gameMinute,
    });
  }
  return ok({
    ...state,
    rngCursor: engagementChange.cursor,
    company: {
      ...state.company,
      founderCapacityRemaining: consumeFounderCapacity
        ? state.company.founderCapacityRemaining - capacityCost
        : state.company.founderCapacityRemaining,
    },
    sequences: { ...state.sequences, task: taskSequence },
    records: {
      ...state.records,
      leads: {
        ...state.records.leads,
        [lead.id]: nextLead,
      },
      tasks: createTask
        ? {
          ...state.records.tasks,
          [taskId]: {
            id: taskId,
            kind: "follow_up",
            status: "open",
            relatedId: lead.id,
            title: `Follow up with ${lead.firstName} ${lead.lastName}`,
            dueAt: gameMinute + 4 * 60,
            createdAt: gameMinute,
          },
        }
        : state.records.tasks,
    },
    onboarding: {
      ...state.onboarding,
      step: state.onboarding.step === "inspect_lead" ||
          state.onboarding.step === "contact_lead"
        ? "qualify_lead"
        : state.onboarding.step,
    },
  }, events);
}

export function followUpLeadWork(
  state: GameState,
  leadId: string,
  options: { consumeFounderCapacity?: boolean; paced?: boolean } = {},
): WorkResult {
  const consumeFounderCapacity = options.consumeFounderCapacity ?? true;
  const paced = options.paced ?? false;
  const lead = state.records.leads[leadId];
  if (!lead) return fail("Lead does not exist");
  if (lead.status !== "contacted" && lead.status !== "cold") {
    return fail("Only contacted or cold leads need follow-up");
  }
  const gameMinute = state.clock.gameMinute;
  if (paced && gameMinute - lead.lastActivityAt < 4 * 60) {
    return ok(state, []);
  }
  const capacityCost = 15;
  if (
    consumeFounderCapacity &&
    state.company.founderCapacityRemaining < capacityCost
  ) {
    return fail("Not enough founder capacity");
  }
  const engagementGain = randomInteger(state.seed, state.rngCursor, 8, 18);
  return ok({
    ...state,
    rngCursor: engagementGain.cursor,
    company: {
      ...state.company,
      founderCapacityRemaining: consumeFounderCapacity
        ? state.company.founderCapacityRemaining - capacityCost
        : state.company.founderCapacityRemaining,
    },
    records: {
      ...state.records,
      leads: {
        ...state.records.leads,
        [lead.id]: {
          ...lead,
          status: "contacted",
          engagement: Math.min(100, lead.engagement + engagementGain.value),
          lastActivityAt: gameMinute,
        },
      },
    },
  }, [{
    kind: "lead_contacted",
    summary: `Followed up with ${lead.firstName} ${lead.lastName}`,
    relatedId: lead.id,
    gameMinute,
  }]);
}

export function qualifyLeadWork(state: GameState, leadId: string): WorkResult {
  const lead = state.records.leads[leadId];
  if (!lead) return fail("Lead does not exist");
  if (lead.status !== "contacted") {
    return fail("Contact the lead before qualifying it");
  }
  const dealSequence = state.sequences.deal + 1;
  const dealId = `deal_${dealSequence}`;
  const gameMinute = state.clock.gameMinute;
  const monthlyValueCents = 15_000 + lead.fit * 500;
  const product = lead.fit >= 75
    ? "scale"
    : lead.fit >= 40
    ? "growth"
    : "starter";
  return ok({
    ...state,
    sequences: { ...state.sequences, deal: dealSequence },
    records: {
      ...state.records,
      leads: {
        ...state.records.leads,
        [lead.id]: { ...lead, status: "qualified", lastActivityAt: gameMinute },
      },
      deals: {
        ...state.records.deals,
        [dealId]: {
          id: dealId,
          leadId: lead.id,
          companyId: lead.companyId,
          stage: "qualified",
          product,
          ...(lead.ownerId ? { ownerId: lead.ownerId } : {}),
          monthlyValueCents,
          probability: 25,
          expectedCloseAt: gameMinute + 5 * 24 * 60,
          createdAt: gameMinute,
          updatedAt: gameMinute,
        },
      },
    },
    onboarding: { ...state.onboarding, step: "close_deal" },
  }, [{
    kind: "lead_qualified",
    summary: `${lead.firstName} ${lead.lastName} qualified`,
    relatedId: lead.id,
    gameMinute,
  }, {
    kind: "deal_created",
    summary: `New deal worth $${(monthlyValueCents / 100).toFixed(0)} MRR`,
    relatedId: dealId,
    gameMinute,
  }]);
}

export function assignLeadWork(
  state: GameState,
  leadId: string,
  ownerId: string,
): WorkResult {
  const lead = state.records.leads[leadId];
  if (!lead) return fail("Lead does not exist");
  if (!ACTIVE_LEAD_STATUSES.has(lead.status)) {
    return fail("Resolved leads cannot be reassigned");
  }
  const owner = state.records.salesReps[ownerId];
  if (!owner) return fail("Sales representative does not exist");
  if (lead.ownerId === ownerId) return fail("Lead owner is unchanged");
  return ok({
    ...state,
    records: {
      ...state.records,
      leads: {
        ...state.records.leads,
        [lead.id]: { ...lead, ownerId },
      },
    },
  }, [{
    kind: "leads_routed",
    summary: `${lead.firstName} ${lead.lastName} assigned to ${owner.name}`,
    relatedId: lead.id,
    gameMinute: state.clock.gameMinute,
  }]);
}

export function assignCustomerWork(
  state: GameState,
  customerId: string,
  ownerId: string,
): WorkResult {
  const customer = state.records.customers[customerId];
  if (!customer) return fail("Customer does not exist");
  const owner = state.records.successReps[ownerId];
  if (!owner) return fail("Success representative does not exist");
  if (customer.ownerId === ownerId) return fail("Account owner is unchanged");
  return ok({
    ...state,
    records: {
      ...state.records,
      customers: {
        ...state.records.customers,
        [customer.id]: { ...customer, ownerId },
      },
    },
  }, [{
    kind: "customer_assigned",
    summary: `Account assigned to ${owner.name}`,
    relatedId: customer.id,
    gameMinute: state.clock.gameMinute,
  }]);
}

export function createTicketWork(
  state: GameState,
  input: {
    customerId: string;
    channel: TicketChannel;
    priority: TicketPriority;
    title: string;
    createdAt?: number;
  },
  rules: GameRules,
): WorkResult {
  const customer = state.records.customers[input.customerId];
  if (!customer) return fail("Customer does not exist");
  const tickets = { ...state.records.tickets };
  const overflow = Object.keys(tickets).length - rules.maxTicketRecords + 1;
  const archived = Object.values(tickets).filter((ticket) =>
    ticket.status === "resolved"
  ).sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0)).slice(
    0,
    Math.max(0, overflow),
  );
  for (const ticket of archived) delete tickets[ticket.id];
  if (Object.keys(tickets).length >= rules.maxTicketRecords) {
    return fail("Resolve existing tickets before adding more");
  }
  const title = input.title.trim().replaceAll(/\s+/g, " ");
  if (title.length < 3 || title.length > 100) {
    return fail("Ticket title must contain 3 to 100 characters");
  }
  const sequence = state.sequences.ticket + 1;
  const id = `ticket_${sequence}`;
  const createdAt = input.createdAt ?? state.clock.gameMinute;
  const sla = TICKET_SLA_MINUTES[input.priority];
  return ok({
    ...state,
    history: {
      ...state.history,
      ticketsArchived: state.history.ticketsArchived + archived.length,
    },
    sequences: { ...state.sequences, ticket: sequence },
    records: {
      ...state.records,
      tickets: {
        ...tickets,
        [id]: {
          id,
          customerId: customer.id,
          channel: input.channel,
          priority: input.priority,
          status: "open",
          title,
          createdAt,
          responseDueAt: createdAt + sla.response,
          resolutionDueAt: createdAt + sla.resolution,
          escalated: false,
        },
      },
    },
  }, [{
    kind: "ticket_created",
    summary: `${input.priority} priority ticket opened: ${title}`,
    relatedId: id,
    gameMinute: createdAt,
  }]);
}

export function assignTicketWork(
  state: GameState,
  ticketId: string,
  ownerId: string,
): WorkResult {
  const ticket = state.records.tickets[ticketId];
  if (!ticket) return fail("Ticket does not exist");
  if (ticket.status === "resolved") {
    return fail("Resolved tickets cannot be reassigned");
  }
  const owner = state.records.supportReps[ownerId];
  if (!owner) return fail("Support representative does not exist");
  if (ticket.ownerId === ownerId) return fail("Owner is unchanged");
  return ok({
    ...state,
    records: {
      ...state.records,
      tickets: {
        ...state.records.tickets,
        [ticket.id]: { ...ticket, ownerId },
      },
    },
  }, [{
    kind: "ticket_assigned",
    summary: `Ticket assigned to ${owner.name}`,
    relatedId: ticket.id,
    gameMinute: state.clock.gameMinute,
  }]);
}

export function acknowledgeTicketWork(
  state: GameState,
  ticketId: string,
): WorkResult {
  const ticket = state.records.tickets[ticketId];
  if (!ticket) return fail("Ticket does not exist");
  if (ticket.status !== "open") {
    return fail("Only open tickets can be acknowledged");
  }
  return ok({
    ...state,
    records: {
      ...state.records,
      tickets: {
        ...state.records.tickets,
        [ticket.id]: {
          ...ticket,
          status: "acknowledged",
          acknowledgedAt: state.clock.gameMinute,
        },
      },
    },
  }, [{
    kind: "ticket_acknowledged",
    summary: `Support acknowledged: ${ticket.title}`,
    relatedId: ticket.id,
    gameMinute: state.clock.gameMinute,
  }]);
}

export function resolveTicketWork(
  state: GameState,
  ticketId: string,
): WorkResult {
  const ticket = state.records.tickets[ticketId];
  if (!ticket) return fail("Ticket does not exist");
  if (ticket.status !== "acknowledged") {
    return fail("Acknowledge the ticket before resolving it");
  }
  const owner = ticket.ownerId
    ? state.records.supportReps[ticket.ownerId]
    : undefined;
  const resolutionQuality = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (owner ? owner.skill - owner.burnout / 2 : 35) +
          (ticket.escalated ? 10 : 0) -
          (ticket.responseBreachedAt === undefined ? 0 : 15) -
          (ticket.resolutionBreachedAt === undefined ? 0 : 25),
      ),
    ),
  );
  const customer = state.records.customers[ticket.customerId];
  const healthChange = resolutionQuality >= 80
    ? 5
    : resolutionQuality >= 60
    ? 2
    : resolutionQuality < 40
    ? -10
    : -4;
  return ok({
    ...state,
    history: {
      ...state.history,
      ticketsResolved: state.history.ticketsResolved + 1,
      ticketResolutionMinutes: state.history.ticketResolutionMinutes +
        state.clock.gameMinute - ticket.createdAt,
    },
    records: {
      ...state.records,
      tickets: {
        ...state.records.tickets,
        [ticket.id]: {
          ...ticket,
          status: "resolved",
          resolvedAt: state.clock.gameMinute,
          resolutionQuality,
        },
      },
      customers: customer
        ? {
          ...state.records.customers,
          [customer.id]: {
            ...customer,
            health: Math.max(0, Math.min(100, customer.health + healthChange)),
          },
        }
        : state.records.customers,
    },
  }, [{
    kind: "ticket_resolved",
    summary:
      `Support resolved at ${resolutionQuality}% quality: ${ticket.title}`,
    relatedId: ticket.id,
    gameMinute: state.clock.gameMinute,
  }]);
}

export function customerCheckInWork(
  state: GameState,
  customerId: string,
  consumeFounderCapacity = true,
): WorkResult {
  const customer = state.records.customers[customerId];
  if (!customer) return fail("Customer does not exist");
  const capacityCost = 30;
  if (
    consumeFounderCapacity &&
    state.company.founderCapacityRemaining < capacityCost
  ) {
    return fail("Not enough founder capacity");
  }
  const gameMinute = state.clock.gameMinute;
  return ok({
    ...state,
    company: {
      ...state.company,
      founderCapacityRemaining: consumeFounderCapacity
        ? state.company.founderCapacityRemaining - capacityCost
        : state.company.founderCapacityRemaining,
    },
    records: {
      ...state.records,
      customers: {
        ...state.records.customers,
        [customer.id]: {
          ...customer,
          health: Math.min(100, customer.health + 12),
          adoption: Math.min(100, customer.adoption + 8),
          lifecycle: customer.lifecycle === "onboarding"
            ? "onboarding"
            : "active",
          lastSuccessAt: gameMinute,
        },
      },
    },
  }, [{
    kind: "customer_check_in",
    summary: "Success check-in improved account health",
    relatedId: customer.id,
    gameMinute,
  }]);
}

export function completeOnboardingWork(
  state: GameState,
  customerId: string,
): WorkResult {
  const customer = state.records.customers[customerId];
  if (!customer) return fail("Customer does not exist");
  if (customer.lifecycle !== "onboarding") {
    return fail("Customer onboarding is already complete");
  }
  const task = Object.values(state.records.tasks).find((entry) =>
    entry.kind === "onboarding" && entry.relatedId === customer.id &&
    entry.status === "open"
  );
  if (!task) return fail("Customer has no open onboarding task");
  const gameMinute = state.clock.gameMinute;
  return ok({
    ...state,
    records: {
      ...state.records,
      customers: {
        ...state.records.customers,
        [customer.id]: {
          ...customer,
          health: Math.min(100, customer.health + 15),
          adoption: Math.min(100, customer.adoption + 35),
          lifecycle: "active",
          lastSuccessAt: gameMinute,
        },
      },
      tasks: {
        ...state.records.tasks,
        [task.id]: {
          ...task,
          status: "completed",
          completedAt: gameMinute,
        },
      },
    },
  }, [{
    kind: "customer_onboarded",
    summary: "Customer onboarding completed",
    relatedId: customer.id,
    gameMinute,
  }, {
    kind: "task_completed",
    summary: task.title,
    relatedId: task.id,
    gameMinute,
  }]);
}

export function runSuccessPlaybookWork(
  state: GameState,
  customerId: string,
  playbook: "onboarding" | "adoption" | "recovery",
  consumeFounderCapacity = true,
): WorkResult {
  const customer = state.records.customers[customerId];
  if (!customer) return fail("Customer does not exist");
  const owner = customer.ownerId
    ? state.records.successReps[customer.ownerId]
    : undefined;
  const capacityCost = owner || !consumeFounderCapacity ? 0 : 35;
  if (state.company.founderCapacityRemaining < capacityCost) {
    return fail("Not enough founder capacity");
  }
  const base = {
    onboarding: { health: 10, adoption: 25 },
    adoption: { health: 5, adoption: 15 },
    recovery: { health: 20, adoption: 5 },
  }[playbook];
  const skillBonus = owner
    ? Math.floor((owner.skill - owner.burnout / 2) / 20)
    : 0;
  const health = Math.min(100, customer.health + base.health + skillBonus);
  const adoption = Math.min(
    100,
    customer.adoption + base.adoption + skillBonus,
  );
  const lifecycle = adoption >= 50 && health >= 45
    ? "active" as const
    : customer.lifecycle;
  return ok({
    ...state,
    company: {
      ...state.company,
      founderCapacityRemaining: state.company.founderCapacityRemaining -
        capacityCost,
    },
    records: {
      ...state.records,
      customers: {
        ...state.records.customers,
        [customer.id]: {
          ...customer,
          health,
          adoption,
          lifecycle,
          lastSuccessAt: state.clock.gameMinute,
        },
      },
    },
  }, [{
    kind: "success_playbook_run",
    summary: `${playbook[0].toUpperCase()}${
      playbook.slice(1)
    } playbook completed`,
    relatedId: customer.id,
    gameMinute: state.clock.gameMinute,
  }]);
}

export function createRelatedTaskWork(
  state: GameState,
  relatedId: string,
  title: string,
  kind: TaskKind = "follow_up",
): WorkResult {
  const openForRecord =
    Object.values(state.records.tasks).filter((task) =>
      task.relatedId === relatedId && task.status === "open"
    ).length;
  if (openForRecord >= 3) return fail("This record already has open tasks");
  const gameMinute = state.clock.gameMinute;
  const taskSequence = state.sequences.task + 1;
  const taskId = `task_${taskSequence}`;
  return ok({
    ...state,
    sequences: { ...state.sequences, task: taskSequence },
    records: {
      ...state.records,
      tasks: {
        ...state.records.tasks,
        [taskId]: {
          id: taskId,
          kind,
          status: "open",
          relatedId,
          title,
          dueAt: gameMinute + 4 * 60,
          createdAt: gameMinute,
        },
      },
    },
  }, [{
    kind: "task_created",
    summary: title,
    relatedId: taskId,
    gameMinute,
  }]);
}

export function outreachLeadWork(
  state: GameState,
  lead: Lead,
): WorkResult {
  const live = state.records.leads[lead.id] ?? lead;
  const paced = { consumeFounderCapacity: false, paced: true } as const;
  if (live.status === "new") {
    return contactLeadWork(state, live.id, "email", paced);
  }
  if (live.status === "contacted" || live.status === "cold") {
    return followUpLeadWork(state, live.id, paced);
  }
  return fail("Lead does not need outreach");
}

export function advanceLeadStatusWork(
  state: GameState,
  lead: Lead,
): WorkResult {
  if (lead.status === "new" || lead.status === "cold") {
    return outreachLeadWork(state, lead);
  }
  if (lead.status === "contacted" && lead.engagement >= 50) {
    return qualifyLeadWork(state, lead.id);
  }
  if (lead.status === "contacted") {
    return followUpLeadWork(state, lead.id, {
      consumeFounderCapacity: false,
      paced: true,
    });
  }
  return fail("Lead status cannot be advanced");
}

export function advanceDealWork(
  state: GameState,
  dealId: string,
  rules: GameRules,
): WorkResult {
  const deal = state.records.deals[dealId];
  if (!deal) return fail("Deal does not exist");
  if (deal.stage === "won" || deal.stage === "lost") {
    return fail("This deal is already closed");
  }
  const stage = nextDealStage(deal.stage);
  if (!stage) return fail("Deal cannot advance");
  const gameMinute = state.clock.gameMinute;
  const owner = deal.ownerId
    ? state.records.salesReps[deal.ownerId]
    : undefined;
  const ownerWorkload = owner
    ? Object.values(state.records.deals).filter((entry) =>
      entry.ownerId === owner.id && entry.stage !== "won" &&
      entry.stage !== "lost"
    ).length
    : 0;
  const skillAdjustment = owner ? Math.floor((owner.skill - 50) / 10) * 2 : 0;
  const burnoutPenalty = owner ? Math.floor(owner.burnout / 20) * 3 : 0;
  const overloadPenalty = owner
    ? Math.max(0, ownerWorkload - owner.dealCapacity) * 8
    : 0;
  const probability = Math.min(
    95,
    Math.max(
      5,
      deal.probability + 20 + skillAdjustment - overloadPenalty -
        burnoutPenalty,
    ),
  );

  if (stage !== "won") {
    return ok({
      ...state,
      records: {
        ...state.records,
        deals: {
          ...state.records.deals,
          [deal.id]: { ...deal, stage, probability, updatedAt: gameMinute },
        },
      },
    }, [{
      kind: "deal_advanced",
      summary: `Deal advanced to ${stage}`,
      relatedId: deal.id,
      gameMinute,
    }]);
  }

  const lead = state.records.leads[deal.leadId];
  const closeRisk = closeLossRiskPercent(lead.engagement);
  if (closeRisk > 0) {
    const roll = randomInteger(state.seed, state.rngCursor, 1, 100);
    if (roll.value <= closeRisk) {
      return ok({
        ...state,
        rngCursor: roll.cursor,
        records: {
          ...state.records,
          leads: {
            ...state.records.leads,
            [lead.id]: {
              ...lead,
              status: "cold",
              lastActivityAt: gameMinute,
            },
          },
          deals: {
            ...state.records.deals,
            [deal.id]: {
              ...deal,
              stage: "lost",
              probability: 0,
              lossReason: "no_decision",
              updatedAt: gameMinute,
            },
          },
        },
      }, [{
        kind: "deal_lost",
        summary:
          `Close pushed too early; ${lead.firstName} ${lead.lastName} walked away`,
        relatedId: deal.id,
        gameMinute,
      }]);
    }
    state = { ...state, rngCursor: roll.cursor };
  }

  const customerSequence = state.sequences.customer + 1;
  const customerId = `customer_${customerSequence}`;
  const taskSequence = state.sequences.task + 1;
  const taskId = `task_${taskSequence}`;
  const customerCount = state.company.customerCount + 1;
  const mrrCents = state.company.mrrCents + deal.monthlyValueCents;
  const unlockMarketing = customerCount >= rules.marketingUnlockCustomers &&
    !state.unlocks.includes("marketing");
  const unlockCustomerSuccess =
    customerCount >= rules.customerSuccessUnlockCustomers &&
    !state.unlocks.includes("customer_success");
  const events: DomainEvent[] = [{
    kind: "deal_won",
    summary: `Deal won for $${(deal.monthlyValueCents / 100).toFixed(0)} MRR`,
    relatedId: deal.id,
    gameMinute,
  }, {
    kind: "task_created",
    summary: "Customer onboarding task created",
    relatedId: taskId,
    gameMinute,
  }];
  if (unlockMarketing) {
    events.push({
      kind: "unlock_earned",
      summary: "Marketing workspace unlocked",
      gameMinute,
    });
  }
  if (unlockCustomerSuccess) {
    events.push({
      kind: "unlock_earned",
      summary: "Customer success workspace unlocked",
      gameMinute,
    });
  }

  return ok({
    ...state,
    company: {
      ...state.company,
      customerCount,
      mrrCents,
      peakMrrCents: Math.max(state.company.peakMrrCents, mrrCents),
    },
    sequences: {
      ...state.sequences,
      customer: customerSequence,
      task: taskSequence,
    },
    records: {
      ...state.records,
      leads: {
        ...state.records.leads,
        [lead.id]: { ...lead, status: "converted", lastActivityAt: gameMinute },
      },
      deals: {
        ...state.records.deals,
        [deal.id]: {
          ...deal,
          stage: "won",
          probability: 100,
          updatedAt: gameMinute,
        },
      },
      customers: {
        ...state.records.customers,
        [customerId]: {
          id: customerId,
          companyId: deal.companyId,
          primaryLeadId: deal.leadId,
          monthlyValueCents: deal.monthlyValueCents,
          health: 80,
          adoption: 25,
          lifecycle: "onboarding",
          startedAt: gameMinute,
          nextBillingAt: gameMinute + rules.billingIntervalMinutes,
          renewalAt: gameMinute + rules.customerRenewalIntervalMinutes,
          lastSuccessAt: gameMinute,
          expansions: 0,
        },
      },
      tasks: {
        ...state.records.tasks,
        [taskId]: {
          id: taskId,
          kind: "onboarding",
          status: "open",
          relatedId: customerId,
          title: "Complete customer onboarding",
          dueAt: gameMinute + 24 * 60,
          createdAt: gameMinute,
        },
      },
    },
    unlocks: [
      ...state.unlocks,
      ...(unlockMarketing ? ["marketing" as const] : []),
      ...(unlockCustomerSuccess ? ["customer_success" as const] : []),
    ],
    onboarding: { ...state.onboarding, step: "complete" },
  }, events);
}
