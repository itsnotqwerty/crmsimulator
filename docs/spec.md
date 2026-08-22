# CRM Simulator Product Specification

## 1. Product statement

CRM Simulator is a single-player incremental management game presented entirely
as an original, realistic customer relationship management application. The
player operates a small B2B SaaS company and grows it from a founder-managed
lead inbox into a mature marketing, sales, customer success, support, and
operations organization.

The interface must look and behave like working business software. Progress
appears as new records, reports, controls, teams, and modules becoming necessary
and available. The game must not use a separate map, character screen, XP bar,
or conventional game HUD.

## 2. Product principles

1. **The CRM is the game.** Every meaningful action occurs through a credible
   CRM workflow.
2. **Complexity is earned.** The first session exposes only the tools needed to
   acquire and manage initial customers.
3. **Business milestones unlock tools.** Features unlock because the company has
   reached an operational need, not because the player gained an abstract level.
4. **Decisions have operating consequences.** Growth consumes cash and staff
   capacity; poor targeting, neglected follow-up, and weak service reduce
   performance.
5. **Failure is real and legible.** Active mismanagement can bankrupt the
   company. The CRM must show why.
6. **Growth is endless.** There is no final victory screen. Mature companies
   continue pursuing scale, efficiency, retention, and resilience.
7. **Records feel real but remain fictional.** Generated people and companies
   must be plausible without copying real organizations or a branded CRM.

## 3. Audience and experience

The game is for players who enjoy incremental systems, optimization, management
simulations, or operational software. Familiarity with CRM terminology is not
required.

The intended opening experience is a stylish, restrained workspace with:

- a live inbox containing the first inbound leads;
- a short queue of contextual work tasks;
- a compact dashboard with cash, MRR, leads, and customers;
- contacts and account records that become richer through interaction;
- locked navigation entries that state their business requirement.

Instruction is embedded in tasks, empty states, field labels, and feedback.
There is no detached tutorial level.

## 4. Company premise

The player is the founder-operator of a small B2B SaaS company selling monthly
subscriptions to fictional businesses.

The company begins with:

- a player-defined company name;
- a modest cash runway;
- no employees;
- no paying customers;
- one basic product plan;
- a small stream of inbound leads;
- founder capacity for outreach and account work;
- Dashboard, Inbox, Contacts, and Tasks modules.

The company grows through recurring revenue. Its main constraints are cash,
demand, lead quality, conversion, workload, service quality, and staff capacity.

## 5. Time model

### 5.1 Game clock

One real minute equals one game hour. The simulation advances from elapsed
timestamps rather than animation frames.

Rules and recurring effects are evaluated in fixed intervals. Given the same
saved state, seed, player commands, and elapsed time, the result must be
identical.

The UI may update its clock every second, but simulation correctness must not
depend on render frequency or tab focus.

### 5.2 Active progress

While the application is open:

- inbound leads, task deadlines, campaigns, recurring revenue, payroll,
  workload, customer health, renewals, and incidents advance with game time;
- manual actions apply immediately through validated game commands;
- the game autosaves after meaningful mutations and at safe lifecycle
  boundaries;
- cash may fall below the bankruptcy threshold.

### 5.3 Offline progress

When the player returns, the game simulates at most 24 real hours of elapsed
time.

Offline resolution uses the same engine as active play, with one exception: it
stops at the last safe interval before an expense would cause bankruptcy. The
company enters **Crisis Pause**, and the player must reduce costs, recover
revenue, or otherwise act before resuming time.

Elapsed time beyond the 24-hour cap is discarded. It is not queued for later
resolution.

The player receives an offline summary showing elapsed time processed, leads
received, revenue and costs accrued, customer changes, completed work,
incidents, and the reason for any crisis pause.

## 6. Core resources and metrics

### 6.1 Primary resources

- **Cash:** Liquid operating balance. Active play below the bankruptcy threshold
  ends the company.
- **MRR:** Monthly recurring revenue from active subscriptions.
- **Capacity:** Available founder and employee work time by function.
- **Demand:** Rate and quality of inbound leads generated organically or by
  campaigns.
- **Customer health:** Per-account likelihood of renewal, expansion, support
  load, and churn.

### 6.2 Core KPIs

The CRM surfaces metrics only when they become actionable:

- leads created and qualified;
- response and conversion rates;
- open pipeline and weighted pipeline;
- customers and net-new MRR;
- cash burn and runway;
- campaign spend, CAC, and attribution;
- workload and utilization;
- gross and net revenue retention;
- ticket volume and SLA attainment;
- forecast versus actual performance.

Early dashboards show only cash, MRR, leads, customers, and due tasks.
Additional metrics unlock with their underlying module.

## 7. Initial playable loop

The first release must support a complete lead-to-customer loop:

