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
  const firstLead = Object.values(data.game.records.leads)[0];
  const firstCompany = firstLead
    ? data.game.records.companies[firstLead.companyId]
    : undefined;
  const showPrologue = data.game.narrative.chapter === 0 &&
    data.game.narrative.pendingBriefing;

  return (
    <>
      <Head>
        <title>CRM Simulator</title>
        <meta
          name="description"
          content="Create and grow your virtual business through real-world CRM workflows. Manage your contacts, sales, and marketing campaigns and build to infinity."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#173f35" />
        <link rel="stylesheet" href="/crm-styles" />
      </Head>
      <div class="site-shell">
        {showPrologue
          ? (
            <main
              class={`crm-app prologue-screen palette-${data.game.preferences.palette} ${
                data.game.preferences.darkMode ? "dark-mode" : ""
              }`}
            >
              <div class="prologue-atmosphere" />
              <article class="prologue-letter">
                <span class="story-eyebrow">Prologue · The runway email</span>
                <header>
                  <div class="letter-avatar">MV</div>
                  <div>
                    <small>From</small>
                    <strong>Mara Voss · Board Partner</strong>
                  </div>
                  <time>06:12</time>
                </header>
                <div class="prologue-subject">
                  <small>Subject</small>
                  <h1>Ninety days</h1>
                </div>
                <div class="prologue-copy">
                  <p>Founder,</p>
                  <p>
                    The account is down to one quarter of runway. The board will
                    not authorize another transfer on the strength of a roadmap.
                  </p>
                  <p>
                    Prove that someone will pay for the product, then prove it
                    can become a company without every customer depending on
                    you.
                  </p>
                  <p>
                    You have one lead waiting from {firstCompany?.name ??
                      "a prospective account"}. Start there.
                  </p>
                  <p class="letter-signoff">Mara</p>
                </div>
                <div class="prologue-stakes">
                  <div>
                    <span>Cash remaining</span>
                    <strong>
                      ${(data.game.company.cashCents / 100).toLocaleString(
                        "en-US",
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>Monthly burn</span>
                    <strong>
                      ${(data.game.company.baselineMonthlyExpensesCents / 100)
                        .toLocaleString("en-US")}
                    </strong>
                  </div>
                  <div>
                    <span>Board directive</span>
                    <strong>Win the first customer</strong>
                  </div>
                </div>
                <form method="post" action="/">
                  <input type="hidden" name="type" value="begin" />
                  <button type="submit" class="primary prologue-begin">
                    Open the CRM <span aria-hidden="true">→</span>
                  </button>
                </form>
              </article>
            </main>
          )
          : (
            <CrmApp
              initial={data.game}
              loadStatus={data.loadStatus}
              offlineSummary={data.offlineSummary}
              loadError={data.loadError}
            />
          )}
        <footer class="site-footer">
          <p>
            © 2026 Samuel Roux ·{"  "}
            <a href="https://github.com/itsnotqwerty/crmsimulator">
              View the code
            </a>
          </p>
          <p class="donate-line">
            Cool Freakin' Games is funded entirely by donations
            <a
              class="donate"
              href="bitcoin:bc1qsxmj8euqjqqze36kweglg4kut30f95gygmhyz3"
            >
              <span aria-hidden="true">₿</span> Donate Bitcoin
            </a>
          </p>
        </footer>
      </div>
    </>
  );
}
