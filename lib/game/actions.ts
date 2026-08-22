import { projectEvents } from "./events.ts";
import { generateLead } from "./catalog.ts";
import { randomInteger } from "./rng.ts";
import { createInitialState, DEFAULT_RULES } from "./state.ts";
import { applyPlatformCommand } from "./platform.ts";
import type {
  BillingCycle,
  CampaignAudience,
  CampaignChannel,
  CommandResult,
  DealProduct,
  DealStage,
  DomainEvent,
  GameCommand,
  GameRules,
  GameState,
  IncidentSeverity,
  Lead,
  SalesRepLevel,
  SalesTerritory,
  TicketChannel,
  TicketPriority,
} from "./types.ts";

const SALES_REP_PROFILES: Record<
  SalesRepLevel,
  { monthlySalaryCents: number; skill: number; dealCapacity: number }
> = {
  junior: { monthlySalaryCents: 300_000, skill: 45, dealCapacity: 4 },
  mid: { monthlySalaryCents: 600_000, skill: 65, dealCapacity: 6 },
  senior: { monthlySalaryCents: 1_000_000, skill: 82, dealCapacity: 8 },
};

const SUCCESS_REP_PROFILES: Record<
  SalesRepLevel,
  { monthlySalaryCents: number; skill: number; accountCapacity: number }
> = {
  junior: { monthlySalaryCents: 350_000, skill: 45, accountCapacity: 8 },
  mid: { monthlySalaryCents: 650_000, skill: 65, accountCapacity: 12 },
  senior: { monthlySalaryCents: 950_000, skill: 82, accountCapacity: 16 },
};

const SUPPORT_REP_PROFILES: Record<
  SalesRepLevel,
  { monthlySalaryCents: number; skill: number; ticketCapacity: number }
> = {
  junior: { monthlySalaryCents: 320_000, skill: 45, ticketCapacity: 6 },
  mid: { monthlySalaryCents: 560_000, skill: 65, ticketCapacity: 10 },
  senior: { monthlySalaryCents: 850_000, skill: 82, ticketCapacity: 14 },
};

const TICKET_SLA_MINUTES: Record<
  TicketPriority,
  { response: number; resolution: number }
> = {
  urgent: { response: 60, resolution: 4 * 60 },
  high: { response: 4 * 60, resolution: 12 * 60 },
  normal: { response: 8 * 60, resolution: 24 * 60 },
  low: { response: 24 * 60, resolution: 3 * 24 * 60 },
};

export function quoteMonthlyValueCents(
  product: DealProduct,
  billingCycle: BillingCycle,
  seats: number,
  discountPercent: number,
): number {
  const plan = {
    starter: { base: 20_000, seat: 1_000 },
    growth: { base: 45_000, seat: 1_500 },
    scale: { base: 80_000, seat: 2_500 },
  }[product];
  const annualFactor = billingCycle === "annual" ? 90 : 100;
  return Math.round(
    (plan.base + plan.seat * seats) * annualFactor / 100 *
      (100 - discountPercent) / 100,
  );
}

function createCampaign(
  state: GameState,
  input: {
    name: string;
    channel: CampaignChannel;
    audience: CampaignAudience;
    dailyBudgetCents: number;
    durationDays: number;
    message: string;
  },
  rules: GameRules,
): CommandResult {
  if (!state.unlocks.includes("marketing")) {
    return rejected(state, "Retain 3 customers to unlock campaigns");
  }
  if (
    Object.values(state.records.campaigns).filter((campaign) =>
      campaign.status === "active"
    ).length >= rules.maxActiveCampaigns
  ) {
    return rejected(state, "Pause a campaign before starting another");
  }
  if (
    Object.keys(state.records.campaigns).length >= rules.maxCampaignRecords &&
    !Object.values(state.records.campaigns).some((campaign) =>
      campaign.status === "archived"
    )
  ) {
    return rejected(state, "Archive an older campaign before creating another");
  }
  const name = input.name.trim().replaceAll(/\s+/g, " ");
  const message = input.message.trim().replaceAll(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) {
    return rejected(state, "Campaign name must contain 2 to 60 characters");
  }
  if (message.length < 10 || message.length > 200) {
    return rejected(
      state,
      "Campaign message must contain 10 to 200 characters",
    );
  }
  if (
    !Number.isInteger(input.dailyBudgetCents) ||
    input.dailyBudgetCents < 1_000 ||
    input.dailyBudgetCents > 100_000
  ) {
    return rejected(state, "Daily budget must be between $10 and $1,000");
  }
  if (
    !Number.isInteger(input.durationDays) || input.durationDays < 1 ||
    input.durationDays > 30
  ) {
    return rejected(state, "Campaign duration must be between 1 and 30 days");
  }

  const sequence = state.sequences.campaign + 1;
  const campaignId = `campaign_${sequence}`;
  const campaign = {
    id: campaignId,
    name,
    channel: input.channel,
    audience: input.audience,
    status: "active" as const,
    message,
    dailyBudgetCents: input.dailyBudgetCents,
    createdAt: state.clock.gameMinute,
    endsAt: state.clock.gameMinute + input.durationDays * 24 * 60,
    totalSpentCents: 0,
    leadsGenerated: 0,
  };
  return accepted(
    compactCampaignHistory({
      ...state,
      sequences: { ...state.sequences, campaign: sequence },
      records: {
        ...state.records,
        campaigns: { ...state.records.campaigns, [campaignId]: campaign },
      },
    }, rules),
    [{
      kind: "campaign_created",
      summary: `${name} campaign launched`,
      relatedId: campaignId,
      gameMinute: state.clock.gameMinute,
    }],
    rules,
  );
}

function compactCampaignHistory(
  state: GameState,
  rules: GameRules,
): GameState {
  const overflow = Object.keys(state.records.campaigns).length -
    rules.maxCampaignRecords;
  if (overflow <= 0) return state;
  const archived = Object.values(state.records.campaigns)
    .filter((campaign) => campaign.status === "archived")
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, overflow);
  if (archived.length === 0) return state;

  const removedIds = new Set(archived.map((campaign) => campaign.id));
  const campaigns = { ...state.records.campaigns };
  for (const campaign of archived) delete campaigns[campaign.id];
  const leads = Object.fromEntries(
    Object.entries(state.records.leads).map(([id, lead]) => {
      if (!lead.campaignId || !removedIds.has(lead.campaignId)) {
        return [id, lead];
      }
      const { campaignId: _campaignId, ...historicalLead } = lead;
      return [id, historicalLead];
    }),
  );
  return {
    ...state,
    records: { ...state.records, campaigns, leads },
    history: {
      ...state.history,
      campaignsArchived: state.history.campaignsArchived + archived.length,
      campaignSpendArchivedCents: state.history.campaignSpendArchivedCents +
        archived.reduce(
          (total, campaign) => total + campaign.totalSpentCents,
          0,
        ),
      campaignLeadsArchived: state.history.campaignLeadsArchived +
        archived.reduce(
          (total, campaign) => total + campaign.leadsGenerated,
          0,
        ),
    },
  };
}

