# CRM Simulator Implementation Roadmap

This roadmap delivers the game as a sequence of independently playable releases.
Every release extends the same deterministic engine, root-only application
route, and cookie save contract.

A checkbox means implemented and verified, not merely scaffolded.

## Release 0: Documentation and clean baseline

**Outcome:** The repository accurately describes the CRM simulator and no longer
presents the old project as current behavior.

- [x] Define the product, time model, progression, failure, persistence, and
      routing rules.
- [x] Define the root-only Fresh architecture and deterministic engine
      boundaries.
- [x] Publish the staged implementation roadmap.
- [x] Replace the stale README with CRM Simulator setup and constraints.
- [x] Rename and verify stale `16spaces` deployment templates.
- [x] Remove unused Supabase and `jose` imports only after implementation proves
      they are unnecessary.

**Acceptance checks**

- Product, design, roadmap, and README agree on one real minute per game hour.
- They agree that cookies are the only live storage.
- They agree that `GET /` and `POST /` are the only app/data traffic paths.
- Transitional deployment naming is disclosed rather than presented as ready.

## Release 1: Engine and save foundation

**Outcome:** A tested headless company can advance deterministically and survive
a cookie round trip.

### Domain model

- [x] Add canonical types for company, clock, economy, capacity, CRM records,
      unlocks, history, onboarding, and preferences.
- [x] Define compact persisted representations separately from readable domain
      types.
- [x] Add stable IDs, sequence counters, schema version, content version, seed,
      PRNG cursor, revision, and timestamps.
- [x] Define runtime invariants and bounded collection limits.

### Simulation

- [x] Implement a seeded deterministic PRNG.
- [x] Generate plausible fictional leads, people, and companies from catalogs.
- [x] Implement fixed-interval clock advancement.
- [x] Implement lead arrival, cooling, outreach responses, qualification, deal
      creation, deal outcomes, and customer creation.
- [x] Implement cash, MRR, baseline expenses, founder capacity, and subscription
      accrual.
- [x] Emit bounded typed domain events and aggregate history.
- [x] Implement milestone evaluation and feature unlock events.
- [x] Implement active bankruptcy.
- [x] Implement 24-hour offline catch-up and Crisis Pause.

### Commands

- [x] Create typed commands for outreach, qualification, follow-up, task
      completion, deal progression, crisis action, and new-company reset.
- [x] Route every state mutation through pure validated reducers.
- [x] Ensure rejected commands leave state unchanged and explain the rejection.

### Persistence

- [x] Validate current and imported save schemas at runtime.
- [x] Add sequential migration infrastructure.
- [x] Implement compact JSON conversion, UTF-8, native gzip, and base64url.
- [x] Implement HMAC-SHA-256 signing with `COOKIE_SECRET`.
- [x] Implement a signed manifest and bounded numbered cookie chunks.
- [x] Expire stale chunks after smaller replacement saves.
- [x] Leave the previous save untouched when encoding or size checks fail.
- [x] Build representative opening and mature save-size fixtures.

**Acceptance checks**

- Identical seed, commands, and elapsed time produce identical state.
- Batched and segmented time advancement produce the same canonical result.
- Offline catch-up never exceeds 24 real hours and stops before bankruptcy.
- Active play can enter bankruptcy.
- Corrupt or modified chunks fail validation.
- Opening and mature fixtures remain below the documented save budget.
- `deno task test` and `deno task check` pass.

## Release 2: First playable CRM

**Outcome:** A player can open `/`, acquire the first customers through
realistic CRM work, reload safely, and fail through active bankruptcy.

### Root route

- [x] Create `routes/index.tsx` as the only application route.
- [x] Implement new-game, load, migration, and offline catch-up behavior in
      `GET /`.
- [x] Implement discriminated `save`, `reset`, `export`, and `import` actions in
      `POST /`.
- [x] Enforce same-origin state changes, strict body limits, schema validation,
      and no-store responses.
- [x] Set HttpOnly, SameSite=Strict, Path=/, bounded Max-Age, and production
      Secure cookie flags.
- [x] Reject stale save revisions without overwriting newer state.

### Application shell

- [x] Create one `CrmApp` root island and client store.
- [x] Add a compact responsive sidebar, top bar, global search/command entry,
      notifications, company menu, and save status.
