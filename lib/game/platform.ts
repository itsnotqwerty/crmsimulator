import { projectEvents } from "./events.ts";
import { syncNarrative } from "./narrative.ts";
import type {
  CommandResult,
  DomainEvent,
  GameCommand,
  GameRules,
  GameState,
  InitiativeType,
} from "./types.ts";

const reject = (state: GameState, reason: string): CommandResult => ({
  accepted: false,
  state,
  events: [],
  reason,
});
function accept(
  state: GameState,
  rules: GameRules,
  summary: string,
): CommandResult {
  const event = {
    kind: "task_completed" as const,
    summary,
    gameMinute: state.clock.gameMinute,
  };
  return {
    accepted: true,
    state: syncNarrative(projectEvents(state, [event], rules)),
    events: [event],
  };
}
const clean = (value: string) => value.trim().replaceAll(/\s+/g, " ");
const MANAGER_MONTHLY_SALARY_CENTS = 1_200_000;
const QUARTER_MINUTES = 30 * 24 * 60;
const TARGET_REWARD_CENTS = 250_000;
const INITIATIVE_MILESTONES = 3;

export interface InitiativeDefinition {
  type: InitiativeType;
  name: string;
  summary: string;
  startCostCents: number;
  durationDays: number;
  accelerateLabel: string;
  stabilizeLabel: string;
}

export const INITIATIVE_DEFINITIONS: readonly InitiativeDefinition[] = [{
  type: "growth",
  name: "Market expansion",
  summary: "Pursue a new segment without letting acquisition costs drift.",
  startCostCents: 200_000,
  durationDays: 12,
  accelerateLabel: "Broaden the launch",
  stabilizeLabel: "Prove one segment",
}, {
  type: "efficiency",
  name: "Operating redesign",
  summary: "Reduce recurring costs while protecting delivery capacity.",
  startCostCents: 150_000,
  durationDays: 10,
  accelerateLabel: "Cut the bottleneck",
  stabilizeLabel: "Standardize the process",
}, {
  type: "retention",
  name: "Customer trust program",
  summary: "Strengthen adoption and renewal confidence across the base.",
  startCostCents: 120_000,
  durationDays: 8,
  accelerateLabel: "Intervene at risk",
  stabilizeLabel: "Scale healthy habits",
}, {
  type: "resilience",
  name: "Continuity program",
  summary: "Harden critical operations against the next quarter's pressure.",
  startCostCents: 250_000,
  durationDays: 14,
  accelerateLabel: "Harden critical paths",
  stabilizeLabel: "Build recovery depth",
}];

export function initiativeDefinition(
  type: InitiativeType,
): InitiativeDefinition {
  return INITIATIVE_DEFINITIONS.find((definition) => definition.type === type)!;
}

export interface OperatingMetrics {
  mrrCents: number;
  efficiencyPercent: number;
  retentionPercent: number;
  monthlyOperatingCostCents: number;
}

export function operatingMetrics(state: GameState): OperatingMetrics {
  const payrollCents = [
    ...Object.values(state.records.salesReps),
    ...Object.values(state.records.successReps),
    ...Object.values(state.records.supportReps),
    ...state.platform.managers,
  ].reduce((total, staff) => total + staff.monthlySalaryCents, 0);
  const campaignRunRateCents = Object.values(state.records.campaigns).filter(
    (campaign) => campaign.status === "active",
  ).reduce((total, campaign) => total + campaign.dailyBudgetCents * 30, 0);
  const monthlyOperatingCostCents = state.company.baselineMonthlyExpensesCents +
    payrollCents +
    campaignRunRateCents;
  const retained = state.company.customerCount;
  const retentionBase = retained + state.history.customersLost;
  return {
    mrrCents: state.company.mrrCents,
    efficiencyPercent: monthlyOperatingCostCents > 0
      ? Math.round(state.company.mrrCents / monthlyOperatingCostCents * 100)
      : 100,
    retentionPercent: retentionBase > 0
      ? Math.round(retained / retentionBase * 100)
      : 100,
    monthlyOperatingCostCents,
  };
}

