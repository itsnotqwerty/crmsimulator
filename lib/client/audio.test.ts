import { assert, assertAlmostEquals, assertEquals } from "$std/assert/mod.ts";
import {
  MUSIC_PHRASE_SECONDS,
  musicGainForVolume,
  notificationFrequencies,
  notificationToneFor,
  renderMusicLoop,
} from "./audio.ts";
import type { MusicMovement, MusicTarget } from "./music.ts";

Deno.test("notification events map to restrained sound cues", () => {
  assertEquals(notificationToneFor("deal_won"), "positive");
  assertEquals(notificationToneFor("ticket_sla_breached"), "attention");
  assertEquals(notificationToneFor("lead_created"), "neutral");
  assertEquals(notificationToneFor("lead_contacted"), undefined);
});

Deno.test("music volume maps safely onto the lounge gain", () => {
  assertEquals(musicGainForVolume(0), 0);
  assertAlmostEquals(musicGainForVolume(35), 0.03824, 0.00001);
  assertAlmostEquals(musicGainForVolume(100), 0.70795, 0.00001);
  assertAlmostEquals(musicGainForVolume(150), 0.70795, 0.00001);
  assert(musicGainForVolume(100) > musicGainForVolume(35) * 18);
});

Deno.test("music loop is finite, bounded, and audible", () => {
  const samples = renderMusicLoop(8_000);
  assert(samples.length > 90_000);
  assert(samples.every(Number.isFinite));
  assert(samples.some((sample) => Math.abs(sample) > 0.1));
  assert(samples.every((sample) => Math.abs(sample) <= 1));
});

Deno.test("adaptive movements render deterministic phrase-aligned buffers", () => {
  const sampleRate = 4_000;
  const movements: MusicMovement[] = [
    "calm",
    "growth",
    "pressure",
    "crisis",
    "recovery",
    "bankruptcy",
  ];
  const signatures = movements.map((movement) => {
    const target: MusicTarget = {
      movement,
      intensity: movement === "calm" ? 0 : 1,
      variant: 2,
      ...(movement === "recovery" ? { nextMovement: "growth" as const } : {}),
    };
    const first = renderMusicLoop(sampleRate, target);
    const repeat = renderMusicLoop(sampleRate, target);
    const expectedPhrases = movement === "bankruptcy" ? 1 : 2;
    assertEquals(
      first.length,
      Math.ceil(MUSIC_PHRASE_SECONDS * expectedPhrases * sampleRate),
    );
    assertEquals(first, repeat);
    assert(first.every(Number.isFinite));
    assert(first.some((sample) => Math.abs(sample) > 0.05));
    assert(first.every((sample) => Math.abs(sample) <= 1));
    return first.reduce(
      (total, sample, index) => total + (index % 97 === 0 ? sample : 0),
      0,
    );
  });

  assertEquals(new Set(signatures).size, movements.length);
});

Deno.test("company variants change arrangement without changing duration", () => {
  const first = renderMusicLoop(4_000, {
    movement: "growth",
    intensity: 1,
    variant: 0,
  });
  const second = renderMusicLoop(4_000, {
    movement: "growth",
    intensity: 1,
    variant: 1,
  });

  assertEquals(first.length, second.length);
  assert(first.some((sample, index) => sample !== second[index]));
});

Deno.test("notification tones follow the active movement tonal center", () => {
  const calm = notificationFrequencies("positive", "calm");
  const pressure = notificationFrequencies("positive", "pressure");

  assertEquals(calm.length, 2);
  assertEquals(pressure.length, 2);
  assert(calm[0] > pressure[0]);
});
