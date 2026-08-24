import { assertEquals, assertNotEquals } from "$std/assert/mod.ts";
import { createInitialState } from "../game/state.ts";
import {
  musicDirectionKey,
  musicSnapshotFor,
  resolveMusicTarget,
} from "./music.ts";

Deno.test("music direction begins calm and varies deterministically by seed", () => {
  const first = resolveMusicTarget(
    musicSnapshotFor(createInitialState({ seed: 5, now: 1_000 })),
  );
  const repeat = resolveMusicTarget(
    musicSnapshotFor(createInitialState({ seed: 5, now: 2_000 })),
  );
  const other = resolveMusicTarget(
    musicSnapshotFor(createInitialState({ seed: 6, now: 1_000 })),
  );

  assertEquals(first.movement, "calm");
  assertEquals(musicDirectionKey(first), musicDirectionKey(repeat));
  assertNotEquals(first.variant, other.variant);
});

Deno.test("music pressure uses hysteresis and resolves through recovery", () => {
  const pressured = resolveMusicTarget({
    seed: 4,
    gameMinute: 100,
    status: "active",
    pressure: 45,
    momentum: 50,
  });
  const held = resolveMusicTarget({
    seed: 4,
    gameMinute: 110,
    status: "active",
    pressure: 30,
    momentum: 50,
  }, pressured);
  const recovered = resolveMusicTarget({
    seed: 4,
    gameMinute: 120,
    status: "active",
    pressure: 20,
    momentum: 50,
  }, held);

  assertEquals(pressured.movement, "pressure");
  assertEquals(held.movement, "pressure");
  assertEquals(recovered, {
    movement: "recovery",
    intensity: 1,
    variant: 0,
    nextMovement: "growth",
  });
});

Deno.test("crisis and bankruptcy override metric scores", () => {
  assertEquals(
    resolveMusicTarget({
      seed: 9,
      gameMinute: 0,
      status: "crisis",
      pressure: 0,
      momentum: 100,
    }).movement,
    "crisis",
  );
  assertEquals(
    resolveMusicTarget({
      seed: 9,
      gameMinute: 0,
      status: "bankrupt",
      pressure: 0,
      momentum: 100,
    }).movement,
    "bankruptcy",
  );
});

Deno.test("old activities do not permanently influence music", () => {
  const initial = createInitialState({ seed: 7, now: 1_000 });
  const oldActivity = {
    id: "activity_old",
    kind: "deal_won" as const,
    summary: "Old win",
    gameMinute: 0,
  };
  const recentActivity = {
    ...oldActivity,
    id: "activity_recent",
    gameMinute: 9 * 24 * 60,
  };
  const oldSnapshot = musicSnapshotFor({
    ...initial,
    clock: { gameMinute: 10 * 24 * 60, status: "active" },
    recentActivities: [oldActivity],
  });
  const recentSnapshot = musicSnapshotFor({
    ...initial,
    clock: { gameMinute: 10 * 24 * 60, status: "active" },
    recentActivities: [recentActivity],
  });

  assertEquals(oldSnapshot.momentum, 0);
  assertEquals(recentSnapshot.momentum, 5);
});
