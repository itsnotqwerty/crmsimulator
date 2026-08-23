import { assert, assertAlmostEquals, assertEquals } from "$std/assert/mod.ts";
import {
  musicGainForVolume,
  notificationToneFor,
  renderMusicLoop,
} from "./audio.ts";

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