function setCampaignStatus(
  state: GameState,
  campaignId: string,
  status: "active" | "paused",
  rules: GameRules,
): CommandResult {
  const campaign = state.records.campaigns[campaignId];
  if (!campaign) return rejected(state, "Campaign does not exist");
  if (campaign.status === "completed" || campaign.status === "archived") {
    return rejected(
      state,
      `${statusLabel(campaign.status)} campaigns cannot be restarted`,
    );
  }
  if (campaign.status === status) {
    return rejected(state, `Campaign is already ${status}`);
  }
  if (
    status === "active" &&
    Object.values(state.records.campaigns).filter((entry) =>
        entry.status === "active"
      ).length >= rules.maxActiveCampaigns
  ) {
    return rejected(state, "Pause a campaign before resuming another");
  }
  if (status === "active" && campaign.endsAt <= state.clock.gameMinute) {
    return rejected(state, "Edit the duration before resuming this campaign");
  }
  const nextState = {
    ...state,
    records: {
      ...state.records,
      campaigns: {
        ...state.records.campaigns,
        [campaignId]: { ...campaign, status },
      },
    },
  };
  return accepted(nextState, [{
    kind: status === "active" ? "campaign_resumed" : "campaign_paused",
    summary: `${campaign.name} ${status === "active" ? "resumed" : "paused"}`,
    relatedId: campaignId,
    gameMinute: state.clock.gameMinute,
  }], rules);
}

function statusLabel(status: string): string {
  return status[0].toUpperCase() + status.slice(1);
}

function updateCampaign(
  state: GameState,
  command: Extract<GameCommand, { type: "update_campaign" }>,
  rules: GameRules,
): CommandResult {
  const campaign = state.records.campaigns[command.campaignId];
  if (!campaign) return rejected(state, "Campaign does not exist");
  if (campaign.status !== "paused") {
    return rejected(state, "Pause the campaign before editing it");
  }
  const validated = createCampaign(
    {
      ...state,
      records: { ...state.records, campaigns: {} },
    },
    command,
    rules,
  );
  if (!validated.accepted) {
    return rejected(state, validated.reason ?? "Invalid campaign");
  }
  const values = Object.values(validated.state.records.campaigns)[0];
  return accepted({
    ...state,
    records: {
      ...state.records,
      campaigns: {
        ...state.records.campaigns,
        [campaign.id]: {
          ...campaign,
          name: values.name,
          channel: values.channel,
          audience: values.audience,
          message: values.message,
          dailyBudgetCents: values.dailyBudgetCents,
          endsAt: state.clock.gameMinute + command.durationDays * 24 * 60,
        },
      },
    },
  }, [{
    kind: "campaign_edited",
    summary: `${values.name} campaign updated`,
    relatedId: campaign.id,
    gameMinute: state.clock.gameMinute,
  }], rules);
}

function duplicateCampaign(
  state: GameState,
  campaignId: string,
  rules: GameRules,
): CommandResult {
  const source = state.records.campaigns[campaignId];
  if (!source) return rejected(state, "Campaign does not exist");
  const sequence = state.sequences.campaign + 1;
  const id = `campaign_${sequence}`;
  const name = `Copy of ${source.name}`.slice(0, 60);
  return accepted(
    compactCampaignHistory({
      ...state,
      sequences: { ...state.sequences, campaign: sequence },
      records: {
        ...state.records,
        campaigns: {
          ...state.records.campaigns,
          [id]: {
            ...source,
            id,
            name,
            status: "paused",
            createdAt: state.clock.gameMinute,
            endsAt: state.clock.gameMinute + (source.endsAt - source.createdAt),
            totalSpentCents: 0,
            leadsGenerated: 0,
          },
        },
      },
    }, rules),
    [{
      kind: "campaign_duplicated",
      summary: `${source.name} duplicated`,
      relatedId: id,
      gameMinute: state.clock.gameMinute,
    }],
    rules,
  );
}

function archiveCampaign(
  state: GameState,
  campaignId: string,
  rules: GameRules,
): CommandResult {
  const campaign = state.records.campaigns[campaignId];
  if (!campaign) return rejected(state, "Campaign does not exist");
  if (campaign.status === "active") {
    return rejected(state, "Pause the campaign before archiving it");
  }
  if (campaign.status === "archived") {
    return rejected(state, "Campaign is already archived");
  }
  return accepted(
    compactCampaignHistory({
      ...state,
      records: {
        ...state.records,
        campaigns: {
          ...state.records.campaigns,
          [campaignId]: { ...campaign, status: "archived" },
        },
      },
    }, rules),
    [{
      kind: "campaign_archived",
      summary: `${campaign.name} archived`,
      relatedId: campaign.id,
      gameMinute: state.clock.gameMinute,
    }],
    rules,
  );
}

function rejected(state: GameState, reason: string): CommandResult {
  return { accepted: false, state, events: [], reason };
}

function accepted(
  state: GameState,
  events: DomainEvent[],
  rules: GameRules,
): CommandResult {
  const openDealCount =
    Object.values(state.records.deals).filter((deal) =>
      deal.stage !== "won" && deal.stage !== "lost"
    ).length;
  const unlockPipeline = !state.unlocks.includes("pipeline") &&
    state.company.mrrCents >= rules.pipelineUnlockMrrCents &&
    openDealCount >= rules.pipelineUnlockOpenDeals;
  const unlockEvents: DomainEvent[] = unlockPipeline
    ? [{
      kind: "unlock_earned",
      summary: "Pipeline workspace unlocked",
      gameMinute: state.clock.gameMinute,
    }]
    : [];
  const nextState = unlockPipeline
    ? { ...state, unlocks: [...state.unlocks, "pipeline" as const] }
    : state;
  const projectedEvents = [...events, ...unlockEvents];

  return {
    accepted: true,
    state: projectEvents(nextState, projectedEvents, rules),
    events: projectedEvents,
  };
}

function nextDealStage(stage: DealStage): DealStage | undefined {
  const stages: DealStage[] = [
    "qualified",
    "discovery",
    "evaluation",
    "negotiation",
    "won",
  ];
  return stages[stages.indexOf(stage) + 1];
}

function contactLead(
  state: GameState,
  lead: Lead,
  channel: "call" | "email",
  rules: GameRules,
): CommandResult {
  if (!["new", "contacted", "cold"].includes(lead.status)) {
    return rejected(state, "This lead can no longer be contacted");
  }

  const capacityCost = channel === "call" ? 20 : 10;
  if (state.company.founderCapacityRemaining < capacityCost) {
    return rejected(state, "Not enough founder capacity");
  }

  const gameMinute = state.clock.gameMinute;
  const rapidRepeat = lead.status === "contacted" &&
    gameMinute - lead.lastActivityAt < 60;
  const engagementChange = rapidRepeat
    ? { value: channel === "call" ? -30 : -20, cursor: state.rngCursor }
    : randomInteger(state.seed, state.rngCursor, 6, 16);
  const taskSequence = state.sequences.task + 1;
  const taskId = `task_${taskSequence}`;
  const nextState: GameState = {
    ...state,
    rngCursor: engagementChange.cursor,
    company: {
      ...state.company,
      founderCapacityRemaining: state.company.founderCapacityRemaining -
        capacityCost,
    },
    sequences: { ...state.sequences, task: taskSequence },
    records: {
      ...state.records,
      leads: {
        ...state.records.leads,
        [lead.id]: {
          ...lead,
          status: "contacted",
          engagement: Math.max(
            0,
            Math.min(100, lead.engagement + engagementChange.value),
          ),
          lastActivityAt: gameMinute,
        },
      },
      tasks: {
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
      },
    },
    onboarding: {
      ...state.onboarding,
      step: state.onboarding.step === "inspect_lead" ||
          state.onboarding.step === "contact_lead"
        ? "qualify_lead"
        : state.onboarding.step,
    },
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
  }, {
    kind: "task_created",
    summary: `Follow-up task created for ${lead.firstName} ${lead.lastName}`,
    relatedId: taskId,
    gameMinute,
  }];

  return accepted(nextState, events, rules);
}

