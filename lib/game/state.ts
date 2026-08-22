import { generateLead } from "./catalog.ts";
import {
  CONTENT_VERSION,
  type GameRules,
  type GameState,
  SAVE_SCHEMA_VERSION,
  type ValidationIssue,
  type ValidationResult,
} from "./types.ts";

export const DEFAULT_RULES: GameRules = {
  simulationStepMinutes: 10,
  realMillisecondsPerGameMinute: 1_000,
  maxOfflineRealMilliseconds: 24 * 60 * 60 * 1_000,
  leadArrivalIntervalMinutes: 8 * 60,
  leadCoolingMinutes: 3 * 24 * 60,
  capacityResetIntervalMinutes: 24 * 60,
  billingIntervalMinutes: 30 * 24 * 60,
  maxRecentActivities: 100,
  marketingUnlockCustomers: 3,
  pipelineUnlockMrrCents: 100_000,
  pipelineUnlockOpenDeals: 3,
  maxActiveCampaigns: 3,
  maxCampaignRecords: 40,
  maxSalesReps: 8,
  maxQuoteRecords: 60,
  customerSuccessUnlockCustomers: 5,
  customerRenewalIntervalMinutes: 30 * 24 * 60,
  customerNeglectGraceMinutes: 7 * 24 * 60,
  maxSuccessReps: 8,
  maxTicketRecords: 80,
  maxSupportReps: 12,
  maxIncidentRecords: 30,
};

export interface InitialStateOptions {
  seed: number;
  now: number;
  companyName?: string;
}

export function createInitialState(options: InitialStateOptions): GameState {
  const seed = options.seed >>> 0;
  const generated = generateLead(seed, 0, 1, 0);

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    contentVersion: CONTENT_VERSION,
    seed,
    rngCursor: generated.nextCursor,
    revision: 0,
    createdAt: options.now,
    savedAt: options.now,
    lastSimulatedAt: options.now,
    clock: { gameMinute: 0, status: "active" },
    company: {
      name: options.companyName?.trim().replaceAll(/\s+/g, " ") ||
        "Signal Ridge Software",
      cashCents: 2_500_000,
      mrrCents: 0,
      baselineMonthlyExpensesCents: 600_000,
      bankruptcyThresholdCents: 0,
      founderCapacityMinutes: 480,
      founderCapacityRemaining: 480,
      customerCount: 0,
      peakMrrCents: 0,
    },
    sequences: {
      company: 1,
      lead: 1,
      deal: 0,
      customer: 0,
      task: 1,
      activity: 1,
      campaign: 0,
      salesRep: 0,
      quote: 0,
      successRep: 0,
      ticket: 0,
      supportRep: 0,
      incident: 0,
    },
    records: {
      companies: { [generated.company.id]: generated.company },
      leads: { [generated.lead.id]: generated.lead },
      deals: {},
      customers: {},
      tasks: {
        task_1: {
          id: "task_1",
          kind: "call",
          status: "open",
          relatedId: generated.lead.id,
          title:
            `Review ${generated.lead.firstName} ${generated.lead.lastName}`,
          dueAt: 4 * 60,
          createdAt: 0,
        },
      },
      campaigns: {},
      salesReps: {},
      quotes: {},
      successReps: {},
      tickets: {},
      supportReps: {},
      incidents: {},
    },
    recentActivities: [{
      id: "activity_1",
      kind: "lead_created",
      summary: `New inbound lead from ${generated.company.name}`,
      relatedId: generated.lead.id,
      gameMinute: 0,
    }],
    history: {
      leadsCreated: 1,
      leadsQualified: 0,
      dealsWon: 0,
      dealsLost: 0,
      customersLost: 0,
      revenueAccruedCents: 0,
      expensesAccruedCents: 0,
      activitiesArchived: 0,
      campaignsArchived: 0,
      campaignSpendArchivedCents: 0,
      campaignLeadsArchived: 0,
      customersRenewed: 0,
      renewalMrrCents: 0,
      churnedMrrCents: 0,
      expansionMrrCents: 0,
      npsResponses: 0,
      npsScoreTotal: 0,
      ticketsResolved: 0,
      ticketsBreached: 0,
      ticketResolutionMinutes: 0,
      ticketsArchived: 0,
    },
    unlocks: [],
    onboarding: { step: "inspect_lead", dismissed: false },
    preferences: {
      reducedMotion: false,
      soundEnabled: false,
      musicEnabled: false,
      musicVolume: 35,
      pipelineView: "list",
    },
    platform: {
      sequences: [],
      workflows: [],
      integrations: [],
      customFields: [],
      savedViews: [],
      dashboardWidgets: ["cash", "mrr", "pipeline", "retention"],
      duplicateReviews: 0,
      duplicatesMerged: 0,
      automationRunsArchived: 0,
      automationErrorsArchived: 0,
      departments: [],
      approvalThresholdCents: 100_000,
      auditEntriesArchived: 0,
      quarter: 1,
      growthTargetCents: 500_000,
      efficiencyTargetPercent: 70,
      retentionTargetPercent: 90,
      resilienceLevel: 0,
      endlessGoal: 1,
    },
  };
}

