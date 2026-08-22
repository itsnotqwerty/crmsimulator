import { projectEvents } from "./events.ts";
import { syncNarrative } from "./narrative.ts";
import type {
  CommandResult,
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
        id: `workflow_${platform.workflows.length + 1}`,
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
    case "connect_integration": {
      const name = clean(command.name), mapping = clean(command.mapping);
      if (
        name.length < 2 || mapping.length < 2 ||
        platform.integrations.length >= 8
      ) return reject(state, "Integration configuration is invalid");
      const item = {
        id: `integration_${platform.integrations.length + 1}`,
        name,
        mapping,
        status: "syncing" as const,
        recordsSynced: 0,
        failures: 0,
      };
      return accept(
        {
          ...state,
          platform: {
            ...platform,
            integrations: [...platform.integrations, item],
          },
        },
        rules,
        `Simulated integration connected: ${name}`,
      );
    }
    case "retry_integration": {
      if (
        !platform.integrations.some((item) => item.id === command.integrationId)
      ) return reject(state, "Integration does not exist");
      return accept(
        {
          ...state,
          platform: {
            ...platform,
            integrations: platform.integrations.map((item) =>
              item.id === command.integrationId
                ? { ...item, status: "syncing" as const }
                : item
            ),
          },
        },
        rules,
        "Integration sync queued",
      );
    }
    case "add_custom_field": {
      const name = clean(command.name);
      if (
        name.length < 2 || platform.customFields.includes(name) ||
        platform.customFields.length >= 20
      ) return reject(state, "Custom field is invalid or already exists");
      return accept(
        {
          ...state,
          platform: {
            ...platform,
            customFields: [...platform.customFields, name],
          },
        },
        rules,
        `Custom field added: ${name}`,
      );
    }
    case "save_view": {
      const name = clean(command.name);
      if (
        name.length < 2 || platform.savedViews.includes(name) ||
        platform.savedViews.length >= 12
      ) return reject(state, "Saved view is invalid or already exists");
      return accept(
        {
          ...state,
          platform: { ...platform, savedViews: [...platform.savedViews, name] },
        },
        rules,
        `View saved: ${name}`,
      );
    }
    case "merge_duplicates":
      if (platform.duplicateReviews < 1) {
        return reject(state, "No duplicate records need review");
      }
      return accept(
        {
          ...state,
          platform: {
            ...platform,
            duplicateReviews: 0,
            duplicatesMerged: platform.duplicatesMerged +
              platform.duplicateReviews,
            auditEntriesArchived: platform.auditEntriesArchived +
              platform.duplicateReviews,
          },
        },
        rules,
        "Duplicate records merged",
      );
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
    case "set_quarterly_plan":
      if (
        command.growthTargetCents < 1 || command.efficiencyTargetPercent < 1 ||
        command.efficiencyTargetPercent > 100 ||
        command.retentionTargetPercent < 1 ||
        command.retentionTargetPercent > 100
      ) return reject(state, "Quarterly targets are invalid");
      return accept(
        {
          ...state,
          platform: {
            ...platform,
            quarter: platform.quarter + 1,
            growthTargetCents: command.growthTargetCents,
            efficiencyTargetPercent: command.efficiencyTargetPercent,
            retentionTargetPercent: command.retentionTargetPercent,
          },
        },
        rules,
        "Quarterly plan approved",
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
    case "advance_endless_goal":
      if (state.company.mrrCents < platform.endlessGoal * 1_000_000) {
        return reject(state, "Current growth goal has not been reached");
      }
      return accept(
        {
          ...state,
          platform: { ...platform, endlessGoal: platform.endlessGoal + 1 },
        },
        rules,
        "Next operating goal unlocked",
      );
    default:
      return undefined;
  }
}

export function advancePlatform(
  state: GameState,
  startMinute: number,
  endMinute: number,
): GameState {
  if (Math.floor(startMinute / 1_440) === Math.floor(endMinute / 1_440)) {
    return state;
  }
  const day = Math.floor(endMinute / 1_440);
  const maxRuns = 20;
  let runs = 0, errors = 0;
  const workflows = state.platform.workflows.map((workflow) => {
    if (!workflow.enabled || runs >= maxRuns) return workflow;
    runs += 1;
    const failed = (state.seed + day + workflow.runs) % 11 === 0;
    if (failed) errors += 1;
    return {
      ...workflow,
      runs: workflow.runs + 1,
      errors: workflow.errors + Number(failed),
      lastRunAt: endMinute,
    };
  });
  const sequences = state.platform.sequences.map((sequence) =>
    sequence.enabled
      ? {
        ...sequence,
        enrolled: sequence.enrolled + 1,
        completed: sequence.completed +
          Number((day + sequence.enrolled) % 3 === 0),
      }
      : sequence
  );
  const integrations = state.platform.integrations.map((integration) => {
    if (integration.status !== "syncing") return integration;
    const failed = (state.seed + day + integration.failures) % 7 === 0;
    return {
      ...integration,
      status: failed ? "failed" as const : "connected" as const,
      recordsSynced: integration.recordsSynced + (failed ? 0 : 25),
      failures: integration.failures + Number(failed),
    };
  });
  const departments = state.platform.departments.map((department) => ({
    ...department,
    burnout: Math.max(
      0,
      Math.min(
        100,
        department.burnout +
          (department.headcount < department.headcountPlan ? 2 : -1),
      ),
    ),
  }));
  return {
    ...state,
    platform: {
      ...state.platform,
      workflows,
      sequences,
      integrations,
      departments,
      duplicateReviews: Math.min(
        20,
        state.platform.duplicateReviews + Number(day % 5 === 0),
      ),
      automationRunsArchived: state.platform.automationRunsArchived + runs,
      automationErrorsArchived: state.platform.automationErrorsArchived +
        errors,
    },
  };
}
