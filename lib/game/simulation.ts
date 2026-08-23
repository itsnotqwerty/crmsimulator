import { generateLead, generateSupportIssue } from "./catalog.ts";
import { projectEvents } from "./events.ts";
import { DEFAULT_RULES, syncProgressionUnlocks } from "./state.ts";
import { advancePlatform } from "./platform.ts";
import { advanceSequences, applyAutomations } from "./automation.ts";
import { applyStaffWork } from "./staff.ts";
import { applyManagerDecisions } from "./managers.ts";
import { createTicketWork } from "./work.ts";
import { syncNarrative } from "./narrative.ts";
import type {
  AdvanceResult,
  AdvanceSummary,
  Customer,
  DomainEvent,
  GameRules,
  GameState,
} from "./types.ts";

export type AdvanceMode = "active" | "offline";

function accruedBetween(
  monthlyCents: number,
  startMinute: number,
  endMinute: number,
  billingIntervalMinutes: number,
): number {
  const endAccrued = Math.floor(
    endMinute * monthlyCents / billingIntervalMinutes,
  );
  const startAccrued = Math.floor(
    startMinute * monthlyCents / billingIntervalMinutes,
  );
  return endAccrued - startAccrued;
}

function crossedBoundary(
  startMinute: number,
  endMinute: number,
  intervalMinutes: number,
): boolean {
  return Math.floor(startMinute / intervalMinutes) <
    Math.floor(endMinute / intervalMinutes);
}

function campaignLeadInterval(channel: string): number {
  if (channel === "paid_social") return 4 * 60;
  if (channel === "email") return 6 * 60;
  return 12 * 60;
}

const TICKET_ARRIVAL_INTERVAL_MINUTES = 12 * 60;

function inboundTicketChance(customer: Customer): number {
  if (customer.lifecycle === "at_risk" || customer.health < 45) return 35;
  if (customer.lifecycle === "onboarding" || customer.health < 65) return 20;
  return 10;
}

function openUnresolvedTicketCount(
  state: GameState,
  customerId: string,
): number {
  return Object.values(state.records.tickets).filter((ticket) =>
    ticket.customerId === customerId && ticket.status !== "resolved"
  ).length;
}

function openInboundTickets(
  state: GameState,
  startMinute: number,
  endMinute: number,
  rules: GameRules,
): { state: GameState; events: DomainEvent[] } {
  if (!state.unlocks.includes("customer_success")) {
    return { state, events: [] };
  }
  const firstBoundary =
    Math.floor(startMinute / TICKET_ARRIVAL_INTERVAL_MINUTES) +
    1;
  const lastBoundary = Math.floor(endMinute / TICKET_ARRIVAL_INTERVAL_MINUTES);

  let current = state;
  const events: DomainEvent[] = [];
  if (current.sequences.ticket === 0) {
    const firstCustomer =
      Object.values(current.records.customers).sort((a, b) =>
        a.health - b.health || a.id.localeCompare(b.id)
      )[0];
    if (firstCustomer) {
      const issue = generateSupportIssue(
        current.seed,
        current.rngCursor,
        firstCustomer.health,
        firstCustomer.lifecycle,
      );
      const result = createTicketWork(current, {
        customerId: firstCustomer.id,
        channel: issue.channel,
        priority: issue.priority,
        title: issue.title,
        createdAt: endMinute,
      }, rules);
      if (result.ok) {
        current = { ...result.state, rngCursor: issue.nextCursor };
        events.push(...result.events);
      }
    }
  }
  for (
    let boundary = firstBoundary;
    boundary <= lastBoundary;
    boundary += 1
  ) {
    const arrivalMinute = boundary * TICKET_ARRIVAL_INTERVAL_MINUTES;
    const eligible = Object.values(current.records.customers).filter((
      customer,
    ) => openUnresolvedTicketCount(current, customer.id) === 0).sort((a, b) =>
      a.health - b.health || a.id.localeCompare(b.id)
    );
    if (eligible.length === 0) continue;
    const openedIds = new Set<string>();
    for (const customer of eligible) {
      const chance = inboundTicketChance(customer);
      const roll = (current.seed + boundary * 17 +
        Number(customer.id.replaceAll(/\D/g, "") || 0)) % 100;
      if (roll >= chance) continue;
      const issue = generateSupportIssue(
        current.seed,
        current.rngCursor,
        customer.health,
        customer.lifecycle,
      );
      const result = createTicketWork(current, {
        customerId: customer.id,
        channel: issue.channel,
        priority: issue.priority,
        title: issue.title,
        createdAt: arrivalMinute,
      }, rules);
      if (!result.ok) break;
      current = { ...result.state, rngCursor: issue.nextCursor };
      events.push(...result.events);
      openedIds.add(customer.id);
    }
    const fallback = openedIds.size === 0
      ? eligible.find((customer) => !openedIds.has(customer.id))
      : undefined;
    if (!fallback) continue;
    const issue = generateSupportIssue(
      current.seed,
      current.rngCursor,
      fallback.health,
      fallback.lifecycle,
    );
    const result = createTicketWork(current, {
      customerId: fallback.id,
      channel: issue.channel,
      priority: issue.priority,
      title: issue.title,
      createdAt: arrivalMinute,
    }, rules);
    if (!result.ok) continue;
    current = { ...result.state, rngCursor: issue.nextCursor };
    events.push(...result.events);
  }
  return { state: current, events };
}