function qualifyLead(
  state: GameState,
  lead: Lead,
  rules: GameRules,
): CommandResult {
  if (lead.status !== "contacted") {
    return rejected(state, "Contact the lead before qualifying it");
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
  const nextState: GameState = {
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
  };
  const events: DomainEvent[] = [{
    kind: "lead_qualified",
    summary: `${lead.firstName} ${lead.lastName} qualified`,
    relatedId: lead.id,
    gameMinute,
  }, {
    kind: "deal_created",
    summary: `New deal worth $${(monthlyValueCents / 100).toFixed(0)} MRR`,
    relatedId: dealId,
    gameMinute,
  }];

  return accepted(nextState, events, rules);
}

function updateDeal(
  state: GameState,
  command: Extract<GameCommand, { type: "update_deal" }>,
  rules: GameRules,
): CommandResult {
  if (!state.unlocks.includes("pipeline")) {
    return rejected(state, "Unlock Pipeline to edit deals");
  }
  const deal = state.records.deals[command.dealId];
  if (!deal) return rejected(state, "Deal does not exist");
  if (deal.stage === "won" || deal.stage === "lost") {
    return rejected(state, "Closed deals cannot be edited");
  }
  if (
    !Number.isInteger(command.monthlyValueCents) ||
    command.monthlyValueCents < 10_000 || command.monthlyValueCents > 500_000
  ) {
    return rejected(state, "Deal value must be between $100 and $5,000 MRR");
  }
  if (
    !Number.isInteger(command.expectedCloseInDays) ||
    command.expectedCloseInDays < 1 || command.expectedCloseInDays > 90
  ) {
    return rejected(state, "Expected close must be between 1 and 90 days");
  }
  const updatedAt = state.clock.gameMinute;
  const nextState: GameState = {
    ...state,
    records: {
      ...state.records,
      deals: {
        ...state.records.deals,
        [deal.id]: {
          ...deal,
          product: command.product,
          monthlyValueCents: command.monthlyValueCents,
          expectedCloseAt: updatedAt + command.expectedCloseInDays * 24 * 60,
          updatedAt,
        },
      },
    },
  };
  return accepted(nextState, [{
    kind: "deal_updated",
    summary: "Deal terms updated",
    relatedId: deal.id,
    gameMinute: updatedAt,
  }], rules);
}

function loseDeal(
  state: GameState,
  dealId: string,
  reason: Extract<GameCommand, { type: "lose_deal" }>["reason"],
  rules: GameRules,
): CommandResult {
  if (!state.unlocks.includes("pipeline")) {
    return rejected(state, "Unlock Pipeline to close deals");
  }
  const deal = state.records.deals[dealId];
  if (!deal) return rejected(state, "Deal does not exist");
  if (deal.stage === "won" || deal.stage === "lost") {
    return rejected(state, "This deal is already closed");
  }
  const gameMinute = state.clock.gameMinute;
  const nextState: GameState = {
    ...state,
    records: {
      ...state.records,
      deals: {
        ...state.records.deals,
        [deal.id]: {
          ...deal,
          stage: "lost",
          probability: 0,
          lossReason: reason,
          updatedAt: gameMinute,
        },
      },
    },
  };
  return accepted(nextState, [{
    kind: "deal_lost",
    summary: `Deal lost: ${reason.replaceAll("_", " ")}`,
    relatedId: deal.id,
    gameMinute,
  }], rules);
}

function hireSalesRep(
  state: GameState,
  nameInput: string,
  level: SalesRepLevel,
  territory: SalesTerritory,
  monthlyTargetCents: number,
  rules: GameRules,
): CommandResult {
  if (!state.unlocks.includes("pipeline")) {
    return rejected(state, "Unlock Pipeline before hiring a sales team");
  }
  if (Object.keys(state.records.salesReps).length >= rules.maxSalesReps) {
    return rejected(state, "Sales team limit reached");
  }
  const name = nameInput.trim().replaceAll(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) {
    return rejected(
      state,
      "Representative name must contain 2 to 60 characters",
    );
  }
  if (
    !Number.isInteger(monthlyTargetCents) || monthlyTargetCents < 100_000 ||
    monthlyTargetCents > 5_000_000
  ) {
    return rejected(
      state,
      "Monthly target must be between $1,000 and $50,000",
    );
  }
  const profile = SALES_REP_PROFILES[level];
  const sequence = state.sequences.salesRep + 1;
  const id = `sales_rep_${sequence}`;
  const nextState: GameState = {
    ...state,
    sequences: { ...state.sequences, salesRep: sequence },
    records: {
      ...state.records,
      salesReps: {
        ...state.records.salesReps,
        [id]: {
          id,
          name,
          level,
          territory,
          monthlyTargetCents,
          ...profile,
          burnout: 0,
          hiredAt: state.clock.gameMinute,
        },
      },
    },
  };
  return accepted(nextState, [{
    kind: "sales_rep_hired",
    summary: `${name} joined the sales team`,
    relatedId: id,
    gameMinute: state.clock.gameMinute,
  }], rules);
}

function routeLeads(state: GameState, rules: GameRules): CommandResult {
  if (!state.unlocks.includes("pipeline")) {
    return rejected(state, "Unlock Pipeline to route leads");
  }
  const reps = Object.values(state.records.salesReps);
  if (reps.length === 0) {
    return rejected(state, "Hire a sales representative first");
  }
  const leads = { ...state.records.leads };
  const load = Object.fromEntries(reps.map((rep) => [rep.id, 0]));
  for (const lead of Object.values(leads)) {
    if (
      lead.ownerId && load[lead.ownerId] !== undefined &&
      ["new", "contacted", "cold"].includes(lead.status)
    ) {
      load[lead.ownerId] += 1;
    }
  }
  for (const deal of Object.values(state.records.deals)) {
    if (
      deal.ownerId && load[deal.ownerId] !== undefined &&
      deal.stage !== "won" && deal.stage !== "lost"
    ) {
      load[deal.ownerId] += 1;
    }
  }
  let routed = 0;
  for (
    const lead of Object.values(leads).filter((entry) =>
      !entry.ownerId && ["new", "contacted", "cold"].includes(entry.status)
    ).sort((a, b) => a.createdAt - b.createdAt)
  ) {
    const region = state.records.companies[lead.companyId]?.region;
    const owner = reps.filter((rep) =>
      (rep.territory === "all" || rep.territory === region) &&
      load[rep.id] < rep.dealCapacity
    ).sort((a, b) =>
      load[a.id] - load[b.id] || a.hiredAt - b.hiredAt
    )[0];
    if (!owner) continue;
    leads[lead.id] = { ...lead, ownerId: owner.id };
    load[owner.id] += 1;
    routed += 1;
  }
  if (routed === 0) {
    return rejected(state, "No eligible unassigned leads to route");
  }
  return accepted({
    ...state,
    records: { ...state.records, leads },
  }, [{
    kind: "leads_routed",
    summary: `${routed} lead${routed === 1 ? "" : "s"} routed by territory`,
    gameMinute: state.clock.gameMinute,
  }], rules);
}

function assignDeal(
  state: GameState,
  dealId: string,
  ownerId: string | undefined,
  rules: GameRules,
): CommandResult {
  if (!state.unlocks.includes("pipeline")) {
    return rejected(state, "Unlock Pipeline to assign deals");
  }
  const deal = state.records.deals[dealId];
  if (!deal) return rejected(state, "Deal does not exist");
  if (deal.stage === "won" || deal.stage === "lost") {
    return rejected(state, "Closed deals cannot be reassigned");
  }
  const owner = ownerId ? state.records.salesReps[ownerId] : undefined;
  if (ownerId && !owner) {
    return rejected(state, "Sales representative does not exist");
  }
  if (deal.ownerId === ownerId) {
    return rejected(state, "Deal owner is unchanged");
  }
  const nextDeal = { ...deal, updatedAt: state.clock.gameMinute };
  if (ownerId) nextDeal.ownerId = ownerId;
  else delete nextDeal.ownerId;
  const nextState: GameState = {
    ...state,
    records: {
      ...state.records,
      deals: { ...state.records.deals, [deal.id]: nextDeal },
    },
  };
  return accepted(nextState, [{
    kind: "deal_assigned",
    summary: owner
      ? `Deal assigned to ${owner.name}`
      : "Deal returned to founder",
    relatedId: deal.id,
    gameMinute: state.clock.gameMinute,
  }], rules);
}

function trainSalesRep(
  state: GameState,
  salesRepId: string,
  rules: GameRules,
): CommandResult {
  const rep = state.records.salesReps[salesRepId];
  if (!rep) return rejected(state, "Sales representative does not exist");
  const trainingCostCents = 100_000;
  if (state.company.cashCents < trainingCostCents) {
    return rejected(state, "Not enough cash for sales training");
  }
  if (rep.skill >= 100 && rep.burnout === 0) {
    return rejected(state, "Representative has no current training need");
  }
  return accepted({
    ...state,
    company: {
      ...state.company,
      cashCents: state.company.cashCents - trainingCostCents,
    },
    records: {
      ...state.records,
      salesReps: {
        ...state.records.salesReps,
        [rep.id]: {
          ...rep,
          skill: Math.min(100, rep.skill + 5),
          burnout: Math.max(0, rep.burnout - 20),
        },
      },
    },
  }, [{
    kind: "sales_rep_trained",
    summary: `${rep.name} completed sales training`,
    relatedId: rep.id,
    gameMinute: state.clock.gameMinute,
  }], rules);
}

function bulkDeals(
  state: GameState,
  dealIds: string[],
  operation: (state: GameState, dealId: string) => CommandResult,
): CommandResult {
  const ids = [...new Set(dealIds)].slice(0, 50);
  if (ids.length === 0) return rejected(state, "Select at least one deal");
  let nextState = state;
  const events: DomainEvent[] = [];
  let acceptedCount = 0;
  for (const dealId of ids) {
    const result = operation(nextState, dealId);
    if (!result.accepted) continue;
    nextState = result.state;
    events.push(...result.events);
    acceptedCount += 1;
  }
  return acceptedCount > 0
    ? { accepted: true, state: nextState, events }
    : rejected(state, "No selected deals could be updated");
}

function compactQuoteHistory(state: GameState, rules: GameRules): GameState {
  const overflow = Object.keys(state.records.quotes).length -
    rules.maxQuoteRecords;
  if (overflow <= 0) return state;
  const removable = Object.values(state.records.quotes).filter((quote) =>
    quote.status === "accepted" || quote.status === "expired"
  ).sort((a, b) => a.updatedAt - b.updatedAt).slice(0, overflow);
  if (removable.length === 0) return state;
  const quotes = { ...state.records.quotes };
  for (const quote of removable) delete quotes[quote.id];
  return { ...state, records: { ...state.records, quotes } };
}

function validQuoteTerms(input: {
  seats: number;
  discountPercent: number;
  validDays: number;
}): string | undefined {
  if (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > 500) {
    return "Quote seats must be between 1 and 500";
  }
  if (
    !Number.isInteger(input.discountPercent) || input.discountPercent < 0 ||
    input.discountPercent > 30
  ) {
    return "Quote discount must be between 0% and 30%";
  }
  if (
    !Number.isInteger(input.validDays) || input.validDays < 1 ||
    input.validDays > 30
  ) {
    return "Quote validity must be between 1 and 30 days";
  }
}

function createQuote(
  state: GameState,
  command: Extract<GameCommand, { type: "create_quote" }>,
  rules: GameRules,
): CommandResult {
  if (!state.unlocks.includes("pipeline")) {
    return rejected(state, "Unlock Pipeline to create quotes");
  }
  const deal = state.records.deals[command.dealId];
  if (!deal) return rejected(state, "Deal does not exist");
  if (["won", "lost"].includes(deal.stage)) {
    return rejected(state, "Closed deals cannot receive quotes");
  }
  if (
    Object.values(state.records.quotes).some((quote) =>
      quote.dealId === deal.id && ["draft", "sent"].includes(quote.status)
    )
  ) {
    return rejected(state, "Resolve the active quote before creating another");
  }
  const compacted = compactQuoteHistory(state, rules);
  if (Object.keys(compacted.records.quotes).length >= rules.maxQuoteRecords) {
    return rejected(state, "Quote record limit reached");
  }
  const reason = validQuoteTerms(command);
  if (reason) return rejected(state, reason);
  const sequence = compacted.sequences.quote + 1;
  const id = `quote_${sequence}`;
  const gameMinute = compacted.clock.gameMinute;
  const quote = {
    id,
    dealId: deal.id,
    product: command.product,
    billingCycle: command.billingCycle,
    seats: command.seats,
    discountPercent: command.discountPercent,
    monthlyValueCents: quoteMonthlyValueCents(
      command.product,
      command.billingCycle,
      command.seats,
      command.discountPercent,
    ),
    status: "draft" as const,
    validUntil: gameMinute + command.validDays * 24 * 60,
    createdAt: gameMinute,
    updatedAt: gameMinute,
  };
  return accepted({
    ...compacted,
    sequences: { ...compacted.sequences, quote: sequence },
    records: {
      ...compacted.records,
      quotes: { ...compacted.records.quotes, [id]: quote },
    },
  }, [{
    kind: "quote_created",
    summary: `Draft quote created for $${
      (quote.monthlyValueCents / 100).toFixed(0)
    } MRR`,
    relatedId: id,
    gameMinute,
  }], rules);
}

function updateQuote(
  state: GameState,
  command: Extract<GameCommand, { type: "update_quote" }>,
  rules: GameRules,
): CommandResult {
  const quote = state.records.quotes[command.quoteId];
  if (!quote) return rejected(state, "Quote does not exist");
  if (quote.status !== "draft") {
    return rejected(state, "Only draft quotes can be edited");
  }
  const reason = validQuoteTerms(command);
  if (reason) return rejected(state, reason);
  const gameMinute = state.clock.gameMinute;
  const updated = {
    ...quote,
    product: command.product,
    billingCycle: command.billingCycle,
    seats: command.seats,
    discountPercent: command.discountPercent,
    monthlyValueCents: quoteMonthlyValueCents(
      command.product,
      command.billingCycle,
      command.seats,
      command.discountPercent,
    ),
    validUntil: gameMinute + command.validDays * 24 * 60,
    updatedAt: gameMinute,
  };
  return accepted({
    ...state,
    records: {
      ...state.records,
      quotes: { ...state.records.quotes, [quote.id]: updated },
    },
  }, [{
    kind: "quote_updated",
    summary: "Draft quote updated",
    relatedId: quote.id,
    gameMinute,
  }], rules);
}

function setQuoteStatus(
  state: GameState,
  quoteId: string,
  status: "sent" | "expired",
  rules: GameRules,
): CommandResult {
  const quote = state.records.quotes[quoteId];
  if (!quote) return rejected(state, "Quote does not exist");
  if (status === "sent" && quote.status !== "draft") {
    return rejected(state, "Only draft quotes can be sent");
  }
  if (status === "expired" && !["draft", "sent"].includes(quote.status)) {
    return rejected(state, "Only active quotes can expire");
  }
  const gameMinute = state.clock.gameMinute;
  return accepted({
    ...state,
    records: {
      ...state.records,
      quotes: {
        ...state.records.quotes,
        [quote.id]: { ...quote, status, updatedAt: gameMinute },
      },
    },
  }, [{
    kind: status === "sent" ? "quote_sent" : "quote_expired",
    summary: status === "sent" ? "Quote sent to prospect" : "Quote expired",
    relatedId: quote.id,
    gameMinute,
  }], rules);
}

function acceptQuote(
  state: GameState,
  quoteId: string,
  rules: GameRules,
): CommandResult {
  const quote = state.records.quotes[quoteId];
  if (!quote) return rejected(state, "Quote does not exist");
  if (quote.status !== "sent") {
    return rejected(state, "Only sent quotes can be accepted");
  }
  if (quote.validUntil < state.clock.gameMinute) {
    return rejected(state, "Quote has expired");
  }
  const deal = state.records.deals[quote.dealId];
  if (!deal) return rejected(state, "Quote deal does not exist");
  if (deal.stage !== "negotiation") {
    return rejected(state, "Deal must be in negotiation to accept a quote");
  }
  const gameMinute = state.clock.gameMinute;
  const prepared: GameState = {
    ...state,
    records: {
      ...state.records,
      deals: {
        ...state.records.deals,
        [deal.id]: {
          ...deal,
          product: quote.product,
          monthlyValueCents: quote.monthlyValueCents,
          updatedAt: gameMinute,
        },
      },
      quotes: {
        ...state.records.quotes,
        [quote.id]: { ...quote, status: "accepted", updatedAt: gameMinute },
      },
    },
  };
  const quoteEvent: DomainEvent = {
    kind: "quote_accepted",
    summary: `Quote accepted for $${
      (quote.monthlyValueCents / 100).toFixed(0)
    } MRR`,
    relatedId: quote.id,
    gameMinute,
  };
  const closed = advanceDeal(prepared, deal.id, rules);
  if (!closed.accepted) return closed;
  return {
    accepted: true,
    state: projectEvents(closed.state, [quoteEvent], rules),
    events: [...closed.events, quoteEvent],
  };
}

function completeCustomerOnboarding(
  state: GameState,
  customerId: string,
  rules: GameRules,
): CommandResult {
  const customer = state.records.customers[customerId];
  if (!customer) return rejected(state, "Customer does not exist");
  if (customer.lifecycle !== "onboarding") {
    return rejected(state, "Customer onboarding is already complete");
  }
  const task = Object.values(state.records.tasks).find((entry) =>
    entry.kind === "onboarding" && entry.relatedId === customer.id &&
    entry.status === "open"
  );
  if (!task) return rejected(state, "Customer has no open onboarding task");
  const gameMinute = state.clock.gameMinute;
  return accepted({
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
  }], rules);
}