1. An inbound lead appears in the Inbox.
2. The player opens the lead and reviews fit and engagement signals.
3. The player qualifies, disqualifies, emails, or calls the lead.
4. Successful outreach creates follow-up work and advances interest.
5. A qualified lead becomes a deal with value, plan, probability, and expected
   close time.
6. Continued timely work can close the deal.
7. A won deal creates an account, contact, subscription, activity history, MRR,
   and onboarding tasks.
8. Subscription revenue and operating expenses accrue over game time.
9. Repeated success unlocks acquisition and sales tools; neglect reduces
   conversion and customer health.

Manual work consumes capacity. Ignored leads cool over time, overdue tasks
reduce outcomes, and activity records explain state changes.

## 8. CRM records

### 8.1 Leads and contacts

Records include fictional identity, company, role, source, fit, engagement,
lifecycle status, owner, last activity, next task, and generated communication
history. Some fields are hidden until scoring or enrichment unlocks.

### 8.2 Companies and accounts

Company records include industry, size, region, contacts, open deals,
subscriptions, health, owner, activities, and service history. Early in the
game, company and contact information may be incomplete.

### 8.3 Deals

Deals move through credible stages: New, Qualified, Discovery, Evaluation,
Negotiation, Won, and Lost. Stage progression is caused by player work, lead
fit, response, timing, and capacity rather than arbitrary clicking alone.

### 8.4 Activities and tasks

Calls, emails, notes, status changes, campaign touches, support events, and
system outcomes appear in chronological activity history. Tasks carry type,
priority, due time, owner, related records, and completion state.

Old detailed activity may be summarized into immutable aggregate history when
required to keep cookie saves within budget.

## 9. Progression and unlocks

Exact numeric thresholds are balancing data, not hard-coded UI logic. Each
unlock must require both measurable company progress and a demonstrated
operational need.

### Tier 0: Founder inbox

Available immediately:

- Dashboard;
- Lead Inbox;
- Contacts and basic companies;
- Tasks;
- call, email, qualify, disqualify, and follow-up actions;
- cash, MRR, expense, and capacity simulation.

### Tier 1: Repeatable acquisition

Unlocked after acquiring and retaining the first customers:

- Marketing workspace;
- campaigns with audience, channel, message, daily budget, and duration;
- deterministic channel spend and attributed lead delivery over game time;
- campaign pause and resume controls;
- audience segments;
- basic lead scoring;
- single-touch attribution;
- CAC and conversion reporting.

### Tier 2: Sales operations

Unlocked at $1,000 MRR and three open deals:

- pipeline board and list views;
- stage age, expected close timing, value, probability, weighted pipeline, and
  forecast MRR derived from canonical deals;
- editable Starter, Growth, and Scale product tiers, with seat pricing, monthly
  or annual billing, bounded discounts, and explicit reasons for closed-lost
  deals;
- deal-stage customization within supported rules;
- sales representatives, ownership, and assignment;
- targets, territories, routing, and forecast views;
- draft, sent, accepted, and expired quotes that close canonical deals.

### Tier 3: Retention and service

Unlocked through active-customer and renewal volume:

- customer health and success workspaces;
- onboarding, adoption, check-ins, renewals, expansion, and churn risk driven by
  account health and neglect;
- support inbox with priority- and channel-based tickets, ownership, response
  and resolution SLAs, and account-health penalties for missed deadlines;
- dedicated service staffing with payroll, skill, capacity, and burnout;
- escalations and incidents with ongoing account impact and measured resolution
  quality;
- NPS and retention reporting.

### Tier 4: Automation and analytics

Unlocked when manual process load becomes material:

- sequences and workflow automation;
- funnel, cohort, and attribution reports;
- forecasting and variance analysis;
- custom fields, filters, dashboards, and saved views;
- simulated integrations.

### Tier 5: Mature operations

Unlocked as staffing and process complexity grow:

- departments, budgets, hiring, training, and burnout;
- advanced capacity planning and data hygiene;
- simulated roles and permissions;
- larger market segments and operational incidents;
- aggregate historical analysis and endless scaling goals.

Locked modules remain visible in navigation and state the milestone or condition
required to unlock them.

## 10. Marketing simulation

Campaigns combine audience, channel, spend, duration, and message. Results
depend on market fit, audience quality, saturation, channel performance, and
deterministic seeded variation.

The first marketing release uses single-touch attribution. Weighted multi-touch
attribution belongs to the later analytics tier.

Campaigns generate leads over time rather than immediately. Spend reduces cash
as configured. Poor campaigns may create low-quality demand and increase
workload without producing viable pipeline. Repeated delivery into the same
campaign audience increases saturation and lowers the fit of later leads.

Detailed campaign records are bounded. The oldest archived records compact into
aggregate campaign counts, spend, and lead history so long-running saves remain
within the cookie budget.

