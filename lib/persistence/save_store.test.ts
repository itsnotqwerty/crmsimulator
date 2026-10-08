import { assertEquals } from "$std/assert/mod.ts";
import postgres from "postgres";
import { createInitialState } from "../game/state.ts";
import { PostgresGameSaveStore } from "./save_store.ts";

Deno.test({
  name: "Postgres saves enforce capabilities and concurrent revisions",
  ignore: !Deno.env.get("TEST_DATABASE_URL"),
  async fn() {
    const sql = postgres(Deno.env.get("TEST_DATABASE_URL")!, { max: 2 });
    const store = new PostgresGameSaveStore(sql);
    const state = createInitialState({ seed: 91, now: 1_000 });
    const credential = await store.create(state);
    try {
      assertEquals(await store.load(credential), state);
      const wrong = { ...credential, token: "b".repeat(43) };
      assertEquals(await store.load(wrong), undefined);
      assertEquals(await store.update(wrong, state, state.revision), "missing");
      await store.delete(wrong);
      assertEquals(await store.load(credential), state);
      const updated = { ...state, revision: state.revision + 1 };
      const results = await Promise.all([
        store.update(credential, updated, state.revision),
        store.update(credential, updated, state.revision),
      ]);
      assertEquals(results.sort(), ["conflict", "saved"]);
      assertEquals(await store.load(credential), updated);
      await store.delete(credential);
      assertEquals(await store.load(credential), undefined);
    } finally {
      await store.delete(credential);
      await sql.end();
    }
  },
});