export function campaignSaturation(leadsGenerated: number): number {
  return Math.min(100, Math.floor(leadsGenerated / 3) * 10);
}

function emptySummary(): AdvanceSummary {
  return {
    elapsedGameMinutes: 0,
    leadsCreated: 0,
    revenueAccruedCents: 0,
    expensesAccruedCents: 0,
    tasksOverdue: 0,
    stoppedForCrisis: false,
    bankruptcyDeclared: false,
  };
}

function processStep(
  state: GameState,
  stepMinutes: number,
  mode: AdvanceMode,
  rules: GameRules,
): { state: GameState; events: DomainEvent[]; stopped: boolean } {
  const startMinute = state.clock.gameMinute;
  const endMinute = startMinute + stepMinutes;
  const revenueCents = accruedBetween(
    state.company.mrrCents,
    startMinute,
    endMinute,
    rules.billingIntervalMinutes,
  );
  const expenseCents = accruedBetween(
    state.company.baselineMonthlyExpensesCents,
    startMinute,
    endMinute,
    rules.billingIntervalMinutes,
  );
  const payrollCents = accruedBetween(
    Object.values(state.records.salesReps).reduce(
      (total, rep) => total + rep.monthlySalaryCents,
      0,
    ) + Object.values(state.records.successReps).reduce(
      (total, rep) => total + rep.monthlySalaryCents,
      0,
    ) + Object.values(state.records.supportReps).reduce(
      (total, rep) => total + rep.monthlySalaryCents,
      0,
    ) + state.platform.managers.reduce(
      (total, manager) => total + manager.monthlySalaryCents,
      0,
    ),
    startMinute,
    endMinute,
    rules.billingIntervalMinutes,
  );
  const campaigns = { ...state.records.campaigns };
  const campaignEvents: DomainEvent[] = [];
  let campaignSpendCents = 0;
  for (const campaign of Object.values(campaigns)) {
    if (campaign.status !== "active") continue;
    const campaignEnd = Math.min(endMinute, campaign.endsAt);
    if (campaignEnd <= startMinute) continue;
    const spend = accruedBetween(
      campaign.dailyBudgetCents,
      Math.max(startMinute, campaign.createdAt),
      campaignEnd,
      24 * 60,
    );
    campaignSpendCents += spend;
    campaigns[campaign.id] = {
      ...campaign,
      totalSpentCents: campaign.totalSpentCents + spend,
      status: campaignEnd >= campaign.endsAt ? "completed" : "active",
    };
    if (campaignEnd >= campaign.endsAt) {
      campaignEvents.push({
        kind: "campaign_completed",
        summary: `${campaign.name} campaign completed`,
        relatedId: campaign.id,
        gameMinute: campaign.endsAt,
      });
    }
  }
  const totalExpenseCents = expenseCents + payrollCents + campaignSpendCents;
  const nextCashCents = state.company.cashCents + revenueCents -
    totalExpenseCents;

  if (
    mode === "offline" &&
    nextCashCents < state.company.bankruptcyThresholdCents
  ) {
    const crisisEvent: DomainEvent = {
      kind: "crisis_entered",
      summary: "Offline progress paused before cash ran out",
      gameMinute: startMinute,
    };
    const crisisState = projectEvents(
      {
        ...state,
        clock: {
          gameMinute: startMinute,
          status: "crisis",
          crisisReason: "Projected operating costs exceed available cash",
        },
      },
      [crisisEvent],
      rules,
    );
    return { state: crisisState, events: [crisisEvent], stopped: true };
  }

  let nextState: GameState = {
    ...state,
    clock: { gameMinute: endMinute, status: "active" },
    company: {
      ...state.company,
      cashCents: nextCashCents,
      founderCapacityRemaining: crossedBoundary(
          startMinute,
          endMinute,
          rules.capacityResetIntervalMinutes,
        )
        ? state.company.founderCapacityMinutes
        : state.company.founderCapacityRemaining,
    },
    records: { ...state.records, campaigns },
  };
  const events: DomainEvent[] = [...campaignEvents];

  if (revenueCents > 0) {
    events.push({
      kind: "revenue_accrued",
      summary: `Accrued $${(revenueCents / 100).toFixed(2)} revenue`,
      gameMinute: endMinute,
      amountCents: revenueCents,
    });
  }
  if (totalExpenseCents > 0) {
    events.push({
      kind: "expense_accrued",
      summary: `Accrued $${(totalExpenseCents / 100).toFixed(2)} costs`,
      gameMinute: endMinute,
      amountCents: totalExpenseCents,
    });
  }

  const arrivalStart = Math.floor(
    startMinute / rules.leadArrivalIntervalMinutes,
  );
  const arrivalEnd = Math.floor(endMinute / rules.leadArrivalIntervalMinutes);
  for (let boundary = arrivalStart + 1; boundary <= arrivalEnd; boundary += 1) {
    const sequence = nextState.sequences.lead + 1;
    const arrivalMinute = boundary * rules.leadArrivalIntervalMinutes;
    const generated = generateLead(
      nextState.seed,
      nextState.rngCursor,
      sequence,
      arrivalMinute,
    );
    nextState = {
      ...nextState,
      rngCursor: generated.nextCursor,
      sequences: {
        ...nextState.sequences,
        company: sequence,
        lead: sequence,
      },
      records: {
        ...nextState.records,
        companies: {
          ...nextState.records.companies,
          [generated.company.id]: generated.company,
        },
        leads: {
          ...nextState.records.leads,
          [generated.lead.id]: generated.lead,
        },
      },
    };
    events.push({
      kind: "lead_created",
      summary: `New inbound lead from ${generated.company.name}`,
      relatedId: generated.lead.id,
      gameMinute: arrivalMinute,
    });
  }

  for (const campaign of Object.values(campaigns)) {
    if (campaign.status === "paused" || startMinute >= campaign.endsAt) {
      continue;
    }
    const interval = campaignLeadInterval(campaign.channel);
    const firstBoundary = Math.floor(startMinute / interval) + 1;
    const lastBoundary = Math.floor(
      Math.min(endMinute, campaign.endsAt) / interval,
    );
    for (
      let boundary = firstBoundary;
      boundary <= lastBoundary;
      boundary += 1
    ) {
      const sequence = Math.max(
        nextState.sequences.company,
        nextState.sequences.lead,
      ) + 1;
      const arrivalMinute = boundary * interval;
      if (arrivalMinute <= campaign.createdAt) continue;
      const generated = generateLead(
        nextState.seed,
        nextState.rngCursor,
        sequence,
        arrivalMinute,
      );
      const audienceAdjustment = campaign.audience === "small_business"
        ? -8
        : campaign.audience === "enterprise"
        ? 8
        : 0;
      const currentCampaign = nextState.records.campaigns[campaign.id];
      const saturationPenalty = Math.floor(
        campaignSaturation(currentCampaign.leadsGenerated) * 0.3,
      );
      nextState = {
        ...nextState,
        rngCursor: generated.nextCursor,
        sequences: {
          ...nextState.sequences,
          company: sequence,
          lead: sequence,
        },
        records: {
          ...nextState.records,
          companies: {
            ...nextState.records.companies,
            [generated.company.id]: generated.company,
          },
          leads: {
            ...nextState.records.leads,
            [generated.lead.id]: {
              ...generated.lead,
              source: "campaign",
              campaignId: campaign.id,
              fit: Math.max(
                0,
                Math.min(
                  100,
                  generated.lead.fit + audienceAdjustment - saturationPenalty,
                ),
              ),
            },
          },
          campaigns: {
            ...nextState.records.campaigns,
            [campaign.id]: {
              ...currentCampaign,
              leadsGenerated: currentCampaign.leadsGenerated + 1,
            },
          },
        },
      };
      events.push({
        kind: "lead_created",
        summary:
          `${campaign.name} generated a lead from ${generated.company.name}`,
        relatedId: generated.lead.id,
        gameMinute: arrivalMinute,
      });
    }
  }

  const leads = { ...nextState.records.leads };
  for (const lead of Object.values(leads)) {
    const coolAt = lead.lastActivityAt + rules.leadCoolingMinutes;
    if (
      (lead.status === "new" || lead.status === "contacted") &&
      startMinute < coolAt && coolAt <= endMinute
    ) {
      leads[lead.id] = {
        ...lead,
        status: "cold",
        engagement: Math.max(0, lead.engagement - 20),
      };
    }
  }

  for (const task of Object.values(nextState.records.tasks)) {
    if (
      task.status === "open" && startMinute < task.dueAt &&
      task.dueAt <= endMinute
    ) {
      events.push({
        kind: "task_overdue",
        summary: `${task.title} is overdue`,
        relatedId: task.id,
        gameMinute: task.dueAt,
      });
      const lead = leads[task.relatedId];
      if (task.kind === "follow_up" && lead && !lead.ownerId) {
        leads[lead.id] = {
          ...lead,
          engagement: Math.max(0, lead.engagement - 15),
        };
      }
    }
  }

  const elapsedHours = Math.floor(endMinute / 60) -
    Math.floor(startMinute / 60);
  const salesReps = { ...nextState.records.salesReps };
  const successReps = { ...nextState.records.successReps };
  const supportReps = { ...nextState.records.supportReps };
  const pressureIntervals = Math.floor(endMinute / (6 * 60)) -
    Math.floor(startMinute / (6 * 60));
  if (elapsedHours > 0) {
    const activeLeadCount = Object.values(leads).filter((lead) =>
      ["new", "contacted", "cold"].includes(lead.status)
    ).length;
    const openDealCount =
      Object.values(nextState.records.deals).filter((deal) =>
        deal.stage !== "won" && deal.stage !== "lost"
      ).length;
    const salesCapacity = Object.values(salesReps).reduce(
      (total, rep) =>
        total + rep.dealCapacity,
      0,
    );
    const salesBacklogged = activeLeadCount + openDealCount > salesCapacity;
    for (const rep of Object.values(salesReps)) {
      const leadLoad = Object.values(leads).filter((lead) =>
        lead.ownerId === rep.id &&
        ["new", "contacted", "cold"].includes(lead.status)
      ).length;
      const dealLoad = Object.values(nextState.records.deals).filter((deal) =>
        deal.ownerId === rep.id && deal.stage !== "won" && deal.stage !== "lost"
      ).length;
      const overloaded = leadLoad + dealLoad > rep.dealCapacity;
      const burnoutDelta = overloaded
        ? elapsedHours * 2
        : salesBacklogged
        ? pressureIntervals
        : -elapsedHours;
      salesReps[rep.id] = {
        ...rep,
        burnout: Math.max(
          0,
          Math.min(100, rep.burnout + burnoutDelta),
        ),
      };
    }
    const successCapacity = Object.values(successReps).reduce(
      (total, rep) => total + rep.accountCapacity,
      0,
    );
    const successBacklogged =
      Object.values(nextState.records.customers).length >
        successCapacity;
    for (const rep of Object.values(successReps)) {
      const accountLoad = Object.values(nextState.records.customers).filter(
        (customer) => customer.ownerId === rep.id,
      ).length;
      const overloaded = accountLoad > rep.accountCapacity;
      const burnoutDelta = overloaded
        ? elapsedHours * 2
        : successBacklogged
        ? pressureIntervals
        : -elapsedHours;
      successReps[rep.id] = {
        ...rep,
        burnout: Math.max(
          0,
          Math.min(100, rep.burnout + burnoutDelta),
        ),
      };
    }
  }

  const quotes = { ...nextState.records.quotes };
  for (const quote of Object.values(quotes)) {
    if (
      (quote.status === "draft" || quote.status === "sent") &&
      startMinute < quote.validUntil && quote.validUntil <= endMinute
    ) {
      quotes[quote.id] = {
        ...quote,
        status: "expired",
        updatedAt: quote.validUntil,
      };
      events.push({
        kind: "quote_expired",
        summary: "Quote validity period ended",
        relatedId: quote.id,
        gameMinute: quote.validUntil,
      });
    }
  }

  const inbound = openInboundTickets(
    nextState,
    startMinute,
    endMinute,
    rules,
  );
  nextState = inbound.state;
  events.push(...inbound.events);

  const tickets = { ...nextState.records.tickets };
  const customers = { ...nextState.records.customers };
  for (const ticket of Object.values(tickets)) {
    let updated = { ...ticket };
    let healthPenalty = 0;
    if (
      ticket.status === "open" && ticket.responseBreachedAt === undefined &&
      startMinute < ticket.responseDueAt && ticket.responseDueAt <= endMinute
    ) {
      updated = { ...updated, responseBreachedAt: ticket.responseDueAt };
      healthPenalty += ticket.priority === "urgent" ? 8 : 4;
      events.push({
        kind: "ticket_sla_breached",
        summary: `Response SLA breached: ${ticket.title}`,
        relatedId: ticket.id,
        gameMinute: ticket.responseDueAt,
      });
    }
    if (
      ticket.status !== "resolved" &&
      ticket.resolutionBreachedAt === undefined &&
      startMinute < ticket.resolutionDueAt &&
      ticket.resolutionDueAt <= endMinute
    ) {
      updated = { ...updated, resolutionBreachedAt: ticket.resolutionDueAt };
      healthPenalty += ticket.priority === "urgent" ? 15 : 8;
      events.push({
        kind: "ticket_sla_breached",
        summary: `Resolution SLA breached: ${ticket.title}`,
        relatedId: ticket.id,
        gameMinute: ticket.resolutionDueAt,
      });
    }
    tickets[ticket.id] = updated;
    const customer = customers[ticket.customerId];
    if (customer && healthPenalty > 0) {
      customers[customer.id] = {
        ...customer,
        health: Math.max(0, customer.health - healthPenalty),
      };
    }
  }
  const elapsedDays = Math.floor(endMinute / (24 * 60)) -
    Math.floor(startMinute / (24 * 60));
  if (elapsedDays > 0) {
    for (const incident of Object.values(nextState.records.incidents)) {
      if (incident.status === "resolved") continue;
      const customer = customers[incident.customerId];
      if (!customer) continue;
      const dailyPenalty = incident.severity === "critical"
        ? 8
        : incident.severity === "major"
        ? 4
        : 2;
      customers[customer.id] = {
        ...customer,
        health: Math.max(0, customer.health - dailyPenalty * elapsedDays),
      };
    }
  }

  let churnedMrrCents = 0;
  let customersLost = 0;
  for (const customer of Object.values(customers)) {
    const neglectAt = customer.lastSuccessAt +
      rules.customerNeglectGraceMinutes;
    const decayStart = Math.max(startMinute, neglectAt);
    const neglectedDays = endMinute > neglectAt
      ? Math.floor(endMinute / (24 * 60)) -
        Math.floor(decayStart / (24 * 60))
      : 0;
    const adoptionDays = customer.lifecycle === "active"
      ? Math.floor(endMinute / (24 * 60)) -
        Math.floor(startMinute / (24 * 60))
      : 0;
    let updated = {
      ...customer,
      health: Math.max(
        0,
        customer.health - neglectedDays *
            (customer.lifecycle === "onboarding" ? 4 : 2),
      ),
      adoption: Math.min(100, customer.adoption + adoptionDays),
    };
    if (updated.health < 45 && updated.lifecycle !== "at_risk") {
      updated = { ...updated, lifecycle: "at_risk" };
      events.push({
        kind: "customer_at_risk",
        summary: "Account health entered the at-risk range",
        relatedId: customer.id,
        gameMinute: endMinute,
      });
    }
    if (startMinute < updated.renewalAt && updated.renewalAt <= endMinute) {
      if (updated.health < 35) {
        delete customers[customer.id];
        churnedMrrCents += updated.monthlyValueCents;
        customersLost += 1;
        events.push({
          kind: "customer_churned",
          summary: "Customer churned at renewal",
          relatedId: customer.id,
          gameMinute: updated.renewalAt,
          amountCents: updated.monthlyValueCents,
        });
        continue;
      }
      updated = {
        ...updated,
        health: Math.max(0, updated.health - 5),
        renewalAt: updated.renewalAt + rules.customerRenewalIntervalMinutes,
      };
      events.push({
        kind: "customer_renewed",
        summary: "Subscription auto-renewed",
        relatedId: customer.id,
        gameMinute: customer.renewalAt,
        amountCents: customer.monthlyValueCents,
      });
    }
    customers[customer.id] = updated;
  }

  nextState = {
    ...nextState,
    company: {
      ...nextState.company,
      mrrCents: Math.max(0, nextState.company.mrrCents - churnedMrrCents),
      customerCount: Math.max(
        0,
        nextState.company.customerCount - customersLost,
      ),
    },
    records: {
      ...nextState.records,
      leads,
      quotes,
      salesReps,
      successReps,
      supportReps,
      customers,
      tickets,
    },
  };
  const automated = applyAutomations(nextState, events, rules);
  nextState = automated.state;
  events.push(...automated.events);
  const staffed = applyStaffWork(nextState, startMinute, endMinute, rules);
  nextState = staffed.state;
  events.push(...staffed.events);
  if (elapsedHours > 0) {
    const openSupportTickets = Object.values(nextState.records.tickets).filter(
      (ticket) => ticket.status !== "resolved",
    );
    const supportReps = { ...nextState.records.supportReps };
    const supportCapacity = Object.values(supportReps).reduce(
      (total, rep) => total + rep.ticketCapacity,
      0,
    );
    const unassignedSupportTickets = openSupportTickets.filter((ticket) =>
      !ticket.ownerId
    ).length;
    const supportBacklogged = openSupportTickets.length > supportCapacity ||
      unassignedSupportTickets >
        Math.max(1, Object.keys(supportReps).length * 2);
    for (const rep of Object.values(supportReps)) {
      const ticketLoad = openSupportTickets.filter((ticket) =>
        ticket.ownerId === rep.id
      ).length;
      const burnoutDelta = ticketLoad > rep.ticketCapacity
        ? elapsedHours * 2
        : supportBacklogged
        ? pressureIntervals
        : -elapsedHours;
      supportReps[rep.id] = {
        ...rep,
        burnout: Math.max(0, Math.min(100, rep.burnout + burnoutDelta)),
      };
    }
    nextState = {
      ...nextState,
      records: { ...nextState.records, supportReps },
    };
  }
  const managed = applyManagerDecisions(nextState, rules);
  nextState = managed.state;
  events.push(...managed.events);
  const staffAutomated = applyAutomations(nextState, staffed.events, rules);
  nextState = staffAutomated.state;
  events.push(...staffAutomated.events);
  const sequenced = advanceSequences(nextState, startMinute, endMinute);
  nextState = sequenced.state;
  events.push(...sequenced.events);
  nextState = advancePlatform(nextState, startMinute, endMinute);

  if (nextCashCents < nextState.company.bankruptcyThresholdCents) {
    const bankruptcyEvent: DomainEvent = {
      kind: "bankruptcy_declared",
      summary: "The company ran out of cash",
      gameMinute: endMinute,
    };
    events.push(bankruptcyEvent);
    nextState = {
      ...nextState,
      clock: {
        gameMinute: endMinute,
        status: "bankrupt",
        bankruptAt: endMinute,
      },
    };
  }

  return {
    state: syncNarrative(projectEvents(nextState, events, rules)),
    events,
    stopped: nextState.clock.status !== "active",
  };
}

