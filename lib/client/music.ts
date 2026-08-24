import { operatingMetrics } from "../game/platform.ts";
import type { ActivityKind, GameState } from "../game/types.ts";

export type MusicMovement =
  | "calm"
  | "growth"
  | "pressure"
  | "crisis"
  | "recovery"
  | "bankruptcy";

export interface MusicSnapshot {
  seed: number;
  gameMinute: number;
  status: GameState["clock"]["status"];
  pressure: number;
  momentum: number;
}

export interface MusicTarget {
  movement: MusicMovement;
  intensity: 0 | 1 | 2;
  variant: number;
  nextMovement?: "calm" | "growth";
}

export interface MovementArrangement {
  tempo: number;
  chordRoots: readonly number[];
  chordQualities: readonly (readonly number[])[];
  motif: readonly number[];
  bassPattern: readonly number[];
  melodyDensity: number;
  tonalCenter: number;
}

const POSITIVE_ACTIVITY_KINDS: ReadonlySet<ActivityKind> = new Set([
  "deal_won",
  "customer_renewed",
  "customer_expanded",
  "unlock_earned",
  "initiative_completed",
  "quarter_completed",
  "operating_goal_reached",
]);
const NEGATIVE_ACTIVITY_KINDS: ReadonlySet<ActivityKind> = new Set([
  "deal_lost",
  "customer_at_risk",
  "customer_churned",
  "ticket_sla_breached",
  "task_overdue",
  "crisis_entered",
]);
const RECENT_ACTIVITY_MINUTES = 7 * 24 * 60;

export const MOVEMENT_ARRANGEMENTS: Record<
  Exclude<MusicMovement, "recovery" | "bankruptcy">,
  MovementArrangement
> = {
  calm: {
    tempo: 78,
    chordRoots: [48, 50, 55, 53],
    chordQualities: [[0, 4, 7, 9, 14], [0, 3, 7, 10, 14], [0, 4, 7, 11, 14], [
      0,
      4,
      7,
      9,
      14,
    ]],
    motif: [4, 7, 9, 7, 4, 2, 0, 2],
    bassPattern: [0, -1, 4, -1, 7, -1, 9, -1],
    melodyDensity: 0.72,
    tonalCenter: 64,
  },
  growth: {
    tempo: 78,
    chordRoots: [48, 53, 50, 55],
    chordQualities: [[0, 4, 7, 11, 14], [0, 4, 7, 9, 14], [0, 3, 7, 10, 14], [
      0,
      4,
      7,
      10,
      14,
    ]],
    motif: [0, 2, 4, 7, 9, 11, 9, 7],
    bassPattern: [0, -1, 4, -1, 7, -1, 10, -1],
    melodyDensity: 0.92,
    tonalCenter: 64,
  },
  pressure: {
    tempo: 78,
    chordRoots: [50, 55, 48, 57],
    chordQualities: [[0, 3, 7, 10, 14], [0, 4, 7, 10, 14], [0, 4, 7, 11, 14], [
      0,
      3,
      7,
      10,
      14,
    ]],
    motif: [2, 3, 7, 9, 7, 5, 4, 2],
    bassPattern: [0, -1, 3, -1, 7, -1, 10, -1],
    melodyDensity: 0.82,
    tonalCenter: 62,
  },
  crisis: {
    tempo: 78,
    chordRoots: [50, 55, 52, 57],
    chordQualities: [[0, 3, 7, 10, 14], [0, 4, 7, 10, 14], [0, 3, 7, 10, 14], [
      0,
      4,
      7,
      10,
      14,
    ]],
    motif: [2, 3, 5, 7, 10, 9, 7, 5],
    bassPattern: [0, -1, 3, -1, 7, -1, 10, -1],
    melodyDensity: 1,
    tonalCenter: 62,
  },
};