- [x] Keep internal workspace navigation in component state without feature
      URLs.
- [x] Show locked modules with their business requirements.
- [x] Add visible Saved, Saving, and Save failed states.
- [x] Debounce saves and flush at supported page lifecycle boundaries.

### Initial CRM modules

- [x] Build the Dashboard with cash, MRR, leads, customers, due tasks, and
      recent activity.
- [x] Build the Lead Inbox with sorting, filtering, selection, status, and
      outreach actions.
- [x] Build Contacts and Companies with a compact table and contextual record
      details.
- [x] Build Tasks with type, priority, due time, related record, and completion
      controls.
- [x] Build deal details sufficient for the first qualification-to-close loop
      without exposing the full pipeline module.
- [x] Add realistic empty, loading, blocked, validation, and error states.

### Guided opening

- [x] Start directly in a live lead inbox with no setup wizard.
- [x] Use contextual tasks to teach inspection, qualification, outreach,
      follow-up, and closing.
- [x] Unlock the first acquisition capability after retained customers
      demonstrate repeatable demand.
- [x] Keep all guidance inside credible CRM UI.

### Failure and recovery

- [x] Show a detailed offline summary after meaningful elapsed time.
- [x] Show Crisis Pause with corrective actions and explicit resume risk.
- [x] Show an active-bankruptcy report with company history and required
      restart.
- [x] Add settings for company naming, accessibility preferences, cookie usage,
      export, import, and reset.
- [x] Recover visibly from corrupt or incompatible saves.

**Acceptance checks**

- A new player reaches a paying customer without leaving `/`.
- Leads cool, tasks expire, revenue accrues, and expenses reduce cash with game
  time.
- Hard refresh restores the accepted save exclusively from cookies.
- Closing and reopening produces deterministic bounded catch-up.
- Crisis Pause prevents unseen bankruptcy; active bankruptcy requires restart.
- Export/import/reset use only `POST /`.
- Browser storage inspection shows no localStorage, sessionStorage, or IndexedDB
  game data.
- Browser network inspection shows no app/data path other than `/`; Fresh/static
  assets are exempt.
- Desktop and mobile screenshots show no clipping or overlap.
- `deno task test`, `deno task check`, and `deno task build` pass.

## Release 3: Repeatable acquisition

**Unlock:** The company has acquired and retained its first cohort of customers.

**Outcome:** The player can deliberately generate and evaluate demand instead of
relying only on organic leads.

- [x] Add Marketing navigation and workspace.
- [x] Add campaign creation with audience, channel, spend, duration, and
      message.
- [x] Accrue spend and generate leads over game time.
- [x] Add audience segments and basic lead scoring.
- [x] Add source, campaign, and single-touch attribution fields.
- [x] Add spend, leads, conversion, pipeline, revenue, CAC, and channel reports.
- [x] Model saturation, poor targeting, and low-quality workload.
- [x] Add campaign pause and resume workflows.
- [x] Add campaign edit, duplicate, and archive workflows.
- [x] Extend save fixtures and aggregate old campaign history.

**Acceptance checks**

- Campaign results are deterministic from state, configuration, and elapsed
  time.
- Spend can increase bankruptcy risk.
- Low-quality acquisition can harm capacity and conversion.
- Marketing records behave like CRM records rather than instant purchase
  buttons.
- Existing saves migrate without losing the initial company.

## Release 4: Sales operations

**Unlock:** Sustained MRR and open-pipeline volume make founder-only selling
inefficient.

**Outcome:** The player manages a repeatable team-based sales process.

- [x] Add pipeline list and board views.
- [x] Add stage aging, probabilities, expected close dates, values, products,
      and loss reasons.
- [x] Add quotes and expanded subscription plans.
- [x] Add sales hiring, compensation, skill, capacity, assignment, and
      ownership.
- [x] Add lead routing, territories, targets, and rep activity queues.
- [x] Add weighted pipeline and forecast views.
- [x] Model missed follow-up, overloaded representatives, training, and burnout.
- [x] Add bulk actions and saved views needed at larger record counts.
- [x] Bound and aggregate detailed sales activities.

**Acceptance checks**

- Hiring increases capacity and recurring cost.
- Assignment and workload materially affect outcomes.
- Forecasts derive from canonical deals and expose variance after outcomes
  resolve.
