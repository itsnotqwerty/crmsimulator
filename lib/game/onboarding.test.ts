import { assert, assertEquals } from "$std/assert/mod.ts";
import { applyCommand } from "./actions.ts";
import {
  onboardingPausesSimulation,
  onboardingWorkspaceAvailable,
} from "./onboarding.ts";
import { createInitialState } from "./state.ts";

Deno.test("guided opening advances through the first customer workflow", () => {
  let state = createInitialState({ seed: 5, now: 1_000 });
  assert(onboardingPausesSimulation(state));
  assert(onboardingWorkspaceAvailable(state, "leads"));
  assertEquals(onboardingWorkspaceAvailable(state, "dashboard"), false);

  let result = applyCommand(state, {
    type: "acknowledge_onboarding",
    step: "inspect_lead",
  });
  assert(result.accepted);
  state = result.state;
  assertEquals(state.onboarding.step, "contact_lead");
  assertEquals(onboardingPausesSimulation(state), false);

  result = applyCommand(state, {
    type: "contact_lead",
    leadId: "lead_1",
    channel: "email",
  });
  assert(result.accepted);
  state = result.state;
  assertEquals(state.onboarding.step, "explain_spam");
  assert(onboardingPausesSimulation(state));

  result = applyCommand(state, {
    type: "acknowledge_onboarding",
    step: "explain_spam",
  });
  assert(result.accepted);
  state = result.state;
  assertEquals(state.onboarding.step, "review_contacts");
  assert(onboardingWorkspaceAvailable(state, "contacts"));

  for (
    const step of ["review_contacts", "review_company"] as const
  ) {
    result = applyCommand(state, { type: "acknowledge_onboarding", step });
    assert(result.accepted);
    state = result.state;
  }
  assertEquals(state.onboarding.step, "qualify_lead");
  assert(onboardingWorkspaceAvailable(state, "companies"));

  result = applyCommand(state, { type: "qualify_lead", leadId: "lead_1" });
  assert(result.accepted);
  state = result.state;
  assertEquals(state.onboarding.step, "review_tasks");

  result = applyCommand(state, {
    type: "acknowledge_onboarding",
    step: "review_tasks",
  });
  assert(result.accepted);
  state = result.state;
  assertEquals(state.onboarding.step, "work_deal");

  const dealId = Object.keys(state.records.deals)[0];
  for (let index = 0; index < 4; index += 1) {
    result = applyCommand(state, { type: "advance_deal", dealId });
    assert(result.accepted);
    state = result.state;
  }
  assertEquals(state.onboarding.step, "review_dashboard");
  assert(onboardingWorkspaceAvailable(state, "dashboard"));

  result = applyCommand(state, {
    type: "acknowledge_onboarding",
    step: "review_dashboard",
  });
  assert(result.accepted);
  state = result.state;
  assertEquals(state.onboarding.step, "onboard_customer");

  const onboardingTask = Object.values(state.records.tasks).find((task) =>
    task.kind === "onboarding" && task.status === "open"
  );
  assert(onboardingTask);
  result = applyCommand(state, {
    type: "complete_task",
    taskId: onboardingTask.id,
  });
  assert(result.accepted);
  assertEquals(result.state.onboarding.step, "repeat_sales");
});

Deno.test("guided opening rejects stale explanations and can be skipped", () => {
  const initial = createInitialState({ seed: 6, now: 1_000 });
  const stale = applyCommand(initial, {
    type: "acknowledge_onboarding",
    step: "review_contacts",
  });
  assertEquals(stale.accepted, false);
  assertEquals(stale.state, initial);

  const skipped = applyCommand(initial, { type: "skip_onboarding" });
  assert(skipped.accepted);
  assertEquals(skipped.state.onboarding, {
    step: "complete",
    dismissed: true,
  });
  assertEquals(skipped.state.unlocks, []);
  assert(onboardingWorkspaceAvailable(skipped.state, "dashboard"));
});