function issue(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function isFiniteInteger(value: unknown, minimum = 0): value is number {
  return Number.isInteger(value) && Number.isFinite(value) &&
    Number(value) >= minimum;
}

export function validateGameState(state: GameState): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (state.schemaVersion !== SAVE_SCHEMA_VERSION) {
    issue(issues, "schemaVersion", "Unsupported save schema version");
  }
  if (state.contentVersion !== CONTENT_VERSION) {
    issue(issues, "contentVersion", "Unsupported content version");
  }
  if (!isFiniteInteger(state.seed) || state.seed > 0xffff_ffff) {
    issue(issues, "seed", "Seed must be an unsigned 32-bit integer");
  }
  if (!isFiniteInteger(state.rngCursor)) {
    issue(issues, "rngCursor", "Random cursor must be a nonnegative integer");
  }
  if (!isFiniteInteger(state.revision)) {
    issue(issues, "revision", "Revision must be a nonnegative integer");
  }
  if (!isFiniteInteger(state.clock.gameMinute)) {
    issue(
      issues,
      "clock.gameMinute",
      "Game minute must be a nonnegative integer",
    );
  }
  if (!Number.isFinite(state.company.cashCents)) {
    issue(issues, "company.cashCents", "Cash must be finite");
  }
  const companyName = state.company.name.trim();
  if (companyName.length < 2 || companyName.length > 60) {
    issue(
      issues,
      "company.name",
      "Company name must contain 2 to 60 characters",
    );
  }
  if (!isFiniteInteger(state.company.mrrCents)) {
    issue(issues, "company.mrrCents", "MRR must be a nonnegative integer");
  }
  if (
    !isFiniteInteger(state.company.founderCapacityRemaining) ||
    state.company.founderCapacityRemaining >
      state.company.founderCapacityMinutes
  ) {
    issue(
      issues,
      "company.founderCapacityRemaining",
      "Founder capacity is out of range",
    );
  }
  if (state.recentActivities.length > DEFAULT_RULES.maxRecentActivities) {
    issue(issues, "recentActivities", "Recent activity limit exceeded");
  }
  if (
    state.platform.sequences.length > 12 ||
    state.platform.workflows.length > 20 ||
    state.platform.integrations.length > 8 ||
    state.platform.departments.length > 8 ||
    state.platform.customFields.length > 20 ||
    state.platform.savedViews.length > 12
  ) {
    issue(issues, "platform", "Platform collection limit exceeded");
  }
  if (
    Object.keys(state.records.campaigns).length >
      DEFAULT_RULES.maxCampaignRecords
  ) {
    issue(issues, "records.campaigns", "Campaign record limit exceeded");
  }

  for (const lead of Object.values(state.records.leads)) {
    if (!state.records.companies[lead.companyId]) {
      issue(
        issues,
        `records.leads.${lead.id}.companyId`,
        "Lead company does not exist",
      );
    }
    if (
      lead.fit < 0 || lead.fit > 100 || lead.engagement < 0 ||
      lead.engagement > 100
    ) {
      issue(
        issues,
        `records.leads.${lead.id}`,
        "Lead scores must be between 0 and 100",
      );
    }
    if (lead.campaignId && !state.records.campaigns[lead.campaignId]) {
      issue(
        issues,
        `records.leads.${lead.id}.campaignId`,
        "Lead campaign does not exist",
      );
    }
    if (lead.ownerId && !state.records.salesReps[lead.ownerId]) {
      issue(
        issues,
        `records.leads.${lead.id}.ownerId`,
        "Lead owner does not exist",
      );
    }
  }
  for (const deal of Object.values(state.records.deals)) {
    if (
      !state.records.leads[deal.leadId] ||
      !state.records.companies[deal.companyId]
    ) {
      issue(
        issues,
        `records.deals.${deal.id}`,
        "Deal references missing records",
      );
    }
    if (deal.ownerId && !state.records.salesReps[deal.ownerId]) {
      issue(
        issues,
        `records.deals.${deal.id}.ownerId`,
        "Deal owner does not exist",
      );
    }
  }
  if (
    Object.keys(state.records.salesReps).length > DEFAULT_RULES.maxSalesReps
  ) {
    issue(issues, "records.salesReps", "Sales representative limit exceeded");
  }
  for (const rep of Object.values(state.records.salesReps)) {
    if (
      rep.name.trim().length < 2 || rep.name.length > 60 || rep.skill > 100 ||
      rep.dealCapacity < 1 || rep.burnout < 0 || rep.burnout > 100 ||
      rep.monthlySalaryCents < 1 ||
      rep.monthlyTargetCents < 1
    ) {
      issue(
        issues,
        `records.salesReps.${rep.id}`,
        "Invalid sales representative",
      );
    }
  }
  for (const customer of Object.values(state.records.customers)) {
    if (
      !state.records.companies[customer.companyId] ||
      !state.records.leads[customer.primaryLeadId]
    ) {
      issue(
        issues,
        `records.customers.${customer.id}`,
        "Customer references missing records",
      );
    }
    if (
      customer.health < 0 || customer.health > 100 || customer.adoption < 0 ||
      customer.adoption > 100 || customer.renewalAt < customer.startedAt ||
      customer.lastSuccessAt < customer.startedAt || customer.expansions < 0
    ) {
      issue(
        issues,
        `records.customers.${customer.id}`,
        "Invalid customer lifecycle state",
      );
    }
    if (
      customer.lastNpsScore !== undefined &&
      (customer.lastNpsScore < 0 || customer.lastNpsScore > 10)
    ) {
      issue(
        issues,
        `records.customers.${customer.id}.lastNpsScore`,
        "NPS score must be between 0 and 10",
      );
    }
    if (customer.ownerId && !state.records.successReps[customer.ownerId]) {
      issue(
        issues,
        `records.customers.${customer.id}.ownerId`,
        "Customer success owner does not exist",
      );
    }
  }
  if (
    Object.keys(state.records.successReps).length >
      DEFAULT_RULES.maxSuccessReps
  ) {
    issue(
      issues,
      "records.successReps",
      "Success representative limit exceeded",
    );
  }
  for (const rep of Object.values(state.records.successReps)) {
    if (
      rep.name.trim().length < 2 || rep.name.length > 60 || rep.skill < 1 ||
      rep.skill > 100 || rep.accountCapacity < 1 || rep.burnout < 0 ||
      rep.burnout > 100 || rep.monthlySalaryCents < 1
    ) {
      issue(
        issues,
        `records.successReps.${rep.id}`,
        "Invalid success representative",
      );
    }
  }
  if (
    Object.keys(state.records.tickets).length > DEFAULT_RULES.maxTicketRecords
  ) {
    issue(issues, "records.tickets", "Ticket record limit exceeded");
  }
  for (const ticket of Object.values(state.records.tickets)) {
    if (!state.records.customers[ticket.customerId]) {
      issue(
        issues,
        `records.tickets.${ticket.id}.customerId`,
        "Ticket customer does not exist",
      );
    }
    if (ticket.ownerId && !state.records.supportReps[ticket.ownerId]) {
      issue(
        issues,
        `records.tickets.${ticket.id}.ownerId`,
        "Ticket support owner does not exist",
      );
    }
    if (
      ticket.title.trim().length < 3 || ticket.title.length > 100 ||
      ticket.responseDueAt < ticket.createdAt ||
      ticket.resolutionDueAt < ticket.responseDueAt ||
      (ticket.acknowledgedAt !== undefined &&
        ticket.acknowledgedAt < ticket.createdAt) ||
      (ticket.resolvedAt !== undefined &&
        ticket.resolvedAt < ticket.createdAt) ||
      (ticket.resolutionQuality !== undefined &&
        (ticket.resolutionQuality < 0 || ticket.resolutionQuality > 100))
    ) {
      issue(issues, `records.tickets.${ticket.id}`, "Invalid ticket state");
    }
  }
  if (
    Object.keys(state.records.supportReps).length > DEFAULT_RULES.maxSupportReps
  ) {
    issue(
      issues,
      "records.supportReps",
      "Support representative limit exceeded",
    );
  }
  for (const rep of Object.values(state.records.supportReps)) {
    if (
      rep.name.trim().length < 2 || rep.name.length > 60 || rep.skill < 1 ||
      rep.skill > 100 || rep.ticketCapacity < 1 || rep.burnout < 0 ||
      rep.burnout > 100 || rep.monthlySalaryCents < 1
    ) {
      issue(
        issues,
        `records.supportReps.${rep.id}`,
        "Invalid support representative",
      );
    }
  }
  if (
    Object.keys(state.records.incidents).length >
      DEFAULT_RULES.maxIncidentRecords
  ) {
    issue(issues, "records.incidents", "Incident record limit exceeded");
  }
  for (const incident of Object.values(state.records.incidents)) {
    if (
      !state.records.tickets[incident.ticketId] ||
      !state.records.customers[incident.customerId] ||
      (incident.status === "resolved" && incident.resolvedAt === undefined)
    ) {
      issue(
        issues,
        `records.incidents.${incident.id}`,
        "Invalid incident state",
      );
    }
  }
  if (
    Object.keys(state.records.quotes).length > DEFAULT_RULES.maxQuoteRecords
  ) {
    issue(issues, "records.quotes", "Quote record limit exceeded");
  }
  for (const quote of Object.values(state.records.quotes)) {
    if (!state.records.deals[quote.dealId]) {
      issue(
        issues,
        `records.quotes.${quote.id}.dealId`,
        "Quote deal does not exist",
      );
    }
    if (
      quote.seats < 1 || quote.seats > 500 || quote.discountPercent < 0 ||
      quote.discountPercent > 30 || quote.monthlyValueCents < 1 ||
      quote.validUntil < quote.createdAt
    ) {
      issue(issues, `records.quotes.${quote.id}`, "Invalid quote terms");
    }
  }
  for (const task of Object.values(state.records.tasks)) {
    if (task.status === "completed" && task.completedAt === undefined) {
      issue(
        issues,
        `records.tasks.${task.id}.completedAt`,
        "Completed task requires a timestamp",
      );
    }
  }
  for (const campaign of Object.values(state.records.campaigns)) {
    if (
      campaign.name.trim().length < 2 || campaign.name.length > 60 ||
      campaign.message.trim().length < 10 || campaign.message.length > 200
    ) {
      issue(
        issues,
        `records.campaigns.${campaign.id}`,
        "Invalid campaign copy",
      );
    }
    if (
      campaign.endsAt <= campaign.createdAt || campaign.dailyBudgetCents < 1 ||
      campaign.totalSpentCents < 0 || campaign.leadsGenerated < 0
    ) {
      issue(
        issues,
        `records.campaigns.${campaign.id}`,
        "Invalid campaign economics",
      );
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
