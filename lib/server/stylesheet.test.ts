import { assert, assertEquals } from "$std/assert/mod.ts";
import { stylesheetResponse } from "./stylesheet.ts";

Deno.test("stylesheet response preserves files larger than 64 KiB", async () => {
  const source = await Deno.readFile(
    new URL("../../static/crm.css", import.meta.url),
  );
  const response = await stylesheetResponse();
  const body = new Uint8Array(await response.arrayBuffer());

  assert(source.byteLength > 65_536);
  assertEquals(response.headers.get("content-type"), "text/css; charset=UTF-8");
  assertEquals(
    response.headers.get("content-length"),
    String(source.byteLength),
  );
  assertEquals(body, source);
});
