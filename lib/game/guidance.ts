import { DEFAULT_RULES } from "./state.ts";
import type { Deal, GameState, Lead, Ticket } from "./types.ts";

export type GuidanceWorkspace =
  | "dashboard"
  | "leads"
  | "pipeline"
  | "customers";

export interface GuidanceRecommendation {
  targetId: string;
  workspace: GuidanceWorkspace;
  actionLabel: string;
  reason: string;
}

const HIGH_INTENT = 70;
const STALE_LEAD_MINUTES = 4 * 60;
const CONTACT_CAPACITY_MINUTES = 10;
const FOLLOW_UP_CAPACITY_MINUTES = 15;
const RECOVERY_CAPACITY_MINUTES = 35;

function byLeadAge(a: Lead, b: Lead): number {
  return a.lastActivityAt - b.lastActivityAt ||
    a.createdAt - b.createdAt ||
    a.id.localeCompare(b.id);
}

function ticketUrgency(ticket: Ticket): number {
  return {
    urgent: 0,
    high: 1,
    normal: 2,
    low: 3,
  }[ticket.priority];
}

function byTicketUrgency(a: Ticket, b: Ticket): number {
  const aDue = a.status === "open" ? a.responseDueAt : a.resolutionDueAt;
  const bDue = b.status === "open" ? b.responseDueAt : b.resolutionDueAt;
  return ticketUrgency(a) - ticketUrgency(b) ||
    aDue - bDue ||
    a.createdAt - b.createdAt ||
    a.id.localeCompare(b.id);
}

function dealIsEligible(state: GameState, deal: Deal): boolean {
  if (deal.stage === "won" || deal.stage === "lost") return false;
  if (deal.stage !== "negotiation") return true;
  return (state.records.leads[deal.leadId]?.engagement ?? 0) >=
    DEFAULT_RULES.safeCloseIntent;
}

function companyNameForLead(state: GameState, lead: Lead): string {
  return state.records.companies[lead.companyId]?.name ?? "this lead";
}

function capacityShortage(reason: string): GuidanceRecommendation {
  return {
    targetId: "company",
    workspace: "dashboard",
    actionLabel: "Restore founder capacity",
    reason,
  };
}

export function selectGuidance(
  state: GameState,
): GuidanceRecommendation {
  const ticket = Object.values(state.records.tickets)
    .filter((entry) => entry.status !== "resolved")
    .sort(byTicketUrgency)[0];
  if (ticket) {
    return {
      targetId: ticket.id,
      workspace: "customers",
      actionLabel: ticket.status === "open"
        ? "Acknowledge ticket"
        : "Resolve ticket",
      reason: ticket.priority === "urgent"
        ? "An urgent support request needs immediate attention."
        : "The support queue has an open customer request.",
    };
  }

  const atRisk = Object.values(state.records.customers)
    .filter((customer) => customer.lifecycle === "at_risk")
    .sort((a, b) =>
      a.health - b.health ||
      a.lastSuccessAt - b.lastSuccessAt ||
      a.id.localeCompare(b.id)
    )[0];
  if (atRisk) {
    if (
      !atRisk.ownerId &&
      state.company.founderCapacityRemaining < RECOVERY_CAPACITY_MINUTES
    ) {
      return capacityShortage(
        "Founder capacity is too low to recover the at-risk account.",
      );
    }
    return {
      targetId: atRisk.id,
      workspace: "customers",
      actionLabel: "Run recovery playbook",
      reason: "This account is at risk and has the lowest customer health.",
    };
  }

  const onboarding = Object.values(state.records.customers)
    .filter((customer) => customer.lifecycle === "onboarding")
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))[0];
  if (onboarding) {
    return {
      targetId: onboarding.id,
      workspace: "customers",
      actionLabel: "Complete onboarding",
      reason: "A new customer is waiting to finish onboarding.",
    };
  }

  const leads = Object.values(state.records.leads).sort(byLeadAge);
  const firstLead = leads.find((lead) => lead.status === "new");
  if (
    firstLead &&
    (state.onboarding.step === "inspect_lead" ||
      state.onboarding.step === "contact_lead")
  ) {
    if (
      state.onboarding.step === "contact_lead" &&
      state.company.founderCapacityRemaining < CONTACT_CAPACITY_MINUTES
    ) {
      return capacityShortage(
        "Founder capacity is too low for the first lead outreach.",
      );
    }
    return {
      targetId: firstLead.id,
      workspace: "leads",
      actionLabel: "Inspect and contact lead",
      reason: `${
        companyNameForLead(state, firstLead)
      } is ready for the first outreach.`,
    };
  }

  const highIntent = leads.find((lead) =>
    lead.status === "contacted" && lead.engagement >= HIGH_INTENT
  );
  if (highIntent) {
    return {
      targetId: highIntent.id,
      workspace: "leads",
      actionLabel: "Qualify lead",
      reason: "This contacted lead has high intent and is ready to qualify.",
    };
  }

  const staleLead = leads.find((lead) =>
    lead.status === "cold" ||
    (lead.status === "contacted" &&
      state.clock.gameMinute - lead.lastActivityAt >= STALE_LEAD_MINUTES)
  );
  if (staleLead) {
    if (
      state.company.founderCapacityRemaining < FOLLOW_UP_CAPACITY_MINUTES
    ) {
      return capacityShortage(
        "Founder capacity is too low to follow up with the stale lead.",
      );
    }
    return {
      targetId: staleLead.id,
      workspace: "leads",
      actionLabel: "Follow up with lead",
      reason: staleLead.status === "cold"
        ? "This cold lead needs a focused follow-up to restore intent."
        : "This contacted lead has gone stale without recent activity.",
    };
  }

  const deal = Object.values(state.records.deals)
    .filter((entry) => dealIsEligible(state, entry))
    .sort((a, b) =>
      a.expectedCloseAt - b.expectedCloseAt ||
      b.probability - a.probability ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id)
    )[0];
  if (deal) {
    return {
      targetId: deal.id,
      workspace: "pipeline",
      actionLabel: deal.stage === "negotiation" ? "Close deal" : "Advance deal",
      reason: "This is the next eligible opportunity in the pipeline.",
    };
  }

  if (
    firstLead &&
    state.company.founderCapacityRemaining >= CONTACT_CAPACITY_MINUTES
  ) {
    return {
      targetId: firstLead.id,
      workspace: "leads",
      actionLabel: "Contact lead",
      reason: `${
        companyNameForLead(state, firstLead)
      } is waiting for outreach.`,
    };
  }

  if (
    firstLead &&
    state.company.founderCapacityRemaining < CONTACT_CAPACITY_MINUTES
  ) {
    return capacityShortage(
      "Founder capacity is too low for the next lead outreach.",
    );
  }

  return {
    targetId: "company",
    workspace: "dashboard",
    actionLabel: "Review company pulse",
    reason:
      "No urgent records need attention; review performance and plan ahead.",
  };
}