function customerCheckIn(
  state: GameState,
  customerId: string,
  rules: GameRules,
): CommandResult {
  const customer = state.records.customers[customerId];
  if (!customer) return rejected(state, "Customer does not exist");
  const capacityCost = 30;
  if (state.company.founderCapacityRemaining < capacityCost) {
    return rejected(state, "Not enough founder capacity");
  }
  const gameMinute = state.clock.gameMinute;
  return accepted({
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
  }], rules);
}

function renewCustomer(
  state: GameState,
  customerId: string,
  rules: GameRules,
): CommandResult {
  const customer = state.records.customers[customerId];
  if (!customer) return rejected(state, "Customer does not exist");
  if (customer.renewalAt - state.clock.gameMinute > 7 * 24 * 60) {
    return rejected(state, "Renewal window has not opened");
  }
  if (customer.health < 40) {
    return rejected(state, "Recover account health before renewal");
  }
  let renewalAt = customer.renewalAt;
  while (renewalAt <= state.clock.gameMinute + 7 * 24 * 60) {
    renewalAt += rules.customerRenewalIntervalMinutes;
  }
  return accepted({
    ...state,
    records: {
      ...state.records,
      customers: {
        ...state.records.customers,
        [customer.id]: {
          ...customer,
          renewalAt,
          health: Math.min(100, customer.health + 5),
          adoption: Math.min(100, customer.adoption + 3),
          lifecycle: "active",
        },
      },
    },
  }, [{
    kind: "customer_renewed",
    summary: "Subscription renewed",
    relatedId: customer.id,
    gameMinute: state.clock.gameMinute,
  }], rules);
}

