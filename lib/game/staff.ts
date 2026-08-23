import type { DomainEvent, GameRules, GameState } from "./types.ts";
import {
  acknowledgeTicketWork,
  advanceDealWork,
  assignCustomerWork,
  assignLeadWork,
  assignTicketWork,
  closeLossRiskPercent,
  completeOnboardingWork,
  contactLeadWork,
  customerCheckInWork,
  followUpLeadWork,
  qualifyLeadWork,
  resolveTicketWork,
  runSuccessPlaybookWork,
  salesWorkload,
  successWorkload,
  supportWorkload,
  type WorkResult,
} from "./work.ts";

function hoursCrossed(startMinute: number, endMinute: number): number {
  return Math.max(
    0,
    Math.floor(endMinute / 60) - Math.floor(startMinute / 60),
  );
}

function actionsThisHour(burnout: number, senior: boolean): number {
  if (burnout >= 80) return 0;
  if (senior && burnout < 40) return 2;
  return 1;
}

function applyWork(
  current: { state: GameState; events: DomainEvent[] },
  result: WorkResult,
): boolean {
  if (!result.ok) return false;
  current.state = result.state;
  current.events.push(...result.events);
  return true;
}

function byCreated<T extends { id: string; createdAt: number }>(
  left: T,
  right: T,
): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

function workSalesRep(
  current: { state: GameState; events: DomainEvent[] },
  repId: string,
  rules: GameRules,
): boolean {
  const state = current.state;
  const rep = state.records.salesReps[repId];
  if (!rep) return false;
  const ownedLeads = Object.values(state.records.leads).filter((lead) =>
    lead.ownerId === rep.id
  ).sort(byCreated);
  const fresh = ownedLeads.find((lead) => lead.status === "new");
  if (fresh) {
    return applyWork(
      current,
      contactLeadWork(state, fresh.id, "email", {
        consumeFounderCapacity: false,
        paced: true,
      }),
    );
  }
  const readyToQualify = ownedLeads.find((lead) =>
    lead.status === "contacted" && lead.engagement >= 50 &&
    state.clock.gameMinute - lead.lastActivityAt >= 60
  );
  if (readyToQualify) {
    return applyWork(current, qualifyLeadWork(state, readyToQualify.id));
  }
  const needsFollowUp = ownedLeads.find((lead) =>
    (lead.status === "contacted" || lead.status === "cold") &&
    state.clock.gameMinute - lead.lastActivityAt >= 4 * 60
  );
  if (needsFollowUp) {
    return applyWork(
      current,
      followUpLeadWork(state, needsFollowUp.id, {
        consumeFounderCapacity: false,
        paced: true,
      }),
    );
  }

  const readyDeals = Object.values(state.records.deals).filter((deal) =>
    deal.ownerId === rep.id && deal.stage !== "won" &&
    deal.stage !== "lost" &&
    state.clock.gameMinute - deal.updatedAt >= 8 * 60
  ).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const actionableDeal = readyDeals.find((deal) =>
    deal.stage !== "negotiation" ||
    closeLossRiskPercent(state.records.leads[deal.leadId]?.engagement ?? 0) ===
      0
  );
  if (actionableDeal) {
    return applyWork(
      current,
      advanceDealWork(state, actionableDeal.id, rules),
    );
  }
  const blockedNegotiation = readyDeals.find((deal) => {
    if (deal.stage !== "negotiation") return false;
    const lead = state.records.leads[deal.leadId];
    return lead?.status === "qualified" &&
      state.clock.gameMinute - lead.lastActivityAt >= 4 * 60;
  });
  if (blockedNegotiation) {
    return applyWork(
      current,
      followUpLeadWork(state, blockedNegotiation.leadId, {
        consumeFounderCapacity: false,
        paced: true,
      }),
    );
  }

  if (salesWorkload(state, rep.id) < rep.dealCapacity) {
    const unassigned = Object.values(state.records.leads).filter((lead) =>
      !lead.ownerId && ["new", "contacted", "cold"].includes(lead.status) &&
      (rep.territory === "all" ||
        state.records.companies[lead.companyId]?.region === rep.territory)
    ).sort(byCreated)[0];
    if (unassigned) {
      return applyWork(current, assignLeadWork(state, unassigned.id, rep.id));
    }
  }
  return false;
}

