# CRM Simulator

CRM Simulator is a single-player incremental management game presented as an
original, realistic CRM. The player runs a small B2B SaaS company, beginning
with a minimal lead inbox and gradually unlocking marketing, sales, customer
success, support, analytics, automation, and operations tools.

The CRM is the game: leads arrive over time, outreach consumes capacity, deals
become subscriptions, recurring revenue competes with operating costs, and
neglected work creates measurable business consequences. There is no login,
multiplayer, database, or cloud save.

## Status

The product specification, technical design, and implementation roadmap are
complete. Release 1 is implemented: the deterministic headless company engine,
command reducers, offline crisis rules, compact save codec, signed cookie
chunks, migrations, and foundation tests are available under `lib/`.

Release 2 is complete with a playable root-only SPA: the responsive CRM shell,
global search, Dashboard, Lead Inbox, Contacts, Companies, Tasks, deal workflow,
customer-referral acquisition, live simulation, cookie autosave, company naming,
reduced-motion preferences, import/export/reset, and recovery modals
implemented.

Release 3 is complete with persistent campaign records, configurable audience,
channel, budget, duration, and messaging, deterministic spend and attributed
lead delivery, full-funnel channel reporting, and campaign pause, edit,
duplicate, resume, archive, saturation, and bounded-history controls.

Release 4 begins with a Pipeline workspace unlocked by $1,000 MRR and three open
deals. Its list and board views expose stage age, expected close timing, deal
value, product tier, probability, weighted pipeline, forecast MRR, and explicit
closed-lost reasons. Named sales representatives add recurring compensation,
skill, deal capacity, ownership, territory routing, targets, derived activity
queues, and workload-sensitive forecasting. Quotes add seat-based Starter,
Growth, and Scale plans, monthly or discounted annual billing, commercial
discounts, validity periods, and a send-to-accept lifecycle that closes the
canonical deal. Missed follow-ups reduce engagement, sustained overload builds
rep burnout and lowers deal progression, while paid training improves skill and
relieves burnout. Pipeline list and board preferences persist with the save, and
list selection supports bulk ownership and stage advancement.

## Core rules

- One real minute equals one game hour.
- The simulation is deterministic from the company seed, state, commands, and
  elapsed time.
- Returning players receive up to 24 real hours of offline progress.
- Offline simulation pauses before unseen bankruptcy and opens a financial
  crisis workflow.
- Active mismanagement can bankrupt the company and require a new run.
- Progress is endless; there is no final victory screen.
- CRM modules unlock through business milestones and operational need, not XP
  levels.

## Application constraints

### Single-page, root-only application

All application and persistence traffic uses `/`:

- `GET /` loads, validates, migrates, advances, renders, and hydrates the
  company.
- `POST /` handles save, reset, export, and import actions.

There are no feature pages or API routes. Fresh-generated JavaScript, CSS,
source maps, icons, fonts, and static media may use their normal asset paths
because Fresh requires those requests to run the client application.

### Cookie-only storage

Cookies are the only live persistence mechanism. The game will not use:

- localStorage or sessionStorage;
- IndexedDB;
- service-worker game storage;
- a database or server-side save store;
- Supabase or another cloud persistence service.

Saves are designed to be compact, schema-versioned, gzip-compressed,
base64url-encoded, split across bounded cookie chunks, and signed by the server.
The root handler writes HttpOnly, SameSite=Strict cookies and sets Secure in
production.

Exported JSON files are explicit user backups, not an alternate source of live
state.

## First playable release

The initial release provides a complete founder-led lead-to-customer loop:

- compact CRM shell and responsive workspace navigation;
- Dashboard, Lead Inbox, Contacts, Companies, and Tasks;
- qualification, calls, emails, follow-up, deals, and customer creation;
- cash, MRR, operating expenses, founder capacity, and recurring subscriptions;
- contextual onboarding inside the live inbox;
- cookie autosave, import, export, reset, and corrupt-save recovery;
- offline summaries, Crisis Pause, bankruptcy reports, and restart;
- a customer milestone that unlocks referral-based acquisition.

Later releases add campaigns and attribution, sales teams and forecasting,
customer success and support, workflow automation and analytics, then mature
company operations.

## Stack

- [Deno](https://deno.com/) 2.x
- [Fresh](https://fresh.deno.dev/) 1.7
- [Preact](https://preactjs.com/) and Signals
- [Tailwind CSS](https://tailwindcss.com/) 3.4
- Deno standard library

## Development

Install Deno, then run:

```bash
deno task start
```

The development server is available at <http://localhost:8000>.

Available tasks:

| Task                 | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `deno task start`    | Start the Fresh development server with file watching |
| `deno task test`     | Run engine and persistence tests under `lib/`         |
| `deno task check`    | Check formatting, lint, and TypeScript types          |
| `deno task build`    | Create a production Fresh build                       |
| `deno task preview`  | Serve the production entry point locally              |
| `deno task manifest` | Regenerate the Fresh manifest                         |

The test task covers deterministic simulation, commands, offline crisis versus
active bankruptcy, schema validation, compression, signing, tamper rejection,
cookie flags, stale chunk cleanup, save-size budgets, and the root persistence
adapter including revision conflicts and corrupt-save recovery.

## Production configuration

Production requires a stable, high-entropy cookie signing secret:

```text
COOKIE_SECRET=<stable high-entropy secret>
```

The deployed application must use HTTPS so persistence cookies can use the
Secure flag. Changing or losing `COOKIE_SECRET` invalidates existing signed
saves unless an explicit key-rotation strategy is added later.

The files under `deploy/` are project-neutral systemd and nginx templates. The
installer requires an explicit service name and production command, supports
optional env/TLS/nginx configuration, and provides a non-root `--dry-run`. See
[deploy/README.md](deploy/README.md) for usage and prerequisites.

## Documentation

| Document                           | Contents                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| [docs/spec.md](docs/spec.md)       | Product rules, progression, time, failure, UX, and acceptance criteria             |
| [docs/design.md](docs/design.md)   | Root-only architecture, deterministic engine, cookie format, security, and testing |
| [docs/roadmap.md](docs/roadmap.md) | Independently playable releases and quality gates                                  |

These documents are the implementation contract. Intentional behavior changes
should update the relevant document before or alongside code.

## Explicitly out of scope

- authentication, real users, or real permission enforcement;
- multiplayer, leaderboards, shared companies, or cloud synchronization;
- real email, calling, payments, advertising, or third-party integrations;
- exact imitation of Salesforce, HubSpot, or another branded CRM;
- additional application or API routes;
- a finite campaign ending.

## Data durability

Browser cookies can be cleared by the user, browser policy, privacy tools, or
storage pressure. The game therefore provides explicit export and import, but it
cannot guarantee cloud-level durability. Players should export companies they
want to preserve before clearing browser data.