function expandCustomer(
  state: GameState,
  customerId: string,
  rules: GameRules,
): CommandResult {
  const customer = state.records.customers[customerId];
  if (!customer) return rejected(state, "Customer does not exist");
  if (
    customer.lifecycle !== "active" || customer.health < 70 ||
    customer.adoption < 70
  ) {
    return rejected(state, "Expansion requires 70 health and adoption");
  }
  const capacityCost = 45;
  if (state.company.founderCapacityRemaining < capacityCost) {
    return rejected(state, "Not enough founder capacity");
  }
  const increase = Math.max(
    5_000,
    Math.round(customer.monthlyValueCents * 0.2),
  );
  const gameMinute = state.clock.gameMinute;
  const mrrCents = state.company.mrrCents + increase;
  return accepted({
    ...state,
    company: {
      ...state.company,
      mrrCents,
      peakMrrCents: Math.max(state.company.peakMrrCents, mrrCents),
      founderCapacityRemaining: state.company.founderCapacityRemaining -
        capacityCost,
    },
    records: {
      ...state.records,
      customers: {
        ...state.records.customers,
        [customer.id]: {
          ...customer,
          monthlyValueCents: customer.monthlyValueCents + increase,
          health: Math.max(0, customer.health - 5),
          adoption: Math.min(100, customer.adoption + 5),
          expansions: customer.expansions + 1,
          lastSuccessAt: gameMinute,
        },
      },
    },
  }, [{
    kind: "customer_expanded",
    summary: `Subscription expanded by $${(increase / 100).toFixed(0)} MRR`,
    relatedId: customer.id,
    gameMinute,
    amountCents: increase,
  }], rules);
}

function hireSuccessRep(
  state: GameState,
  nameInput: string,
  level: SalesRepLevel,
  rules: GameRules,
): CommandResult {
  if (!state.unlocks.includes("customer_success")) {
    return rejected(state, "Unlock Customer Success to hire specialists");
  }
  if (Object.keys(state.records.successReps).length >= rules.maxSuccessReps) {
    return rejected(state, "Customer success team is at capacity");
  }
  const name = nameInput.trim().replaceAll(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) {
    return rejected(
      state,
      "Representative name must contain 2 to 60 characters",
    );
  }
  const profile = SUCCESS_REP_PROFILES[level];
  const sequence = state.sequences.successRep + 1;
  const id = `success_rep_${sequence}`;
  return accepted({
    ...state,
    sequences: { ...state.sequences, successRep: sequence },
    records: {
      ...state.records,
      successReps: {
        ...state.records.successReps,
        [id]: {
          id,
          name,
          level,
          ...profile,
          burnout: 0,
          hiredAt: state.clock.gameMinute,
        },
      },
    },
  }, [{
    kind: "success_rep_hired",
    summary: `${name} joined customer success`,
    relatedId: id,
    gameMinute: state.clock.gameMinute,
  }], rules);
}

function assignCustomer(
  state: GameState,
  customerId: string,
  ownerId: string | undefined,
  rules: GameRules,
): CommandResult {
  const customer = state.records.customers[customerId];
  if (!customer) return rejected(state, "Customer does not exist");
  const owner = ownerId ? state.records.successReps[ownerId] : undefined;
  if (ownerId && !owner) {
    return rejected(state, "Success representative does not exist");
  }
  if (customer.ownerId === ownerId) {
    return rejected(state, "Account owner is unchanged");
  }
  const updated = { ...customer };
  if (ownerId) updated.ownerId = ownerId;
  else delete updated.ownerId;
  return accepted({
    ...state,
    records: {
      ...state.records,
      customers: { ...state.records.customers, [customer.id]: updated },
    },
  }, [{
    kind: "customer_assigned",
    summary: owner
      ? `Account assigned to ${owner.name}`
      : "Account returned to founder",
    relatedId: customer.id,
    gameMinute: state.clock.gameMinute,
  }], rules);
}

