import { generateLead } from "./catalog.ts";
import { projectEvents } from "./events.ts";
import { DEFAULT_RULES } from "./state.ts";
import type {
  AdvanceResult,
  AdvanceSummary,
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
      if (task.kind === "follow_up" && lead) {
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
  if (elapsedHours > 0) {
    for (const rep of Object.values(salesReps)) {
      const leadLoad = Object.values(leads).filter((lead) =>
        lead.ownerId === rep.id &&
        ["new", "contacted", "cold"].includes(lead.status)
      ).length;
      const dealLoad = Object.values(nextState.records.deals).filter((deal) =>
        deal.ownerId === rep.id && deal.stage !== "won" && deal.stage !== "lost"
      ).length;
      const overloaded = leadLoad + dealLoad > rep.dealCapacity;
      salesReps[rep.id] = {
        ...rep,
        burnout: Math.max(
          0,
          Math.min(100, rep.burnout + elapsedHours * (overloaded ? 2 : -1)),
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

  nextState = {
    ...nextState,
    records: { ...nextState.records, leads, quotes, salesReps },
  };

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
    state: projectEvents(nextState, events, rules),
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
  let nextState = state;
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

  return { state: nextState, events, summary };
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
  const elapsedGameMinutes = Math.floor(
    acceptedRealMilliseconds / rules.realMillisecondsPerGameMinute,
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
