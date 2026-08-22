import type { DomainEvent, GameRules, GameState } from "./types.ts";

export function projectEvents(
  state: GameState,
  events: readonly DomainEvent[],
  rules: GameRules,
): GameState {
  if (events.length === 0) return state;

  let activitySequence = state.sequences.activity;
  const activities = [...state.recentActivities];
  const history = { ...state.history };

  for (const event of events) {
    activitySequence += 1;
    activities.push({
      id: `activity_${activitySequence}`,
      kind: event.kind,
      summary: event.summary,
      ...(event.relatedId ? { relatedId: event.relatedId } : {}),
      gameMinute: event.gameMinute,
    });

    switch (event.kind) {
      case "lead_created":
        history.leadsCreated += 1;
        break;
      case "lead_qualified":
        history.leadsQualified += 1;
        break;
      case "deal_won":
        history.dealsWon += 1;
        break;
      case "deal_lost":
        history.dealsLost += 1;
        break;
      case "customer_churned":
        history.customersLost += 1;
        history.churnedMrrCents += event.amountCents ?? 0;
        break;
      case "customer_renewed":
        history.customersRenewed += 1;
        history.renewalMrrCents += event.amountCents ?? 0;
        break;
      case "customer_expanded":
        history.expansionMrrCents += event.amountCents ?? 0;
        break;
      case "ticket_sla_breached":
        history.ticketsBreached += 1;
        break;
      case "revenue_accrued":
        history.revenueAccruedCents += event.amountCents ?? 0;
        break;
      case "expense_accrued":
        history.expensesAccruedCents += event.amountCents ?? 0;
        break;
    }
  }

  const overflow = Math.max(0, activities.length - rules.maxRecentActivities);
  if (overflow > 0) {
    activities.splice(0, overflow);
    history.activitiesArchived += overflow;
  }

  return {
    ...state,
    sequences: { ...state.sequences, activity: activitySequence },
    recentActivities: activities,
    history,
  };
}