export function musicSnapshotFor(state: GameState): MusicSnapshot {
  const metrics = operatingMetrics(state);
  const monthlyCost = Math.max(1, metrics.monthlyOperatingCostCents);
  const runwayMonths = state.company.cashCents / monthlyCost;
  const overdueTasks =
    Object.values(state.records.tasks).filter((task) =>
      task.status === "open" && task.dueAt < state.clock.gameMinute
    ).length;
  const atRiskCustomers = Object.values(state.records.customers).filter(
    (customer) => customer.lifecycle === "at_risk",
  ).length;
  const distressedTickets = Object.values(state.records.tickets).filter(
    (ticket) =>
      ticket.status !== "resolved" &&
      (ticket.priority === "urgent" || ticket.escalated ||
        ticket.responseBreachedAt !== undefined ||
        ticket.resolutionBreachedAt !== undefined),
  ).length;
  const overloadedStaff = [
    ...Object.values(state.records.salesReps),
    ...Object.values(state.records.successReps),
    ...Object.values(state.records.supportReps),
  ].filter((rep) => rep.burnout >= 60).length;
  const weightedPipelineCents = Object.values(state.records.deals).filter(
    (deal) => deal.stage !== "won" && deal.stage !== "lost",
  ).reduce(
    (total, deal) => total + deal.monthlyValueCents * deal.probability / 100,
    0,
  );
  const recentActivities = state.recentActivities.filter((activity) =>
    state.clock.gameMinute - activity.gameMinute <= RECENT_ACTIVITY_MINUTES
  );
  const positiveEvents =
    recentActivities.filter((activity) =>
      POSITIVE_ACTIVITY_KINDS.has(activity.kind)
    ).length;
  const negativeEvents =
    recentActivities.filter((activity) =>
      NEGATIVE_ACTIVITY_KINDS.has(activity.kind)
    ).length;

  let pressure = runwayMonths < 1
    ? 35
    : runwayMonths < 2
    ? 25
    : runwayMonths < 4
    ? 10
    : 0;
  pressure += Math.min(24, overdueTasks * 8);
  pressure += Math.min(20, atRiskCustomers * 10);
  pressure += Math.min(24, distressedTickets * 8);
  pressure += Math.min(16, overloadedStaff * 8);
  pressure += metrics.efficiencyPercent < 50
    ? 15
    : metrics.efficiencyPercent < 80
    ? 8
    : 0;
  pressure += Math.min(15, negativeEvents * 5);

  let momentum = metrics.efficiencyPercent >= 150
    ? 20
    : metrics.efficiencyPercent >= 100
    ? 10
    : 0;
  momentum += Math.min(
    20,
    Math.round(
      weightedPipelineCents / Math.max(100_000, state.company.mrrCents) * 10,
    ),
  );
  momentum += state.unlocks.length * 5;
  momentum += Math.min(12, state.platform.initiativesCompleted * 4);
  momentum += Math.min(20, positiveEvents * 5);

  return {
    seed: state.seed,
    gameMinute: state.clock.gameMinute,
    status: state.clock.status,
    pressure: Math.min(100, pressure),
    momentum: Math.min(100, momentum),
  };
}

export function resolveMusicTarget(
  snapshot: MusicSnapshot,
  previous?: MusicTarget,
): MusicTarget {
  const variant = snapshot.seed % 4;
  if (snapshot.status === "bankrupt") {
    return { movement: "bankruptcy", intensity: 2, variant };
  }
  if (snapshot.status === "crisis") {
    return { movement: "crisis", intensity: 2, variant };
  }

  const pressureActive = previous?.movement === "pressure" ||
      previous?.movement === "crisis"
    ? snapshot.pressure >= 25
    : snapshot.pressure >= 40;
  const destination = pressureActive
    ? "pressure"
    : snapshot.pressure < 25 && snapshot.momentum >= 35
    ? "growth"
    : "calm";
  if (
    previous && ["pressure", "crisis"].includes(previous.movement) &&
    destination !== "pressure"
  ) {
    return {
      movement: "recovery",
      intensity: 1,
      variant,
      nextMovement: destination,
    };
  }
  const intensity = Math.min(
    2,
    Math.floor(
      (destination === "growth" ? snapshot.momentum : snapshot.pressure) / 34,
    ),
  ) as 0 | 1 | 2;
  return { movement: destination, intensity, variant };
}

export function musicDirectionKey(target: MusicTarget): string {
  return [
    target.movement,
    target.intensity,
    target.variant,
    target.nextMovement ?? "",
  ].join(":");
}

export function movementTonalCenter(movement: MusicMovement): number {
  if (movement === "recovery") return 64;
  if (movement === "bankruptcy") return 62;
  return MOVEMENT_ARRANGEMENTS[movement].tonalCenter;
}