export function quarterDaysRemaining(gameMinute: number): number {
  const elapsed = gameMinute % QUARTER_MINUTES;
  return Math.ceil((QUARTER_MINUTES - elapsed) / (24 * 60));
}

export function applyPlatformCommand(
  state: GameState,
  command: GameCommand,
  rules: GameRules,
): CommandResult | undefined {
  const platform = state.platform;
  switch (command.type) {
    case "create_sequence": {
      const name = clean(command.name);
      if (name.length < 2 || platform.sequences.length >= 12) {
        return reject(state, "Sequence name or limit is invalid");
      }
      const sequence = {
        id: `sequence_${platform.sequences.length + 1}`,
        name,
        audience: command.audience,
        enabled: true,
        enrolled: 0,
        completed: 0,
      };
      return accept(
        {
          ...state,
          platform: {
            ...platform,
            sequences: [...platform.sequences, sequence],
          },
        },
        rules,
        `Sequence created: ${name}`,
      );
    }
    case "toggle_sequence": {
      if (!platform.sequences.some((item) => item.id === command.sequenceId)) {
        return reject(state, "Sequence does not exist");
      }
      return accept(
        {
          ...state,
          platform: {
            ...platform,
            sequences: platform.sequences.map((item) =>
              item.id === command.sequenceId
                ? { ...item, enabled: !item.enabled }
                : item
            ),
          },
        },
        rules,
        "Sequence status changed",
      );
    }
    case "create_workflow": {
      const name = clean(command.name);
      if (name.length < 2 || platform.workflows.length >= 20) {
        return reject(state, "Workflow name or limit is invalid");
      }
      const workflow = {
        id: `workflow_${
          platform.workflows.reduce(
            (highest, item) =>
              Math.max(highest, Number(item.id.replace("workflow_", "")) || 0),
            0,
          ) + 1
        }`,
        name,
        trigger: command.trigger,
        condition: command.condition,
        action: command.action,
        enabled: true,
        runs: 0,
        errors: 0,
      };
      return accept(
        {
          ...state,
          platform: {
            ...platform,
            workflows: [...platform.workflows, workflow],
          },
        },
        rules,
        `Workflow created: ${name}`,
      );
    }
    case "toggle_workflow": {
      if (!platform.workflows.some((item) => item.id === command.workflowId)) {
        return reject(state, "Workflow does not exist");
      }
      return accept(
        {
          ...state,
          platform: {
            ...platform,
            workflows: platform.workflows.map((item) =>
              item.id === command.workflowId
                ? { ...item, enabled: !item.enabled }
                : item
            ),
          },
        },
        rules,
        "Workflow status changed",
      );
    }
    case "delete_workflow": {
      const workflow = platform.workflows.find((item) =>
        item.id === command.workflowId
      );
      if (!workflow) return reject(state, "Workflow does not exist");
      return accept(
        {
          ...state,
          platform: {
            ...platform,
            workflows: platform.workflows.filter((item) =>
              item.id !== command.workflowId
            ),
          },
        },
        rules,
        `Workflow removed: ${workflow.name}`,
      );
    }
    case "create_department": {
      const name = clean(command.name), manager = clean(command.manager);
      if (
        name.length < 2 || manager.length < 2 ||
        command.monthlyBudgetCents < 100_000 || command.headcountPlan < 1 ||
        platform.departments.length >= 8
      ) return reject(state, "Department plan is invalid");
      const department = {
        id: `department_${platform.departments.length + 1}`,
        name,
        manager,
        monthlyBudgetCents: command.monthlyBudgetCents,
        headcountPlan: command.headcountPlan,
        headcount: 1,
        burnout: 0,
      };
      return accept(
        {
          ...state,
          platform: {
            ...platform,
            departments: [...platform.departments, department],
          },
        },
        rules,
        `Department opened: ${name}`,
      );
    }
    case "hire_department_staff": {
      const department = platform.departments.find((item) =>
        item.id === command.departmentId
      );
      if (!department || department.headcount >= department.headcountPlan) {
        return reject(state, "Department is at its headcount plan");
      }
      const cost = 50_000;
      if (state.company.cashCents < cost) {
        return reject(state, "Not enough cash to hire");
      }
      return accept(
        {
          ...state,
          company: {
            ...state.company,
            cashCents: state.company.cashCents - cost,
          },
          platform: {
            ...platform,
            departments: platform.departments.map((item) =>
              item.id === department.id
                ? { ...item, headcount: item.headcount + 1 }
                : item
            ),
            auditEntriesArchived: platform.auditEntriesArchived + 1,
          },
        },
        rules,
        `Hired into ${department.name}`,
      );
    }
    case "hire_manager": {
      const name = clean(command.name);
      if (name.length < 2 || name.length > 60) {
        return reject(state, "Manager name must contain 2 to 60 characters");
      }
      if (
        platform.managers.some((manager) =>
          manager.department === command.department
        )
      ) {
        return reject(state, "This department already has a manager");
      }
      const requiredUnlock = command.department === "sales"
        ? "pipeline"
        : command.department === "marketing"
        ? "marketing"
        : "customer_success";
      if (!state.unlocks.includes(requiredUnlock)) {
        return reject(state, "Unlock this department before hiring a manager");
      }
      return accept(
        {
          ...state,
          platform: {
            ...platform,
            managers: [...platform.managers, {
              id: `manager_${command.department}`,
              name,
              department: command.department,
              monthlySalaryCents: MANAGER_MONTHLY_SALARY_CENTS,
              hiredAt: state.clock.gameMinute,
              lastReviewedAt: state.clock.gameMinute,
              underCapacityReviews: 0,
            }],
            departments: command.department === "marketing" &&
                !platform.departments.some((item) =>
                  item.id === "department_marketing"
                )
              ? [...platform.departments, {
                id: "department_marketing",
                name: "Marketing",
                manager: name,
                monthlyBudgetCents: 500_000,
                headcountPlan: 8,
                headcount: 0,
                burnout: 0,
              }]
              : platform.departments,
            auditEntriesArchived: platform.auditEntriesArchived + 1,
          },
        },
        rules,
        `${name} hired to manage ${command.department.replaceAll("_", " ")}`,
      );
    }
    case "fire_manager": {
      const manager = platform.managers.find((item) =>
        item.department === command.department
      );
      if (!manager) return reject(state, "This department has no manager");
      return accept(
        {
          ...state,
          platform: {
            ...platform,
            managers: platform.managers.filter((item) =>
              item.id !== manager.id
            ),
            auditEntriesArchived: platform.auditEntriesArchived + 1,
          },
        },
        rules,
        `${manager.name} left ${command.department.replaceAll("_", " ")}`,
      );
    }
    case "set_approval_threshold":
      if (command.amountCents < 10_000) {
        return reject(state, "Approval threshold is too low");
      }
      return accept(
        {
          ...state,
          platform: {
            ...platform,
            approvalThresholdCents: command.amountCents,
            auditEntriesArchived: platform.auditEntriesArchived + 1,
          },
        },
        rules,
        "Approval policy updated",
      );
    case "invest_resilience": {
      const cost = (platform.resilienceLevel + 1) * 100_000;
      if (state.company.cashCents < cost) {
        return reject(state, "Not enough cash for resilience investment");
      }
      return accept(
        {
          ...state,
          company: {
            ...state.company,
            cashCents: state.company.cashCents - cost,
          },
          platform: {
            ...platform,
            resilienceLevel: platform.resilienceLevel + 1,
          },
        },
        rules,
        "Operational resilience improved",
      );
    }
    case "start_initiative": {
      if (
        state.company.mrrCents < 1_000_000 &&
        platform.departments.length === 0
      ) {
        return reject(state, "Reach $10,000 MRR to unlock company initiatives");
      }
      if (platform.initiatives.some((item) => item.status === "active")) {
        return reject(
          state,
          "Complete the active initiative before starting another",
        );
      }
      const definition = initiativeDefinition(command.initiativeType);
      if (!definition || state.company.cashCents < definition.startCostCents) {
        return reject(state, "Not enough cash to start this initiative");
      }
      const sequence = platform.initiativeSequence + 1;
      const startedAt = state.clock.gameMinute;
      const durationMinutes = definition.durationDays * 24 * 60;
      const milestoneAt = [1, 2, 3].map((milestone) =>
        startedAt + Math.round(durationMinutes * milestone / 3)
      ) as [number, number, number];
      const initiative = {
        id: `initiative_${sequence}`,
        type: command.initiativeType,
        status: "active" as const,
        startedAt,
        endsAt: startedAt + durationMinutes,
        startCostCents: definition.startCostCents,
        milestoneAt,
        promptedMilestone: 0,
        decisions: [],
      };
      const event: DomainEvent = {
        kind: "initiative_started",
        summary: `${definition.name} started`,
        relatedId: initiative.id,
        gameMinute: startedAt,
        amountCents: definition.startCostCents,
      };
      const next = {
        ...state,
        company: {
          ...state.company,
          cashCents: state.company.cashCents - definition.startCostCents,
        },
        platform: {
          ...platform,
          initiativeSequence: sequence,
          initiatives: [...platform.initiatives, initiative].slice(-4),
        },
      };
      return {
        accepted: true,
        state: syncNarrative(projectEvents(next, [event], rules)),
        events: [event],
      };
    }
    case "decide_initiative_milestone": {
      const initiative = platform.initiatives.find((item) =>
        item.id === command.initiativeId && item.status === "active"
      );
      if (!initiative) return reject(state, "Active initiative does not exist");
      const milestoneIndex = initiative.decisions.length;
      if (
        milestoneIndex >= INITIATIVE_MILESTONES ||
        initiative.promptedMilestone <= milestoneIndex ||
        state.clock.gameMinute < initiative.milestoneAt[milestoneIndex]
      ) {
        return reject(state, "The next initiative milestone is not ready");
      }
      const decisions = [...initiative.decisions, {
        milestone: milestoneIndex + 1,
        approach: command.approach,
        decidedAt: state.clock.gameMinute,
      }];
      if (decisions.length < INITIATIVE_MILESTONES) {
        const updated = {
          ...initiative,
          decisions,
        };
        const event: DomainEvent = {
          kind: "initiative_milestone_decided",
          summary: `${
            initiativeDefinition(initiative.type).name
          } milestone ${decisions.length}: ${command.approach}`,
          relatedId: initiative.id,
          gameMinute: state.clock.gameMinute,
        };
        const next = {
          ...state,
          platform: {
            ...platform,
            initiatives: platform.initiatives.map((item) =>
              item.id === initiative.id ? updated : item
            ),
          },
        };
        return {
          accepted: true,
          state: syncNarrative(projectEvents(next, [event], rules)),
          events: [event],
        };
      }
      const accelerated =
        decisions.filter((decision) => decision.approach === "accelerate")
          .length;
      const stabilized = decisions.length - accelerated;
      const rewardCents = 150_000 + platform.endlessGoal * 25_000 +
        stabilized * 15_000;
      let completed: GameState = {
        ...state,
        company: {
          ...state.company,
          cashCents: state.company.cashCents + rewardCents,
        },
      };
      let outcome = "";
      if (initiative.type === "growth") {
        const mrrGain = 40_000 + accelerated * 20_000;
        completed = {
          ...completed,
          company: {
            ...completed.company,
            mrrCents: completed.company.mrrCents + mrrGain,
            peakMrrCents: Math.max(
              completed.company.peakMrrCents,
              completed.company.mrrCents + mrrGain,
            ),
            baselineMonthlyExpensesCents:
              completed.company.baselineMonthlyExpensesCents +
              accelerated * 10_000,
          },
        };
        outcome = `$${mrrGain / 100} MRR added; ${
          accelerated * 100
        } dollars of monthly complexity accepted`;
      } else if (initiative.type === "efficiency") {
        const savings = 50_000 + accelerated * 15_000;
        completed = {
          ...completed,
          company: {
            ...completed.company,
            baselineMonthlyExpensesCents: Math.max(
              100_000,
              completed.company.baselineMonthlyExpensesCents - savings,
            ),
          },
        };
        completed = applyBurnoutPressure(completed, accelerated * 2);
        outcome = `$${savings / 100} monthly cost removed; ${
          accelerated * 2
        } burnout pressure accepted`;
      } else if (initiative.type === "retention") {
        const healthGain = 8 + stabilized * 3;
        completed = {
          ...completed,
          records: {
            ...completed.records,
            customers: Object.fromEntries(
              Object.entries(completed.records.customers).map((
                [id, customer],
              ) => [id, {
                ...customer,
                health: Math.min(100, customer.health + healthGain),
                adoption: Math.min(
                  100,
                  customer.adoption + 5 + stabilized * 2,
                ),
              }]),
            ),
          },
        };
        outcome =
          `Customer health improved ${healthGain} points; growth upside deferred`;
      } else {
        const levels = 1 + (stabilized >= 2 ? 1 : 0);
        completed = {
          ...completed,
          platform: {
            ...completed.platform,
            resilienceLevel: completed.platform.resilienceLevel + levels,
          },
        };
        outcome = `${levels} resilience level${
          levels === 1 ? "" : "s"
        } gained; no direct growth created`;
      }
      const finished = {
        ...initiative,
        status: "completed" as const,
        decisions,
        completedAt: state.clock.gameMinute,
        rewardCents,
        outcome,
      };
      const event: DomainEvent = {
        kind: "initiative_completed",
        summary: `${
          initiativeDefinition(initiative.type).name
        } completed: ${outcome}`,
        relatedId: initiative.id,
        gameMinute: state.clock.gameMinute,
        amountCents: rewardCents,
      };
      const finalized = {
        ...completed,
        platform: {
          ...completed.platform,
          initiatives: completed.platform.initiatives.map((item) =>
            item.id === initiative.id ? finished : item
          ).slice(-4),
          initiativesCompleted: completed.platform.initiativesCompleted + 1,
          quarterInitiativeCompleted: true,
          auditEntriesArchived: completed.platform.auditEntriesArchived + 1,
        },
      };
      return {
        accepted: true,
        state: syncNarrative(projectEvents(finalized, [event], rules)),
        events: [event],
      };
    }
    default:
      return undefined;
  }
}