function runSuccessPlaybook(
  state: GameState,
  customerId: string,
  playbook: "onboarding" | "adoption" | "recovery",
  rules: GameRules,
): CommandResult {
  const customer = state.records.customers[customerId];
  if (!customer) return rejected(state, "Customer does not exist");
  const owner = customer.ownerId
    ? state.records.successReps[customer.ownerId]
    : undefined;
  const capacityCost = owner ? 0 : 35;
  if (state.company.founderCapacityRemaining < capacityCost) {
    return rejected(state, "Not enough founder capacity");
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
  return accepted({
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
    summary: `${statusLabelForEvent(playbook)} playbook completed`,
    relatedId: customer.id,
    gameMinute: state.clock.gameMinute,
  }], rules);
}

function sendNpsSurvey(
  state: GameState,
  customerId: string,
  rules: GameRules,
): CommandResult {
  const customer = state.records.customers[customerId];
  if (!customer) return rejected(state, "Customer does not exist");
  if (
    customer.lastSurveyAt !== undefined &&
    state.clock.gameMinute - customer.lastSurveyAt < 7 * 24 * 60
  ) {
    return rejected(
      state,
      "Wait seven days before surveying this customer again",
    );
  }

  const roll = randomInteger(state.seed, state.rngCursor, -1, 2);
  const score = Math.max(
    0,
    Math.min(
      10,
      Math.round((customer.health + customer.adoption) / 20) + roll.value,
    ),
  );
  const feedback = score >= 9
    ? "The team is seeing strong value and would recommend the product."
    : score >= 7
    ? "The product is useful, but the customer still sees room to improve."
    : "The customer needs a clearer path to value and faster support.";
  const healthChange = score >= 9 ? 3 : score <= 6 ? -4 : 0;

  return accepted({
    ...state,
    rngCursor: roll.cursor,
    history: {
      ...state.history,
      npsResponses: state.history.npsResponses + 1,
      npsScoreTotal: state.history.npsScoreTotal + score,
    },
    records: {
      ...state.records,
      customers: {
        ...state.records.customers,
        [customer.id]: {
          ...customer,
          health: Math.max(0, Math.min(100, customer.health + healthChange)),
          lastNpsScore: score,
          lastFeedback: feedback,
          lastSurveyAt: state.clock.gameMinute,
        },
      },
    },
  }, [{
    kind: "customer_feedback_received",
    summary: `NPS response received: ${score}/10`,
    relatedId: customer.id,
    gameMinute: state.clock.gameMinute,
  }], rules);
}

function createTicket(
  state: GameState,
  input: {
    customerId: string;
    channel: TicketChannel;
    priority: TicketPriority;
    title: string;
  },
  rules: GameRules,
): CommandResult {
  if (!state.unlocks.includes("customer_success")) {
    return rejected(state, "Unlock Customer Success to manage support");
  }
  const customer = state.records.customers[input.customerId];
  if (!customer) return rejected(state, "Customer does not exist");
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
    return rejected(state, "Resolve existing tickets before adding more");
  }
  const title = input.title.trim().replaceAll(/\s+/g, " ");
  if (title.length < 3 || title.length > 100) {
    return rejected(state, "Ticket title must contain 3 to 100 characters");
  }
  const sequence = state.sequences.ticket + 1;
  const id = `ticket_${sequence}`;
  const gameMinute = state.clock.gameMinute;
  const sla = TICKET_SLA_MINUTES[input.priority];
  return accepted({
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
          createdAt: gameMinute,
          responseDueAt: gameMinute + sla.response,
          resolutionDueAt: gameMinute + sla.resolution,
          escalated: false,
        },
      },
    },
  }, [{
    kind: "ticket_created",
    summary: `${input.priority} priority ticket opened: ${title}`,
    relatedId: id,
    gameMinute,
  }], rules);
}

function assignTicket(
  state: GameState,
  ticketId: string,
  ownerId: string | undefined,
  rules: GameRules,
): CommandResult {
  const ticket = state.records.tickets[ticketId];
  if (!ticket) return rejected(state, "Ticket does not exist");
  if (ticket.status === "resolved") {
    return rejected(state, "Resolved tickets cannot be reassigned");
  }
  const owner = ownerId ? state.records.supportReps[ownerId] : undefined;
  if (ownerId && !owner) {
    return rejected(state, "Support representative does not exist");
  }
  if (ticket.ownerId === ownerId) return rejected(state, "Owner is unchanged");
  const updated = { ...ticket };
  if (ownerId) updated.ownerId = ownerId;
  else delete updated.ownerId;
  return accepted({
    ...state,
    history: {
      ...state.history,
      ticketsResolved: state.history.ticketsResolved + 1,
      ticketResolutionMinutes: state.history.ticketResolutionMinutes +
        state.clock.gameMinute - ticket.createdAt,
    },
    records: {
      ...state.records,
      tickets: { ...state.records.tickets, [ticket.id]: updated },
    },
  }, [{
    kind: "ticket_assigned",
    summary: owner ? `Ticket assigned to ${owner.name}` : "Ticket unassigned",
    relatedId: ticket.id,
    gameMinute: state.clock.gameMinute,
  }], rules);
}

function acknowledgeTicket(
  state: GameState,
  ticketId: string,
  rules: GameRules,
): CommandResult {
  const ticket = state.records.tickets[ticketId];
  if (!ticket) return rejected(state, "Ticket does not exist");
  if (ticket.status !== "open") {
    return rejected(state, "Only open tickets can be acknowledged");
  }
  return accepted({
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
  }], rules);
}

function resolveTicket(
  state: GameState,
  ticketId: string,
  rules: GameRules,
): CommandResult {
  const ticket = state.records.tickets[ticketId];
  if (!ticket) return rejected(state, "Ticket does not exist");
  if (ticket.status !== "acknowledged") {
    return rejected(state, "Acknowledge the ticket before resolving it");
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
  return accepted({
    ...state,
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
  }], rules);
}

function hireSupportRep(
  state: GameState,
  nameInput: string,
  level: SalesRepLevel,
  rules: GameRules,
): CommandResult {
  if (!state.unlocks.includes("customer_success")) {
    return rejected(state, "Unlock Customer Success to hire support staff");
  }
  if (Object.keys(state.records.supportReps).length >= rules.maxSupportReps) {
    return rejected(state, "Support team is at capacity");
  }
  const name = nameInput.trim().replaceAll(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) {
    return rejected(
      state,
      "Representative name must contain 2 to 60 characters",
    );
  }
  const sequence = state.sequences.supportRep + 1;
  const id = `support_rep_${sequence}`;
  return accepted({
    ...state,
    sequences: { ...state.sequences, supportRep: sequence },
    records: {
      ...state.records,
      supportReps: {
        ...state.records.supportReps,
        [id]: {
          id,
          name,
          level,
          ...SUPPORT_REP_PROFILES[level],
          burnout: 0,
          hiredAt: state.clock.gameMinute,
        },
      },
    },
  }, [{
    kind: "support_rep_hired",
    summary: `${name} joined customer support`,
    relatedId: id,
    gameMinute: state.clock.gameMinute,
  }], rules);
}

