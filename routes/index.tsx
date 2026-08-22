import { Head } from "$fresh/runtime.ts";
import type { Handlers, PageProps } from "$fresh/server.ts";
import CrmApp from "../islands/CrmApp.tsx";
import {
  getRootConfig,
  handleRootPost,
  loadRoot,
  type RootPageData,
} from "../lib/server/root.ts";

export const handler: Handlers<RootPageData> = {
  async GET(request, context) {
    const loaded = await loadRoot(request, getRootConfig(request));
    const response = await context.render(loaded.data);
    response.headers.set("Cache-Control", "no-store");
    for (const cookie of loaded.setCookies) {
      response.headers.append("Set-Cookie", cookie);
    }
    return response;
  },
  POST(request) {
    return handleRootPost(request, getRootConfig(request));
  },
};

export default function RootPage({ data }: PageProps<RootPageData>) {
  return (
    <>
      <Head>
        <title>Signal Ridge CRM</title>
        <meta
          name="description"
          content="Run a growing B2B software company from a living CRM workspace."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#173f35" />
        <link rel="stylesheet" href="/crm.css" />
      </Head>
      <CrmApp
        initial={data.game}
        loadStatus={data.loadStatus}
        offlineSummary={data.offlineSummary}
        loadError={data.loadError}
      />
    </>
  );
}