export function advanceGame(
  state: GameState,
  elapsedGameMinutes: number,
  mode: AdvanceMode = "active",
  rules: GameRules = DEFAULT_RULES,
): AdvanceResult {
  if (!Number.isInteger(elapsedGameMinutes) || elapsedGameMinutes < 0) {
    throw new RangeError("Elapsed game minutes must be a nonnegative integer");
  }

  const summary = emptySummary();
  const events: DomainEvent[] = [];
  let nextState = syncProgressionUnlocks(state, rules);
  let remainingMinutes = elapsedGameMinutes;

  while (remainingMinutes > 0 && nextState.clock.status === "active") {
    const stepMinutes = Math.min(rules.simulationStepMinutes, remainingMinutes);
    const result = processStep(nextState, stepMinutes, mode, rules);
    events.push(...result.events);

    if (result.state.clock.status === "crisis") {
      summary.stoppedForCrisis = true;
    } else {
      summary.elapsedGameMinutes += stepMinutes;
      for (const event of result.events) {
        if (event.kind === "lead_created") summary.leadsCreated += 1;
        if (event.kind === "task_overdue") summary.tasksOverdue += 1;
        if (event.kind === "revenue_accrued") {
          summary.revenueAccruedCents += event.amountCents ?? 0;
        }
        if (event.kind === "expense_accrued") {
          summary.expensesAccruedCents += event.amountCents ?? 0;
        }
        if (event.kind === "bankruptcy_declared") {
          summary.bankruptcyDeclared = true;
        }
      }
    }

    nextState = result.state;
    remainingMinutes -= stepMinutes;
    if (result.stopped) break;
  }

  return {
    state: syncProgressionUnlocks(nextState, rules),
    events,
    summary,
  };
}

export function advanceOffline(
  state: GameState,
  now: number,
  rules: GameRules = DEFAULT_RULES,
): AdvanceResult {
  const elapsedRealMilliseconds = Math.max(0, now - state.lastSimulatedAt);
  const acceptedRealMilliseconds = Math.min(
    elapsedRealMilliseconds,
    rules.maxOfflineRealMilliseconds,
  );
  const elapsedGameMinutes = Math.min(
    rules.maxInactiveGameMinutes,
    Math.floor(
      acceptedRealMilliseconds / rules.realMillisecondsPerGameMinute *
        state.preferences.timeScale,
    ),
  );
  const result = advanceGame(state, elapsedGameMinutes, "offline", rules);

  return {
    ...result,
    state: {
      ...result.state,
      lastSimulatedAt: Math.max(state.lastSimulatedAt, now),
    },
  };
}
