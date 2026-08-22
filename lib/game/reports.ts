import type { GameState } from "./types.ts";

export interface RetentionReport {
  grossRetentionPercent: number;
  netRetentionPercent: number;
  churnedMrrCents: number;
  expansionMrrCents: number;
  averageNps: number | null;
  slaAttainmentPercent: number;
  averageResolutionMinutes: number | null;
  openTickets: number;
  overloadedReps: number;
}

export function retentionReport(state: GameState): RetentionReport {
  const history = state.history;
  const retainedBase = state.company.mrrCents + history.churnedMrrCents -
    history.expansionMrrCents;
  const baseline = Math.max(1, retainedBase + history.churnedMrrCents);
  const totalSlaChecks = history.ticketsResolved + history.ticketsBreached;
  const openTickets =
    Object.values(state.records.tickets).filter((ticket) =>
      ticket.status !== "resolved"
    ).length;
  const overloadedReps =
    Object.values(state.records.successReps).filter((rep) => rep.burnout >= 60)
      .length +
    Object.values(state.records.supportReps).filter((rep) => rep.burnout >= 60)
      .length;

  return {
    grossRetentionPercent: Math.max(
      0,
      Math.round((baseline - history.churnedMrrCents) / baseline * 100),
    ),
    netRetentionPercent: Math.max(
      0,
      Math.round(
        (baseline - history.churnedMrrCents + history.expansionMrrCents) /
          baseline * 100,
      ),
    ),
    churnedMrrCents: history.churnedMrrCents,
    expansionMrrCents: history.expansionMrrCents,
    averageNps: history.npsResponses
      ? Math.round(history.npsScoreTotal / history.npsResponses * 10) / 10
      : null,
    slaAttainmentPercent: totalSlaChecks
      ? Math.max(
        0,
        Math.round(
          (totalSlaChecks - history.ticketsBreached) / totalSlaChecks * 100,
        ),
      )
      : 100,
    averageResolutionMinutes: history.ticketsResolved
      ? Math.round(history.ticketResolutionMinutes / history.ticketsResolved)
      : null,
    openTickets,
    overloadedReps,
  };
}

export function analyticsReport(state: GameState) {
  const leads = Math.max(1, state.history.leadsCreated);
  const qualified = state.history.leadsQualified;
  const decidedDeals = state.history.dealsWon + state.history.dealsLost;
  const attributed = Object.values(state.records.customers).filter((customer) =>
    state.records.leads[customer.primaryLeadId]?.campaignId
  );
  const weightedAttributionCents = attributed.reduce(
    (total, customer) => total + Math.round(customer.monthlyValueCents * 0.7),
    0,
  );
  const forecastCents = Object.values(state.records.deals).filter((deal) =>
    deal.stage !== "won" && deal.stage !== "lost"
  ).reduce(
    (total, deal) =>
      total + Math.round(deal.monthlyValueCents * deal.probability / 100),
    0,
  );
  return {
    qualificationPercent: Math.round(qualified / leads * 100),
    winRatePercent: decidedDeals
      ? Math.round(state.history.dealsWon / decidedDeals * 100)
      : 0,
    activeCohortRetentionPercent: retentionReport(state).grossRetentionPercent,
    weightedAttributionCents,
    forecastVarianceCents: state.company.mrrCents - forecastCents,
    automationErrorPercent: state.platform.automationRunsArchived
      ? Math.round(
        state.platform.automationErrorsArchived /
          state.platform.automationRunsArchived * 100,
      )
      : 0,
  };
}
