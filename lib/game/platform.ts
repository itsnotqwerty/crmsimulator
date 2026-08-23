import { projectEvents } from "./events.ts";
import { syncNarrative } from "./narrative.ts";
import type {
  CommandResult,
  DomainEvent,
  GameCommand,
  GameRules,
  GameState,
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
    const rewardCents = score * TARGET_REWARD_CENTS;
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
        auditEntriesArchived: current.platform.auditEntriesArchived + 1,
      },
    };
    events.push({
      kind: "quarter_completed",
      summary: `Q${
        current.platform.quarter - 1
      } closed: ${score}/3 targets met`,
      gameMinute: endMinute,
      amountCents: rewardCents,
    });
  }
  return { state: current, events };
}