function escalateTicket(
  state: GameState,
  ticketId: string,
  rules: GameRules,
): CommandResult {
  const ticket = state.records.tickets[ticketId];
  if (!ticket) return rejected(state, "Ticket does not exist");
  if (ticket.status === "resolved") {
    return rejected(state, "Ticket is resolved");
  }
  if (ticket.escalated) return rejected(state, "Ticket is already escalated");
  const gameMinute = state.clock.gameMinute;
  return accepted({
    ...state,
    records: {
      ...state.records,
      tickets: {
        ...state.records.tickets,
        [ticket.id]: {
          ...ticket,
          priority: "urgent",
          escalated: true,
          responseDueAt: ticket.status === "open"
            ? Math.min(ticket.responseDueAt, gameMinute + 60)
            : ticket.responseDueAt,
          resolutionDueAt: Math.min(
            ticket.resolutionDueAt,
            gameMinute + 4 * 60,
          ),
        },
      },
    },
  }, [{
    kind: "ticket_escalated",
    summary: `Ticket escalated: ${ticket.title}`,
    relatedId: ticket.id,
    gameMinute,
  }], rules);
}

function declareIncident(
  state: GameState,
  ticketId: string,
  severity: IncidentSeverity,
  rules: GameRules,
): CommandResult {
  const ticket = state.records.tickets[ticketId];
  if (!ticket) return rejected(state, "Ticket does not exist");
  if (!ticket.escalated || ticket.status === "resolved") {
    return rejected(
      state,
      "Escalate an active ticket before declaring an incident",
    );
  }
  if (
    Object.values(state.records.incidents).some((incident) =>
      incident.ticketId === ticket.id && incident.status === "investigating"
    )
  ) {
    return rejected(state, "This ticket already has an active incident");
  }
  if (Object.keys(state.records.incidents).length >= rules.maxIncidentRecords) {
    return rejected(state, "Incident history is full");
  }
  const sequence = state.sequences.incident + 1;
  const id = `incident_${sequence}`;
  return accepted({
    ...state,
    sequences: { ...state.sequences, incident: sequence },
    records: {
      ...state.records,
      incidents: {
        ...state.records.incidents,
        [id]: {
          id,
          ticketId: ticket.id,
          customerId: ticket.customerId,
          title: ticket.title,
          severity,
          status: "investigating",
          createdAt: state.clock.gameMinute,
        },
      },
    },
  }, [{
    kind: "incident_declared",
    summary: `${severity} incident declared: ${ticket.title}`,
    relatedId: id,
    gameMinute: state.clock.gameMinute,
  }], rules);
}

function resolveIncident(
  state: GameState,
  incidentId: string,
  rules: GameRules,
): CommandResult {
  const incident = state.records.incidents[incidentId];
  if (!incident) return rejected(state, "Incident does not exist");
  if (incident.status === "resolved") {
    return rejected(state, "Incident is resolved");
  }
  const ticket = state.records.tickets[incident.ticketId];
  if (ticket?.status !== "resolved") {
    return rejected(state, "Resolve the linked ticket first");
  }
  return accepted({
    ...state,
    records: {
      ...state.records,
      incidents: {
        ...state.records.incidents,
        [incident.id]: {
          ...incident,
          status: "resolved",
          resolvedAt: state.clock.gameMinute,
        },
      },
    },
  }, [{
    kind: "incident_resolved",
    summary: `Incident resolved: ${incident.title}`,
    relatedId: incident.id,
    gameMinute: state.clock.gameMinute,
  }], rules);
}

function statusLabelForEvent(value: string): string {
  return value.replaceAll("_", " ").replace(
    /^./,
    (letter) => letter.toUpperCase(),
  );
}