function workSuccessRep(
  current: { state: GameState; events: DomainEvent[] },
  repId: string,
): boolean {
  const state = current.state;
  const rep = state.records.successReps[repId];
  if (!rep) return false;
  const owned = Object.values(state.records.customers).filter((customer) =>
    customer.ownerId === rep.id
  ).sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const onboarding = owned.find((customer) =>
    customer.lifecycle === "onboarding" &&
    Object.values(state.records.tasks).some((task) =>
      task.kind === "onboarding" && task.relatedId === customer.id &&
      task.status === "open"
    )
  );
  if (onboarding) {
    return applyWork(current, completeOnboardingWork(state, onboarding.id));
  }
  const atRisk = owned.find((customer) => customer.lifecycle === "at_risk");
  if (atRisk) {
    return applyWork(
      current,
      runSuccessPlaybookWork(state, atRisk.id, "recovery", false),
    );
  }
  const neglected = owned.find((customer) =>
    state.clock.gameMinute - customer.lastSuccessAt >=
      (customer.lifecycle === "onboarding" ? 2 * 24 * 60 : 7 * 24 * 60)
  );
  if (neglected) {
    return applyWork(current, customerCheckInWork(state, neglected.id, false));
  }
  const lowAdoption = owned.find((customer) => customer.adoption < 50);
  if (lowAdoption) {
    return applyWork(
      current,
      runSuccessPlaybookWork(state, lowAdoption.id, "adoption", false),
    );
  }
  if (successWorkload(state, rep.id) < rep.accountCapacity) {
    const unassigned = Object.values(state.records.customers).filter((
      customer,
    ) => !customer.ownerId).sort((a, b) =>
      a.startedAt - b.startedAt || a.id.localeCompare(b.id)
    )[0];
    if (unassigned) {
      return applyWork(
        current,
        assignCustomerWork(state, unassigned.id, rep.id),
      );
    }
  }
  return false;
}

function workSupportRep(
  current: { state: GameState; events: DomainEvent[] },
  repId: string,
): boolean {
  const state = current.state;
  const rep = state.records.supportReps[repId];
  if (!rep) return false;
  const owned = Object.values(state.records.tickets).filter((ticket) =>
    ticket.ownerId === rep.id && ticket.status !== "resolved" &&
    !ticket.escalated
  ).sort(byCreated);
  const open = owned.find((ticket) => ticket.status === "open");
  if (open) {
    return applyWork(current, acknowledgeTicketWork(state, open.id));
  }
  const ready = owned.find((ticket) =>
    ticket.status === "acknowledged" &&
    state.clock.gameMinute - (ticket.acknowledgedAt ?? ticket.createdAt) >=
      2 * 60
  );
  if (ready) {
    return applyWork(current, resolveTicketWork(state, ready.id));
  }
  if (supportWorkload(state, rep.id) < rep.ticketCapacity) {
    const unassigned = Object.values(state.records.tickets).filter((ticket) =>
      !ticket.ownerId && ticket.status !== "resolved" && !ticket.escalated
    ).sort(byCreated)[0];
    if (unassigned) {
      const assigned = assignTicketWork(state, unassigned.id, rep.id);
      if (!assigned.ok) {
        return false;
      }
      const acknowledged = acknowledgeTicketWork(
        assigned.state,
        unassigned.id,
      );
      if (!acknowledged.ok) {
        return applyWork(current, assigned);
      }
      return applyWork(current, {
        ok: true,
        state: acknowledged.state,
        events: [...assigned.events, ...acknowledged.events],
      });
    }
  }
  return false;
}

export function applyStaffWork(
  state: GameState,
  startMinute: number,
  endMinute: number,
  rules: GameRules,
): { state: GameState; events: DomainEvent[] } {
  const hours = hoursCrossed(startMinute, endMinute);
  if (hours === 0) return { state, events: [] };

  const current = { state, events: [] as DomainEvent[] };
  const salesIds = Object.keys(current.state.records.salesReps).sort();
  const successIds = Object.keys(current.state.records.successReps).sort();
  const supportIds = Object.keys(current.state.records.supportReps).sort();
  if (
    salesIds.length === 0 && successIds.length === 0 && supportIds.length === 0
  ) {
    return current;
  }

  for (let hour = 0; hour < hours; hour += 1) {
    for (const repId of salesIds) {
      const rep = current.state.records.salesReps[repId];
      if (!rep) continue;
      const budget = actionsThisHour(rep.burnout, rep.level === "senior");
      for (let action = 0; action < budget; action += 1) {
        if (!workSalesRep(current, repId, rules)) break;
      }
    }
    for (const repId of successIds) {
      const rep = current.state.records.successReps[repId];
      if (!rep) continue;
      const budget = actionsThisHour(rep.burnout, rep.level === "senior");
      for (let action = 0; action < budget; action += 1) {
        if (!workSuccessRep(current, repId)) break;
      }
    }
    for (const repId of supportIds) {
      const rep = current.state.records.supportReps[repId];
      if (!rep) continue;
      const budget = actionsThisHour(rep.burnout, rep.level === "senior");
      for (let action = 0; action < budget; action += 1) {
        if (!workSupportRep(current, repId)) break;
      }
    }
  }

  return current;
}