## 11. Staffing and operations

Employees have function, compensation, skill, capacity, utilization, and
burnout. Hiring increases throughput but creates recurring costs. Training
temporarily consumes capacity while improving future performance.

The first sales hires are named junior, mid-level, or senior representatives.
Their level fixes monthly compensation, selling skill, and concurrent-deal
capacity. Deals can remain founder-owned or be explicitly assigned. Skill
improves stage probability gains, while assignments above capacity reduce them.
Each representative also has a territory and monthly target. Manual routing
assigns active unowned leads to the least-loaded eligible representative, and
qualification carries ownership into the resulting deal. Rep queues and target
coverage derive from canonical lead and deal ownership.

Work must be assigned explicitly or through unlocked routing and automation.
Overloaded teams miss deadlines and reduce customer outcomes. Underused teams
waste cash.

Permissions are a simulated organizational control only. They never create real
users, login, authentication, or authorization.

## 12. Failure and restart

### 12.1 Bankruptcy

During active play, the company is bankrupt when cash crosses the configured
threshold and no immediate protected transaction remains to resolve.

The simulation stops and displays a bankruptcy report containing:

- company age;
- peak and final MRR;
- customers acquired and lost;
- cash-flow history;
- major expenses and incidents;
- the events immediately preceding failure;
- unlocked modules and operational milestones.

The run cannot continue. The player starts a new company with a new seed.
Exporting the failed run as a historical record may be offered, but it cannot
bypass bankruptcy.

### 12.2 Crisis Pause

Crisis Pause exists only to prevent unseen offline bankruptcy. It is not a
general safety net. Time remains paused until the player makes a valid
corrective change or elects to resume and accept the risk.

## 13. Persistence and portability

Cookies are the only live persistence mechanism. The game must not store state
in localStorage, sessionStorage, IndexedDB, a service worker cache, a database,
or an external service.

The game supports:

- automatic cookie saves;
- schema-version migrations;
- signed and validated save data;
- explicit JSON export and import through `/`;
- reset from settings;
- visible save status and storage-budget usage;
- recovery from corrupt or incompatible cookies without silently overwriting the
  last valid save.

An exported file is a user backup, not an alternate source of live application
state.

## 14. Interface requirements

- The application is a single-page workspace mounted at `/`.
- Internal navigation changes the active workspace without page navigation.
- The design is original, light, neutral, data-dense, and suitable for repeated
  operational work.
- It must not reproduce another CRM's branding, proprietary assets, wording, or
  exact trade dress.
- Tables support useful sorting, filtering, selection, and row actions.
- Detail records preserve context through panels or workspace transitions.
- Controls have keyboard access, visible focus, and appropriate labels.
- Desktop and mobile layouts must not overlap, clip controls, or resize
  unpredictably.
- Motion is restrained and honors reduced-motion preferences.
- Company identity and accessibility preferences persist with the company save.
- Game concepts appear as business language and CRM feedback, not arcade
  effects.

## 15. Routing requirements

All application and persistence traffic uses `/`:

- `GET /` renders and hydrates the current company;
- `POST /` handles save, reset, export, and import actions.

There are no additional page routes or API routes. Fresh-generated JavaScript,
CSS, source maps, icons, fonts, and other static assets may use their normal
asset URLs. This asset exception is required by the Fresh runtime and does not
permit application data endpoints.

## 16. Initial release acceptance criteria

The first playable release is complete when:

1. A new player can enter the CRM at `/` without login or setup screens.
2. Contextual tasks guide the player through the first lead-to-customer
   workflow.
3. Leads arrive, cool, and respond deterministically over game time.
4. The player can qualify leads, perform outreach, manage tasks, close deals,
   and create customers.
5. Cash, MRR, expenses, capacity, and recurring subscription effects advance
   correctly.
6. Refreshing the page restores the company exclusively from cookies.
7. Returning after elapsed time produces a bounded offline summary and pauses
   before unseen bankruptcy.
8. Active cash failure produces a bankruptcy report and requires restart.
9. At least one milestone unlock reveals a new CRM capability.
10. Export, import, reset, and corrupt-save recovery work through `POST /`.
11. No application or data request uses a route other than `/`.
12. The production build passes formatting, linting, type checks, engine tests,
    and responsive browser verification.

## 17. Out of scope

The following are intentionally excluded:

- login, authentication, real users, or real permissions;
- multiplayer, leaderboards, shared companies, or cloud saves;
- databases, Supabase, external analytics, or server-side game storage;
- localStorage, sessionStorage, IndexedDB, or service-worker persistence;
- real email, phone, payment, advertising, or third-party integrations;
- additional application or API routes;
- exact imitation of a branded CRM;
- a finite campaign ending or final victory state.
