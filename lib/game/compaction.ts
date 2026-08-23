import type { GameRules, GameState } from "./types.ts";

function oldestFirst(
  left: { id: string; createdAt: number },
  right: { id: string; createdAt: number },
): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

export function compactGameState(
  state: GameState,
  rules: GameRules,
): GameState {
  const deals = { ...state.records.deals };
  const quotedDealIds = new Set(
    Object.values(state.records.quotes).map((quote) => quote.dealId),
  );
  const dealOverflow = Math.max(
    0,
    Object.keys(deals).length - rules.maxDealRecords,
  );
  const removedDealIds = new Set(
    Object.values(deals)
      .filter((deal) =>
        (deal.stage === "won" || deal.stage === "lost") &&
        !quotedDealIds.has(deal.id)
      )
      .sort((left, right) =>
        left.updatedAt - right.updatedAt || left.id.localeCompare(right.id)
      )
      .slice(0, dealOverflow)
      .map((deal) => deal.id),
  );
  for (const id of removedDealIds) delete deals[id];

  const referencedLeadIds = new Set([
    ...Object.values(deals).map((deal) => deal.leadId),
    ...Object.values(state.records.customers).map((customer) =>
      customer.primaryLeadId
    ),
  ]);
  const leads = { ...state.records.leads };
  const leadOverflow = Math.max(
    0,
    Object.keys(leads).length - rules.maxLeadRecords,
  );
  const removedLeadIds = new Set(
    Object.values(leads)
      .filter((lead) =>
        !referencedLeadIds.has(lead.id) &&
        (lead.status === "cold" ||
          lead.status === "disqualified" ||
          lead.status === "converted")
      )
      .sort(oldestFirst)
      .slice(0, leadOverflow)
      .map((lead) => lead.id),
  );
  for (const id of removedLeadIds) delete leads[id];

  const tasks = { ...state.records.tasks };
  for (const task of Object.values(tasks)) {
    if (
      removedLeadIds.has(task.relatedId) ||
      removedDealIds.has(task.relatedId)
    ) {
      delete tasks[task.id];
    }
  }
  const taskOverflow = Math.max(
    0,
    Object.keys(tasks).length - rules.maxTaskRecords,
  );
  const historicalTasks = Object.values(tasks)
    .filter((task) => task.status !== "open")
    .sort(oldestFirst)
    .slice(0, taskOverflow);
  for (const task of historicalTasks) delete tasks[task.id];

  const referencedCompanyIds = new Set([
    ...Object.values(leads).map((lead) => lead.companyId),
    ...Object.values(deals).map((deal) => deal.companyId),
    ...Object.values(state.records.customers).map((customer) =>
      customer.companyId
    ),
  ]);
  const companies = Object.fromEntries(
    Object.entries(state.records.companies).filter(([id]) =>
      referencedCompanyIds.has(id)
    ),
  );

  if (
    Object.keys(deals).length === Object.keys(state.records.deals).length &&
    Object.keys(leads).length === Object.keys(state.records.leads).length &&
    Object.keys(tasks).length === Object.keys(state.records.tasks).length &&
    Object.keys(companies).length ===
      Object.keys(state.records.companies).length
  ) {
    return state;
  }

  return {
    ...state,
    records: {
      ...state.records,
      companies,
      leads,
      deals,
      tasks,
    },
  };
}
