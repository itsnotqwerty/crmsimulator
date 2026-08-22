import { assert, assertAlmostEquals, assertEquals } from "$std/assert/mod.ts";
import { musicGainForVolume, notificationToneFor } from "./audio.ts";

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