function applyBurnoutPressure(state: GameState, pressure: number): GameState {
  if (pressure === 0) return state;
  const addPressure = <T extends { burnout: number }>(staff: T): T => ({
    ...staff,
    burnout: Math.min(100, staff.burnout + pressure),
  });
  return {
    ...state,
    records: {
      ...state.records,
      salesReps: Object.fromEntries(
        Object.entries(state.records.salesReps).map(([id, rep]) => [
          id,
          addPressure(rep),
        ]),
      ),
      successReps: Object.fromEntries(
        Object.entries(state.records.successReps).map(([id, rep]) => [
          id,
          addPressure(rep),
        ]),
      ),
      supportReps: Object.fromEntries(
        Object.entries(state.records.supportReps).map(([id, rep]) => [
          id,
          addPressure(rep),
        ]),
      ),
    },
  };
}

export function advancePlatform(
  state: GameState,
  startMinute: number,
  endMinute: number,
): { state: GameState; events: DomainEvent[] } {
  let current = state;
  const events: DomainEvent[] = [];
  const activeInitiative = current.platform.initiatives.find((initiative) =>
    initiative.status === "active"
  );
  if (activeInitiative) {
    const milestoneIndex = activeInitiative.decisions.length;
    if (
      milestoneIndex < INITIATIVE_MILESTONES &&
      activeInitiative.promptedMilestone <= milestoneIndex &&
      endMinute >= activeInitiative.milestoneAt[milestoneIndex]
    ) {
      current = {
        ...current,
        platform: {
          ...current.platform,
          initiatives: current.platform.initiatives.map((initiative) =>
            initiative.id === activeInitiative.id
              ? { ...initiative, promptedMilestone: milestoneIndex + 1 }
              : initiative
          ),
        },
      };
      events.push({
        kind: "initiative_milestone_ready",
        summary: `${
          initiativeDefinition(activeInitiative.type).name
        } milestone ${milestoneIndex + 1} needs a decision`,
        relatedId: activeInitiative.id,
        gameMinute: endMinute,
      });
    }
  }
  if (Math.floor(startMinute / 1_440) !== Math.floor(endMinute / 1_440)) {
    current = {
      ...current,
      platform: {
        ...current.platform,
        departments: current.platform.departments.map((department) => ({
          ...department,
          burnout: Math.max(
            0,
            Math.min(
              100,
              department.burnout +
                (department.headcount < department.headcountPlan ? 2 : -1),
            ),
          ),
        })),
      },
    };
  }

  while (
    current.company.mrrCents >= current.platform.endlessGoal * 1_000_000
  ) {
    const reachedGoal = current.platform.endlessGoal;
    current = {
      ...current,
      platform: {
        ...current.platform,
        endlessGoal: reachedGoal + 1,
      },
    };
    events.push({
      kind: "operating_goal_reached",
      summary: `$${reachedGoal * 10_000} MRR operating goal reached`,
      gameMinute: endMinute,
    });
  }

  const quartersCrossed = Math.floor(endMinute / QUARTER_MINUTES) -
    Math.floor(startMinute / QUARTER_MINUTES);
  for (let index = 0; index < quartersCrossed; index += 1) {
    const metrics = operatingMetrics(current);
    const targetsMet = [
      metrics.mrrCents >= current.platform.growthTargetCents,
      metrics.efficiencyPercent >= current.platform.efficiencyTargetPercent,
      metrics.retentionPercent >= current.platform.retentionTargetPercent,
    ];
    const score = targetsMet.filter(Boolean).length;
    const initiativeBonus = current.platform.quarterInitiativeCompleted
      ? TARGET_REWARD_CENTS
      : 0;
    const rewardCents = score * TARGET_REWARD_CENTS + initiativeBonus;
    const misses = targetsMet.length - score;
    const pressure = misses * Math.max(
      0,
      5 - current.platform.resilienceLevel,
    );
    current = applyBurnoutPressure(current, pressure);
    const nextGrowthTarget = Math.max(
      current.platform.growthTargetCents + 250_000,
      Math.ceil(current.company.mrrCents * 1.15 / 50_000) * 50_000,
    );
    current = {
      ...current,
      company: {
        ...current.company,
        cashCents: current.company.cashCents + rewardCents,
      },
      platform: {
        ...current.platform,
        quarter: current.platform.quarter + 1,
        growthTargetCents: nextGrowthTarget,
        efficiencyTargetPercent: targetsMet[1]
          ? Math.min(100, current.platform.efficiencyTargetPercent + 2)
          : Math.max(50, current.platform.efficiencyTargetPercent - 2),
        retentionTargetPercent: targetsMet[2]
          ? Math.min(99, current.platform.retentionTargetPercent + 1)
          : Math.max(75, current.platform.retentionTargetPercent - 1),
        quarterInitiativeCompleted: false,
        auditEntriesArchived: current.platform.auditEntriesArchived + 1,
      },
    };
    events.push({
      kind: "quarter_completed",
      summary: `Q${
        current.platform.quarter - 1
      } closed: ${score}/3 targets met${
        initiativeBonus ? " plus initiative bonus" : ""
      }`,
      gameMinute: endMinute,
      amountCents: rewardCents,
    });
  }
  return { state: current, events };
}