- The pipeline remains usable by keyboard and on narrow screens.
- Mature sales fixtures remain within the cookie budget.

## Release 5: Customer success and support

**Unlock:** Customer and renewal volume creates retention work that founder
follow-up cannot absorb.

**Outcome:** Growth depends on retaining and supporting customers, not only
acquiring them.

- [x] Add account health, onboarding, adoption, renewal, expansion, and churn
      risk.
- [x] Add customer-success staff, ownership, playbooks, and work queues.
- [x] Add Support Inbox, tickets, priority, channel, status, assignment, and SLA
      timers.
- [x] Add support staffing, escalation, incidents, and resolution quality.
- [x] Add NPS and customer feedback workflows.
- [x] Add gross retention, net retention, churn, expansion, SLA, and workload
      reports.
- [x] Model neglected accounts, service overload, recovery, and customer loss.
- [x] Aggregate closed ticket and historical health detail.

**Acceptance checks**

- Customer health responds to onboarding, support, product events, and neglect.
- Renewals, expansion, and churn update recurring revenue correctly.
- SLA and workload tradeoffs are visible before outcomes resolve.
- Retention can stabilize or destroy an otherwise strong acquisition engine.

## Release 6: Automation and analytics

**Unlock:** Manual process volume and reporting needs exceed available
management capacity.

**Outcome:** The player designs systems that operate the CRM at scale.

- [x] Add sequences for repeatable sales and success outreach.
- [x] Add a visual trigger-condition-action workflow builder.
- [x] Execute automations through bounded deterministic commands and events.
- [x] Add loop detection, per-interval limits, errors, and execution history
      summaries.
- [x] Add funnel, cohort, retention, attribution, and forecast-variance reports.
- [x] Add weighted multi-touch attribution.
- [x] Add custom fields, filters, saved views, and dashboard composition.
- [x] Add simulated integrations with sync status, mappings, and failures.
- [x] Add data-quality and duplicate-management workflows.

**Acceptance checks**

- Automations cannot create unbounded events or save growth.
- The same workflow and inputs replay deterministically.
- Reports derive from bounded canonical or aggregate history.
- Automations never call real external services.

## Release 7: Mature operations and endless scale

**Unlock:** Multiple teams and larger markets require explicit operating
structure.

**Outcome:** The CRM becomes a full company operating system with no final
victory state.

- [x] Add departments, managers, budgets, headcount plans, and cross-team
      capacity.
- [x] Add hiring pipelines, training, compensation pressure, burnout, and
      attrition.
- [x] Add larger customer segments with longer cycles, larger contracts, and
      stricter service demands.
- [x] Add recurring operational incidents and resilience investments.
- [x] Add simulated roles, permissions, and approval workflows without real
      auth.
- [x] Add quarterly planning and efficiency targets.
- [x] Add advanced data hygiene, audit summaries, and archive controls.
- [x] Add escalating endless goals for growth, efficiency, retention, and
      resilience.
- [x] Consider an optional prestige-like voluntary company restart only after
      the endless loop is balanced; it is not part of the base promise.

**Acceptance checks**

- Mature play introduces decisions rather than only larger numbers.
- Every unlocked system appears as credible CRM or operations software.
- Historical aggregation keeps saves bounded over indefinite play.
- There is no final victory screen or forced campaign ending.

## Cross-release quality gates

Every release must:

1. Preserve deterministic replay and fixed-interval equivalence.
2. Migrate saves from all supported prior schema versions.
3. Keep all live persistence in signed cookies.
4. Keep every app/data request on `/`.
5. Add tests proportional to the new engine and persistence risk.
6. Pass `deno task test`, `deno task check`, and `deno task build`.
7. Verify desktop and mobile layouts with no overlap, clipping, or unstable
   control dimensions.
8. Check normal and representative mature save sizes.
9. Avoid unrelated infrastructure, auth, database, and branded-CRM scope.
10. Update the specification or design before intentionally changing a
    documented contract.

## Deferred cleanup

The repository began from a prior Fresh project scaffold. These items are not
gameplay work but must be completed before production release:

- [x] Verify deployment instructions against the final cookie secret and HTTPS
      requirements;
- [x] Review repository metadata, deploy workflow, and license text for stale
      project references.
