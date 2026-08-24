import type { Handlers } from "$fresh/server.ts";
import { stylesheetResponse } from "../lib/server/stylesheet.ts";

export const handler: Handlers = {
  GET() {
    return stylesheetResponse();
  },
};