function followUpLead(
  state: GameState,
  lead: Lead,
  rules: GameRules,
): CommandResult {
  if (lead.status !== "contacted" && lead.status !== "cold") {
    return rejected(state, "Only contacted or cold leads need follow-up");
  }
  const capacityCost = 15;
  if (state.company.founderCapacityRemaining < capacityCost) {
    return rejected(state, "Not enough founder capacity");
  }

  const engagementGain = randomInteger(state.seed, state.rngCursor, 8, 18);
  const gameMinute = state.clock.gameMinute;
  const nextState: GameState = {
    ...state,
    rngCursor: engagementGain.cursor,
    company: {
      ...state.company,
      founderCapacityRemaining: state.company.founderCapacityRemaining -
        capacityCost,
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
  };
  return accepted(nextState, [{
    kind: "lead_contacted",
    summary: `Followed up with ${lead.firstName} ${lead.lastName}`,
    relatedId: lead.id,
    gameMinute,
  }], rules);
}

function disqualifyLead(
  state: GameState,
  lead: Lead,
  rules: GameRules,
): CommandResult {
  if (["converted", "disqualified"].includes(lead.status)) {
    return rejected(state, "This lead is already resolved");
  }

  const gameMinute = state.clock.gameMinute;
  const nextState: GameState = {
    ...state,
    records: {
      ...state.records,
      leads: {
        ...state.records.leads,
        [lead.id]: {
          ...lead,
          status: "disqualified",
          lastActivityAt: gameMinute,
        },
      },
    },
  };
  return accepted(nextState, [{
    kind: "lead_disqualified",
    summary: `${lead.firstName} ${lead.lastName} disqualified`,
    relatedId: lead.id,
    gameMinute,
  }], rules);
}

function requestReferrals(
  state: GameState,
  rules: GameRules,
): CommandResult {
  if (!state.unlocks.includes("marketing")) {
    return rejected(state, "Retain 3 customers to unlock referrals");
  }
  const capacityCost = 60;
  if (state.company.founderCapacityRemaining < capacityCost) {
    return rejected(state, "Not enough founder capacity");
  }

  const sequence = Math.max(
    state.sequences.company,
    state.sequences.lead,
  ) + 1;
  const generated = generateLead(
    state.seed,
    state.rngCursor,
    sequence,
    state.clock.gameMinute,
  );
  const lead: Lead = {
    ...generated.lead,
    source: "referral",
    fit: Math.min(100, generated.lead.fit + 10),
    engagement: Math.min(100, generated.lead.engagement + 10),
  };
  const nextState: GameState = {
    ...state,
    rngCursor: generated.nextCursor,
    company: {
      ...state.company,
      founderCapacityRemaining: state.company.founderCapacityRemaining -
        capacityCost,
    },
    sequences: {
      ...state.sequences,
      company: sequence,
      lead: sequence,
    },
    records: {
      ...state.records,
      companies: {
        ...state.records.companies,
        [generated.company.id]: generated.company,
      },
      leads: {
        ...state.records.leads,
        [lead.id]: lead,
      },
    },
  };

  return accepted(nextState, [{
    kind: "lead_created",
    summary: `Customer referral from ${generated.company.name}`,
    relatedId: lead.id,
    gameMinute: state.clock.gameMinute,
  }], rules);
}

function advanceDeal(
  state: GameState,
  dealId: string,
  rules: GameRules,
): CommandResult {
  const deal = state.records.deals[dealId];
  if (!deal) return rejected(state, "Deal does not exist");
  if (deal.stage === "won" || deal.stage === "lost") {
    return rejected(state, "This deal is already closed");
  }

  const stage = nextDealStage(deal.stage);
  if (!stage) return rejected(state, "Deal cannot advance");
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
    const nextState: GameState = {
      ...state,
      records: {
        ...state.records,
        deals: {
          ...state.records.deals,
          [deal.id]: { ...deal, stage, probability, updatedAt: gameMinute },
        },
      },
    };
    return accepted(nextState, [{
      kind: "deal_advanced",
      summary: `Deal advanced to ${stage}`,
      relatedId: deal.id,
      gameMinute,
    }], rules);
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

  const lead = state.records.leads[deal.leadId];
  const nextState: GameState = {
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
  };

  return accepted(nextState, events, rules);
}

export function applyCommand(
  state: GameState,
  command: GameCommand,
  rules: GameRules = DEFAULT_RULES,
): CommandResult {
  if (command.type === "new_company") {
    const state = createInitialState({
      seed: command.seed,
      now: command.now,
      companyName: command.companyName,
    });
    return { accepted: true, state, events: [] };
  }
  if (state.clock.status === "bankrupt") {
    return rejected(state, "The company is bankrupt");
  }
  if (state.clock.status === "crisis" && command.type !== "resume_crisis") {
    return rejected(state, "Resolve or resume the financial crisis first");
  }

  switch (command.type) {
    case "contact_lead": {
      const lead = state.records.leads[command.leadId];
      return lead
        ? contactLead(state, lead, command.channel, rules)
        : rejected(state, "Lead does not exist");
    }
    case "follow_up_lead": {
      const lead = state.records.leads[command.leadId];
      return lead
        ? followUpLead(state, lead, rules)
        : rejected(state, "Lead does not exist");
    }
    case "request_referrals":
      return requestReferrals(state, rules);
    case "create_campaign":
      return createCampaign(state, command, rules);
    case "set_campaign_status":
      return setCampaignStatus(
        state,
        command.campaignId,
        command.status,
        rules,
      );
    case "update_campaign":
      return updateCampaign(state, command, rules);
    case "duplicate_campaign":
      return duplicateCampaign(state, command.campaignId, rules);
    case "archive_campaign":
      return archiveCampaign(state, command.campaignId, rules);
    case "rename_company": {
      const name = command.name.trim().replaceAll(/\s+/g, " ");
      if (name.length < 2) {
        return rejected(state, "Company name must be at least 2 characters");
      }
      if (name.length > 60) {
        return rejected(state, "Company name must be 60 characters or fewer");
      }
      if (name === state.company.name) {
        return rejected(state, "Company already uses this name");
      }
      return accepted(
        {
          ...state,
          company: { ...state.company, name },
        },
        [],
        rules,
      );
    }
    case "set_reduced_motion":
      if (command.enabled === state.preferences.reducedMotion) {
        return rejected(state, "Reduced motion preference is unchanged");
      }
      return accepted(
        {
          ...state,
          preferences: {
            ...state.preferences,
            reducedMotion: command.enabled,
          },
        },
        [],
        rules,
      );
    case "set_sound_enabled":
      if (command.enabled === state.preferences.soundEnabled) {
        return rejected(state, "Notification sound preference is unchanged");
      }
      return accepted(
        {
          ...state,
          preferences: { ...state.preferences, soundEnabled: command.enabled },
        },
        [],
        rules,
      );
    case "set_music_enabled":
      if (command.enabled === state.preferences.musicEnabled) {
        return rejected(state, "Music preference is unchanged");
      }
      return accepted(
        {
          ...state,
          preferences: { ...state.preferences, musicEnabled: command.enabled },
        },
        [],
        rules,
      );
    case "set_music_volume":
      if (
        !Number.isInteger(command.volume) || command.volume < 0 ||
        command.volume > 100
      ) {
        return rejected(state, "Music volume must be between 0 and 100");
      }
      if (command.volume === state.preferences.musicVolume) {
        return rejected(state, "Music volume is unchanged");
      }
      return accepted(
        {
          ...state,
          preferences: { ...state.preferences, musicVolume: command.volume },
        },
        [],
        rules,
      );
    case "set_pipeline_view":
      if (command.view === state.preferences.pipelineView) {
        return rejected(state, "Pipeline view is unchanged");
      }
      return accepted(
        {
          ...state,
          preferences: { ...state.preferences, pipelineView: command.view },
        },
        [],
        rules,
      );
    case "qualify_lead": {
      const lead = state.records.leads[command.leadId];
      return lead
        ? qualifyLead(state, lead, rules)
        : rejected(state, "Lead does not exist");
    }
    case "disqualify_lead": {
      const lead = state.records.leads[command.leadId];
      return lead
        ? disqualifyLead(state, lead, rules)
        : rejected(state, "Lead does not exist");
    }
    case "advance_deal":
      return advanceDeal(state, command.dealId, rules);
    case "update_deal":
      return updateDeal(state, command, rules);
    case "lose_deal":
      return loseDeal(state, command.dealId, command.reason, rules);
    case "hire_sales_rep":
      return hireSalesRep(
        state,
        command.name,
        command.level,
        command.territory,
        command.monthlyTargetCents,
        rules,
      );
    case "assign_deal":
      return assignDeal(state, command.dealId, command.ownerId, rules);
    case "train_sales_rep":
      return trainSalesRep(state, command.salesRepId, rules);
    case "bulk_advance_deals":
      return bulkDeals(
        state,
        command.dealIds,
        (current, dealId) => advanceDeal(current, dealId, rules),
      );
    case "bulk_assign_deals":
      return bulkDeals(
        state,
        command.dealIds,
        (current, dealId) =>
          assignDeal(current, dealId, command.ownerId, rules),
      );
    case "route_leads":
      return routeLeads(state, rules);
    case "create_quote":
      return createQuote(state, command, rules);
    case "update_quote":
      return updateQuote(state, command, rules);
    case "set_quote_status":
      return setQuoteStatus(state, command.quoteId, command.status, rules);
    case "accept_quote":
      return acceptQuote(state, command.quoteId, rules);
    case "complete_task": {
      const task = state.records.tasks[command.taskId];
      if (!task) return rejected(state, "Task does not exist");
      if (task.status !== "open") return rejected(state, "Task is not open");
      if (
        task.kind === "onboarding" &&
        state.records.customers[task.relatedId]
      ) {
        return completeCustomerOnboarding(state, task.relatedId, rules);
      }
      const gameMinute = state.clock.gameMinute;
      const nextState: GameState = {
        ...state,
        records: {
          ...state.records,
          tasks: {
            ...state.records.tasks,
            [task.id]: {
              ...task,
              status: "completed",
              completedAt: gameMinute,
            },
          },
        },
      };
      return accepted(nextState, [{
        kind: "task_completed",
        summary: task.title,
        relatedId: task.id,
        gameMinute,
      }], rules);
    }
    case "complete_customer_onboarding":
      return completeCustomerOnboarding(state, command.customerId, rules);
    case "customer_check_in":
      return customerCheckIn(state, command.customerId, rules);
    case "renew_customer":
      return renewCustomer(state, command.customerId, rules);
    case "expand_customer":
      return expandCustomer(state, command.customerId, rules);
    case "hire_success_rep":
      return hireSuccessRep(state, command.name, command.level, rules);
    case "assign_customer":
      return assignCustomer(state, command.customerId, command.ownerId, rules);
    case "run_success_playbook":
      return runSuccessPlaybook(
        state,
        command.customerId,
        command.playbook,
        rules,
      );
    case "send_nps_survey":
      return sendNpsSurvey(state, command.customerId, rules);
    case "create_ticket":
      return createTicket(state, command, rules);
    case "assign_ticket":
      return assignTicket(state, command.ticketId, command.ownerId, rules);
    case "acknowledge_ticket":
      return acknowledgeTicket(state, command.ticketId, rules);
    case "resolve_ticket":
      return resolveTicket(state, command.ticketId, rules);
    case "hire_support_rep":
      return hireSupportRep(state, command.name, command.level, rules);
    case "escalate_ticket":
      return escalateTicket(state, command.ticketId, rules);
    case "declare_incident":
      return declareIncident(state, command.ticketId, command.severity, rules);
    case "resolve_incident":
      return resolveIncident(state, command.incidentId, rules);
    case "resume_crisis":
      if (state.clock.status !== "crisis") {
        return rejected(state, "The company is not in a financial crisis");
      }
      return accepted(
        {
          ...state,
          clock: { gameMinute: state.clock.gameMinute, status: "active" },
        },
        [],
        rules,
      );
    default:
      return applyPlatformCommand(state, command, rules) ??
        rejected(state, "Unsupported command");
  }
}
