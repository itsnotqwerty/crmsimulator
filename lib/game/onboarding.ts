import type { GameState, OnboardingState, OnboardingStep } from "./types.ts";

export type OnboardingWorkspace =
  | "campaign"
  | "dashboard"
  | "leads"
  | "contacts"
  | "companies"
  | "tasks"
  | "settings";

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  "inspect_lead",
  "explain_capacity",
  "contact_lead",
  "explain_spam",
  "review_contacts",
  "review_company",
  "qualify_lead",
  "review_tasks",
  "work_deal",
  "review_dashboard",
  "onboard_customer",
  "repeat_sales",
  "complete",
];

const INFORMATIONAL_STEPS = new Set<OnboardingStep>([
  "inspect_lead",
  "explain_capacity",
  "explain_spam",
  "review_contacts",
  "review_company",
  "review_tasks",
  "review_dashboard",
]);

const STEP_WORKSPACE: Record<OnboardingStep, OnboardingWorkspace> = {
  inspect_lead: "leads",
  explain_capacity: "leads",
  contact_lead: "leads",
  explain_spam: "leads",
  review_contacts: "contacts",
  review_company: "companies",
  qualify_lead: "leads",
  review_tasks: "tasks",
  work_deal: "leads",
  review_dashboard: "dashboard",
  onboard_customer: "tasks",
  repeat_sales: "leads",
  complete: "dashboard",
};

const WORKSPACE_INTRODUCTION: Partial<
  Record<OnboardingWorkspace, OnboardingStep>
> = {
  leads: "inspect_lead",
  contacts: "review_contacts",
  companies: "review_company",
  tasks: "review_tasks",
  dashboard: "review_dashboard",
};

export function onboardingActive(state: GameState): boolean {
  return !state.onboarding.dismissed && state.onboarding.step !== "complete";
}

export function onboardingStepNumber(step: OnboardingStep): number {
  return Math.min(
    ONBOARDING_STEPS.indexOf(step) + 1,
    ONBOARDING_STEPS.length - 1,
  );
}

export function onboardingWorkspace(state: GameState): OnboardingWorkspace {
  return STEP_WORKSPACE[state.onboarding.step];
}

export function onboardingPausesSimulation(state: GameState): boolean {
  return onboardingActive(state) && INFORMATIONAL_STEPS.has(
    state.onboarding.step,
  );
}

export function onboardingWorkspaceAvailable(
  state: GameState,
  workspace: OnboardingWorkspace,
): boolean {
  if (
    !onboardingActive(state) || workspace === "campaign" ||
    workspace === "settings"
  ) {
    return true;
  }
  const introduction = WORKSPACE_INTRODUCTION[workspace];
  if (!introduction) return true;
  return ONBOARDING_STEPS.indexOf(state.onboarding.step) >=
    ONBOARDING_STEPS.indexOf(introduction);
}

export function acknowledgeOnboarding(
  onboarding: OnboardingState,
  expectedStep: OnboardingStep,
): OnboardingState | undefined {
  if (
    onboarding.dismissed || onboarding.step !== expectedStep ||
    !INFORMATIONAL_STEPS.has(expectedStep)
  ) return undefined;
  const next = ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(expectedStep) + 1];
  return { ...onboarding, step: next };
}

export function syncOnboarding(state: GameState): GameState {
  if (!onboardingActive(state)) return state;
  let step = state.onboarding.step;
  if (
    step === "contact_lead" &&
    Object.values(state.records.leads).some((lead) =>
      lead.status === "contacted"
    )
  ) step = "explain_spam";
  if (
    step === "qualify_lead" &&
    Object.values(state.records.deals).some((deal) => deal.stage !== "lost")
  ) step = "review_tasks";
  if (step === "work_deal" && state.company.customerCount >= 1) {
    step = "review_dashboard";
  }
  if (
    step === "onboard_customer" &&
    Object.values(state.records.customers).some((customer) =>
      customer.lifecycle === "active"
    )
  ) step = "repeat_sales";
  if (step === "repeat_sales" && state.company.customerCount >= 3) {
    step = "complete";
  }
  return step === state.onboarding.step
    ? state
    : { ...state, onboarding: { ...state.onboarding, step } };
}
