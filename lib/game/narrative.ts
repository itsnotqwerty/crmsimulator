import type { GameState } from "./types.ts";

export interface NarrativeObjective {
  label: string;
  current: number;
  target: number;
  format?: "money" | "percent";
}

export interface NarrativeChapter {
  number: number;
  eyebrow: string;
  title: string;
  sender: string;
  subject: string;
  briefing: string;
  directive: string;
}

export const NARRATIVE_CHAPTERS: readonly NarrativeChapter[] = [{
  number: 0,
  eyebrow: "Prologue · The runway email",
  title: "Proof, not promise",
  sender: "Mara Voss · Board Partner",
  subject: "Ninety days",
  briefing:
    "The account is down to one quarter of runway. At 06:12, your lead investor sends a final note: prove that someone will pay for the product, or prepare to wind the company down.",
  directive:
    "Work the first lead from contact through close. One real customer changes the conversation.",
}, {
  number: 1,
  eyebrow: "Chapter I · A signal",
  title: "Make demand repeatable",
  sender: "Mara Voss · Board Partner",
  subject: "A customer is not a market",
  briefing:
    "One signature proves the product can sell. It does not prove there is a market. The next board update asks for a repeatable source of demand, not another founder miracle.",
  directive:
    "Reach three customers, unlock Marketing, and launch the company's first campaign.",
}, {
  number: 2,
  eyebrow: "Chapter II · The bottleneck",
  title: "Get out of the inbox",
  sender: "Mara Voss · Board Partner",
  subject: "You are now the constraint",
  briefing:
    "The pipeline is beginning to move, but every conversation still waits on you. The company cannot grow while its founder is also its routing rule.",
  directive: "Build $3,000 in MRR and hire the first sales representative.",
}, {
  number: 3,
  eyebrow: "Chapter III · The promise",
  title: "Keep what you win",
  sender: "Mara Voss · Board Partner",
  subject: "The renewal problem",
  briefing:
    "New logos have created a second company behind the first: onboarding, support, and promises that sales no longer has time to keep. Retention is now the product.",
  directive:
    "Reach five customers, stabilize three accounts, and staff Customer Success and Support.",
}, {
  number: 4,
  eyebrow: "Chapter IV · The systems test",
  title: "Become a company",
  sender: "Mara Voss · Board Partner",
  subject: "Board date confirmed",
  briefing:
    "The board meeting is scheduled. Growth alone will not carry the vote; they want evidence that the operation can absorb pressure without you holding every seam together.",
  directive:
    "Reach $10,000 MRR with eight customers, healthy accounts, a working automation, and three resolved tickets.",
}, {
  number: 5,
  eyebrow: "Finale · The board meeting",
  title: "The company survives",
  sender: "Mara Voss · Board Partner",
  subject: "Approved",
  briefing:
    "The numbers hold. Customers stay, the team operates, and revenue no longer depends on a single heroic week. The board approves the next stage on the strength of the company you built.",
  directive:
    "The campaign is complete. Continue in endless mode, choose a company initiative, and set the next operating target.",
}];

function stableCustomers(state: GameState): number {
  return Object.values(state.records.customers).filter((customer) =>
    customer.lifecycle === "active" && customer.health >= 60
  ).length;
}

export function averageCustomerHealth(state: GameState): number {
  const customers = Object.values(state.records.customers);
  if (customers.length === 0) return 0;
  return Math.round(
    customers.reduce((total, customer) => total + customer.health, 0) /
      customers.length,
  );
}

export function narrativeObjectives(state: GameState): NarrativeObjective[] {
  switch (state.narrative.chapter) {
    case 0:
      return [{
        label: "Win the first customer",
        current: state.history.dealsWon,
        target: 1,
      }];
    case 1:
      return [
        {
          label: "Retain three customers",
          current: state.company.customerCount,
          target: 3,
        },
        {
          label: "Launch a marketing campaign",
          current: Object.keys(state.records.campaigns).length,
          target: 1,
        },
      ];
    case 2:
      return [
        {
          label: "Reach $3,000 MRR",
          current: state.company.mrrCents,
          target: 300_000,
          format: "money",
        },
        {
          label: "Hire a sales representative",
          current: Object.keys(state.records.salesReps).length,
          target: 1,
        },
      ];
    case 3:
      return [
        {
          label: "Retain five customers",
          current: state.company.customerCount,
          target: 5,
        },
        {
          label: "Stabilize three active accounts",
          current: stableCustomers(state),
          target: 3,
        },
        {
          label: "Hire a success specialist",
          current: Object.keys(state.records.successReps).length,
          target: 1,
        },
        {
          label: "Hire a support agent",
          current: Object.keys(state.records.supportReps).length,
          target: 1,
        },
      ];
    case 4:
      return [
        {
          label: "Reach $10,000 MRR",
          current: state.company.mrrCents,
          target: 1_000_000,
          format: "money",
        },
        {
          label: "Retain eight customers",
          current: state.company.customerCount,
          target: 8,
        },
        {
          label: "Maintain 70% account health",
          current: averageCustomerHealth(state),
          target: 70,
          format: "percent",
        },
        {
          label: "Create an active workflow",
          current:
            state.platform.workflows.filter((workflow) => workflow.enabled)
              .length,
          target: 1,
        },
        {
          label: "Resolve three support tickets",
          current: state.history.ticketsResolved,
          target: 3,
        },
      ];
    default:
      return [];
  }
}

export function syncNarrative(state: GameState): GameState {
  if (state.narrative.chapter >= NARRATIVE_CHAPTERS.length - 1) return state;
  let chapter = state.narrative.chapter;
  let candidate = state;
  while (chapter < NARRATIVE_CHAPTERS.length - 1) {
    candidate = { ...state, narrative: { ...state.narrative, chapter } };
    if (
      !narrativeObjectives(candidate).every((objective) =>
        objective.current >= objective.target
      )
    ) break;
    chapter += 1;
  }
  if (chapter === state.narrative.chapter) return state;
  return {
    ...state,
    narrative: {
      chapter,
      pendingBriefing: true,
      ...(chapter === NARRATIVE_CHAPTERS.length - 1
        ? { completedAt: state.clock.gameMinute }
        : {}),
    },
  };
}
