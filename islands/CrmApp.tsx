import { useSignal } from "@preact/signals";
import {
  Activity,
  Archive,
  ArrowUpDown,
  BarChart3,
  Bell,
  Building2,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Columns3,
  Copy,
  Download,
  FileText,
  Gauge,
  GraduationCap,
  Inbox,
  LayoutDashboard,
  List,
  LockKeyhole,
  Mail,
  Menu,
  Music2,
  Pencil,
  Phone,
  RefreshCw,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Target,
  TriangleAlert,
  Upload,
  Users,
  Volume2,
  X,
} from "lucide-preact";
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { notificationToneFor, SoundDesign } from "../lib/client/audio.ts";
import { useGameStore } from "../lib/client/gameStore.ts";
import {
  musicDirectionKey,
  musicSnapshotFor,
  type MusicTarget,
  resolveMusicTarget,
} from "../lib/client/music.ts";
import {
  closeLossRiskPercent,
  quoteMonthlyValueCents,
} from "../lib/game/actions.ts";
import { selectGuidance } from "../lib/game/guidance.ts";
import {
  ONBOARDING_STEPS,
  onboardingActive,
  onboardingPausesSimulation,
  onboardingStepNumber,
  onboardingWorkspace,
  onboardingWorkspaceAvailable,
} from "../lib/game/onboarding.ts";
import { campaignSaturation } from "../lib/game/simulation.ts";
import {
  INITIATIVE_DEFINITIONS,
  initiativeDefinition,
  operatingMetrics,
  quarterDaysRemaining,
} from "../lib/game/platform.ts";
import {
  analyticsReport,
  campaignOutcomeSummary,
  retentionReport,
} from "../lib/game/reports.ts";
import {
  NARRATIVE_CHAPTERS,
  narrativeObjectives,
} from "../lib/game/narrative.ts";
import type {
  AdvanceSummary,
  AutomationAction,
  AutomationCondition,
  AutomationTrigger,
  BillingCycle,
  CampaignAudience,
  CampaignChannel,
  CampaignObjective,
  ColorPalette,
  CustomerAccountPlan,
  Deal,
  DealLossReason,
  DealNegotiationApproach,
  DealProduct,
  GameCommand,
  GameState,
  InitiativeType,
  Lead,
  ManagerDepartment,
  OnboardingStep,
  SalesRepLevel,
  SalesTerritory,
  Task,
  TicketResolutionApproach,
} from "../lib/game/types.ts";
import { DEFAULT_RULES } from "../lib/game/state.ts";
import type { LoadStatus } from "../lib/server/root.ts";

type View =
  | "campaign"
  | "dashboard"
  | "leads"
  | "contacts"
  | "companies"
  | "tasks"
  | "marketing"
  | "pipeline"
  | "customers"
  | "automation"
  | "analytics"
  | "operations"
  | "settings";

const TUTORIAL_COPY: Record<
  Exclude<OnboardingStep, "complete">,
  { title: string; detail: string; action: string; important?: string }
> = {
  inspect_lead: {
    title: "Start with the person, not the buttons",
    detail:
      "Open the first lead and read their role, company, fit, and intent. Fit shows whether they match the product; intent shows how ready they are to talk.",
    action: "Inspect the first lead",
  },
  contact_lead: {
    title: "Make the first outreach",
    detail:
      "Contact the lead from their record. Outreach consumes founder capacity and changes intent, so every interaction is a tradeoff.",
    action: "Open the lead",
  },
  explain_spam: {
    title: "Give every outreach room to work",
    important: "Important: Spam protection",
    detail:
      "Contacting the same lead again within one in-game hour is treated as spam. The outreach still costs founder capacity, but email drops intent by 20 and a call drops it by 30 instead of gaining intent. Every rapid repeat restarts the one-hour window. Wait at least one in-game hour before trying again; automated sales outreach is paced and avoids this penalty.",
    action: "I understand, continue",
  },
  review_contacts: {
    title: "Contacts remember the relationship",
    detail:
      "This workspace collects every person and their current status. Use it when you need relationship context rather than a queue of work.",
    action: "Continue to Companies",
  },
  review_company: {
    title: "Companies hold the account context",
    detail:
      "A contact is a person; a company is the account you may eventually sell to. Company records keep that buying context together.",
    action: "Continue to qualification",
  },
  qualify_lead: {
    title: "Turn interest into an opportunity",
    detail:
      "Qualify the contacted lead when the fit is credible. This creates a deal with value, probability, and a sales stage.",
    action: "Open the contacted lead",
  },
  review_tasks: {
    title: "Tasks keep promises from disappearing",
    detail:
      "Tasks are dated commitments created by sales and customer work. Review what is due before returning to the deal.",
    action: "Continue to the deal",
  },
  work_deal: {
    title: "Move the deal one stage at a time",
    detail:
      "Advance the opportunity through discovery, evaluation, and negotiation. Read each stage before committing to the next move.",
    action: "Work the first deal",
  },
  review_dashboard: {
    title: "Now the dashboard has meaning",
    detail:
      "Cash measures survival, MRR measures recurring revenue, and founder capacity limits today's work. These numbers summarize the decisions you just made.",
    action: "Continue to onboarding",
  },
  onboard_customer: {
    title: "A signed deal is not an active customer",
    detail:
      "Complete the new onboarding task. Activation improves adoption and health, protecting the revenue you just won.",
    action: "Open onboarding tasks",
  },
  repeat_sales: {
    title: "Prove the process is repeatable",
    detail:
      "Use the same inspect, contact, qualify, close, and onboard loop until the company has three customers. Marketing unlocks at three.",
    action: "Work the next lead",
  },
};

function tutorialAllowsView(game: GameState, next: View): boolean {
  if (!onboardingActive(game)) return true;
  if (
    next === "campaign" || next === "dashboard" || next === "leads" ||
    next === "contacts" || next === "companies" || next === "tasks" ||
    next === "settings"
  ) return onboardingWorkspaceAvailable(game, next);
  return false;
}

export interface CrmAppProps {
  initial: GameState;
  loadStatus: LoadStatus;
  offlineSummary?: AdvanceSummary;
  loadError?: string;
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function gameDate(gameMinute: number): string {
  const day = Math.floor(gameMinute / (24 * 60)) + 1;
  const minutes = gameMinute % (24 * 60);
  const hour = Math.floor(minutes / 60);
  return `Day ${day}, ${String(hour).padStart(2, "0")}:${
    String(minutes % 60).padStart(2, "0")
  }`;
}

function relativeGameTime(target: number, current: number): string {
  const difference = target - current;
  const absolute = Math.abs(difference);
  const unit = absolute >= 24 * 60
    ? `${Math.floor(absolute / (24 * 60))}d`
    : absolute >= 60
    ? `${Math.floor(absolute / 60)}h`
    : `${absolute}m`;
  return difference < 0 ? `${unit} overdue` : `in ${unit}`;
}

function statusLabel(value: string): string {
  return value.replaceAll("_", " ").replace(
    /^./,
    (letter) => letter.toUpperCase(),
  );
}

function savedAtLabel(savedAt: number | undefined, now: number): string {
  if (savedAt === undefined) return "Not saved yet";
  const elapsedMinutes = Math.max(0, Math.floor((now - savedAt) / 60_000));
  if (elapsedMinutes < 1) return "Saved just now";
  if (elapsedMinutes < 60) return `Saved ${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `Saved ${elapsedHours}h ago`;
  return `Saved ${Math.floor(elapsedHours / 24)}d ago`;
}

function initials(value: string): string {
  return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "")
    .join("").toUpperCase();
}

function MobileLeadActions(props: {
  lead: Lead;
  dispatch: (command: GameCommand) => void;
}) {
  const disabled = !["new", "contacted", "cold"].includes(
    props.lead.status,
  );
  return (
    <div class="mobile-contact-actions">
      <button
        type="button"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          props.dispatch({
            type: "contact_lead",
            leadId: props.lead.id,
            channel: "email",
          });
        }}
      >
        <Mail size={16} />Email
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          props.dispatch({
            type: "contact_lead",
            leadId: props.lead.id,
            channel: "call",
          });
        }}
      >
        <Phone size={16} />Call
      </button>
    </div>
  );
}

function Kpi(props: {
  label: string;
  value: string;
  detail: string;
  icon: JSX.Element;
  tone?: "positive" | "warning";
}) {
  return (
    <div class="kpi">
      <div class={`kpi-icon ${props.tone ?? ""}`}>{props.icon}</div>
      <div>
        <span>{props.label}</span>
        <strong>{props.value}</strong>
        <small>{props.detail}</small>
      </div>
    </div>
  );
}

function EmptyState(props: { title: string; detail: string }) {
  return (
    <div class="empty-state">
      <Target size={28} />
      <strong>{props.title}</strong>
      <span>{props.detail}</span>
    </div>
  );
}

function NarrativePanel(props: { game: GameState; onOpen: () => void }) {
  const chapter = NARRATIVE_CHAPTERS[props.game.narrative.chapter];
  const objectives = narrativeObjectives(props.game);
  const completed = props.game.narrative.chapter ===
    NARRATIVE_CHAPTERS.length - 1;
  return (
    <section class={`narrative-panel ${completed ? "complete" : ""}`}>
      <div class="narrative-heading">
        <div>
          <span>{chapter.eyebrow}</span>
          <strong>{chapter.title}</strong>
        </div>
        <b>
          {completed
            ? "Campaign complete"
            : `${props.game.narrative.chapter + 1}/5`}
        </b>
      </div>
      <p>{chapter.directive}</p>
      {objectives.length > 0 && (
        <div class="narrative-objectives">
          {objectives.map((objective) => {
            const done = objective.current >= objective.target;
            const format = (value: number) =>
              objective.format === "money"
                ? money.format(value / 100)
                : objective.format === "percent"
                ? `${value}%`
                : String(value);
            return (
              <div class={done ? "done" : ""}>
                <i>{done ? <Check size={13} /> : <Target size={13} />}</i>
                <span>{objective.label}</span>
                <b>
                  {format(Math.min(objective.current, objective.target))} /{" "}
                  {format(
                    objective.target,
                  )}
                </b>
              </div>
            );
          })}
        </div>
      )}
      <button type="button" class="narrative-open" onClick={props.onOpen}>
        <FileText size={15} />Read campaign briefing
      </button>
    </section>
  );
}

function TutorialPanel(props: {
  game: GameState;
  onAction: () => void;
  onSkip: () => void;
}) {
  if (!onboardingActive(props.game)) return null;
  const step = props.game.onboarding.step;
  if (step === "complete") return null;
  const copy = TUTORIAL_COPY[step];
  const total = ONBOARDING_STEPS.length - 1;
  return (
    <section
      class={`tutorial-panel ${copy.important ? "important" : ""}`}
      aria-labelledby="tutorial-title"
    >
      <div class="tutorial-progress" aria-label="Guided Chapter 1 progress">
        <span>
          Guided Chapter 1 · Step {onboardingStepNumber(step)} of {total}
        </span>
        <div>
          <i
            style={{ width: `${onboardingStepNumber(step) / total * 100}%` }}
          />
        </div>
      </div>
      <div class="tutorial-content">
        <div class="tutorial-icon">
          <GraduationCap size={21} />
        </div>
        <div>
          {copy.important && (
            <strong class="tutorial-important">
              <TriangleAlert size={14} /> {copy.important}
            </strong>
          )}
          <h2 id="tutorial-title">{copy.title}</h2>
          <p>{copy.detail}</p>
          {onboardingPausesSimulation(props.game) && (
            <small>
              <Clock3 size={13} /> Company time is paused while you read.
            </small>
          )}
        </div>
        <button
          type="button"
          class="primary tutorial-next-action"
          onClick={props.onAction}
        >
          {copy.action}
          <ChevronRight size={15} />
        </button>
      </div>
      <div class="tutorial-footer">
        <button
          type="button"
          class="secondary tutorial-skip"
          onClick={props.onSkip}
        >
          <X size={15} /> Skip guided Chapter 1
        </button>
      </div>
    </section>
  );
}

function CampaignWorkspace(props: { game: GameState }) {
  const chapter = NARRATIVE_CHAPTERS[props.game.narrative.chapter];
  const objectives = narrativeObjectives(props.game);
  return (
    <>
      <div
        id="campaign-briefing"
        class="page-heading campaign-page-heading"
        tabIndex={-1}
      >
        <div>
          <span>Founder Campaign</span>
          <h1>{chapter.title}</h1>
          <p>The decisions behind the dashboard, from last runway to scale.</p>
        </div>
        <span class={`campaign-state ${objectives.length ? "active" : "won"}`}>
          {objectives.length
            ? `Chapter ${props.game.narrative.chapter + 1} of 5`
            : "Campaign complete"}
        </span>
      </div>
      <div class="story-layout">
        <article class="panel board-letter">
          <header>
            <div class="letter-avatar">MV</div>
            <div>
              <span>From</span>
              <strong>{chapter.sender}</strong>
            </div>
            <div>
              <span>Subject</span>
              <strong>{chapter.subject}</strong>
            </div>
          </header>
          <span class="story-eyebrow">{chapter.eyebrow}</span>
          <p>{chapter.briefing}</p>
          <blockquote>{chapter.directive}</blockquote>
          {objectives.length > 0 && (
            <div class="campaign-objective-list">
              <strong>What the board expects next</strong>
              {objectives.map((objective) => {
                const done = objective.current >= objective.target;
                const value = objective.format === "money"
                  ? money.format(objective.current / 100)
                  : objective.format === "percent"
                  ? `${objective.current}%`
                  : objective.current;
                return (
                  <div class={done ? "done" : ""}>
                    <i>{done ? <Check size={14} /> : <Target size={14} />}</i>
                    <span>{objective.label}</span>
                    <b>{value}</b>
                  </div>
                );
              })}
            </div>
          )}
        </article>
        <aside class="panel chapter-history">
          <div class="panel-heading">
            <div>
              <h2>Campaign history</h2>
              <span>Board correspondence</span>
            </div>
          </div>
          {NARRATIVE_CHAPTERS.map((entry) => {
            const status = entry.number < props.game.narrative.chapter
              ? "complete"
              : entry.number === props.game.narrative.chapter
              ? "current"
              : "locked";
            return (
              <div class={`chapter-entry ${status}`}>
                <i>
                  {status === "complete"
                    ? <Check size={14} />
                    : status === "current"
                    ? <FileText size={14} />
                    : <LockKeyhole size={13} />}
                </i>
                <span>
                  <small>{entry.eyebrow}</small>
                  <strong>
                    {status === "locked" ? "Locked" : entry.subject}
                  </strong>
                </span>
              </div>
            );
          })}
        </aside>
      </div>
    </>
  );
}

function PrologueScreen(props: {
  game: GameState;
  onBegin: () => void;
}) {
  const firstLead = Object.values(props.game.records.leads)[0];
  const firstCompany = firstLead
    ? props.game.records.companies[firstLead.companyId]
    : undefined;
  return (
    <main class="prologue-screen">
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
            The account is down to one quarter of runway. The board will not
            authorize another transfer on the strength of a roadmap.
          </p>
          <p>
            Prove that someone will pay for the product, then prove it can
            become a company without every customer depending on you.
          </p>
          <p>
            You have one lead waiting from{" "}
            {firstCompany?.name ?? "a prospective account"}. Start there.
          </p>
          <p class="letter-signoff">Mara</p>
        </div>
        <div class="prologue-stakes">
          <div>
            <span>Cash remaining</span>
            <strong>{money.format(props.game.company.cashCents / 100)}</strong>
          </div>
          <div>
            <span>Monthly burn</span>
            <strong>
              {money.format(
                props.game.company.baselineMonthlyExpensesCents / 100,
              )}
            </strong>
          </div>
          <div>
            <span>Board directive</span>
            <strong>Win the first customer</strong>
          </div>
        </div>
        <button
          type="button"
          class="primary prologue-begin"
          onClick={props.onBegin}
        >
          Open the CRM <ChevronRight size={17} />
        </button>
      </article>
    </main>
  );
}

const PIPELINE_STAGES = [
  "qualified",
  "discovery",
  "evaluation",
  "negotiation",
] as const;

const CUSTOMER_ACCOUNT_PLANS: ReadonlyArray<{
  value: CustomerAccountPlan;
  label: string;
}> = [
  { value: "balanced", label: "Balanced" },
  { value: "adoption", label: "Adoption" },
  { value: "relationship", label: "Relationship" },
  { value: "expansion", label: "Expansion" },
  { value: "stabilization", label: "Stabilization" },
];

const DEAL_NEGOTIATION_CHOICES: ReadonlyArray<{
  value: DealNegotiationApproach;
  label: string;
  consequence: string;
}> = [
  {
    value: "discount",
    label: "Offer discount",
    consequence:
      "30m capacity · +18 close momentum · −15% MRR · weaker starting health",
  },
  {
    value: "value_proof",
    label: "Prove the value",
    consequence:
      "90m capacity · $150 spend · +12 forecast · +5% MRR · healthier account",
  },
  {
    value: "pilot",
    label: "Run paid pilot",
    consequence:
      "60m capacity · $400 spend · +22 forecast · −5% MRR · lowest account risk",
  },
];

const TICKET_RESOLUTION_CHOICES: ReadonlyArray<{
  value: TicketResolutionApproach;
  label: string;
  consequence: string;
}> = [
  {
    value: "fast_workaround",
    label: "Fast workaround",
    consequence:
      "15m capacity · lower quality and health · creates follow-up debt",
  },
  {
    value: "thorough_fix",
    label: "Thorough fix",
    consequence:
      "90m capacity · $100 spend · highest quality and health · low recurrence",
  },
  {
    value: "specialist_escalation",
    label: "Escalate specialist",
    consequence:
      "30m capacity · $350 spend · strong quality · reduced recurrence risk",
  },
];

function DealNegotiationControls(props: {
  dealId: string;
  capacity: number;
  cashCents: number;
  dispatch: (command: GameCommand) => void;
}) {
  return (
    <div class="decision-fork" aria-label="Negotiation approach">
      <div>
        <strong>Choose negotiation approach</strong>
        <span>The decision closes the deal and shapes the new account.</span>
      </div>
      <div class="decision-options">
        {DEAL_NEGOTIATION_CHOICES.map((choice) => {
          const capacity = choice.value === "discount"
            ? 30
            : choice.value === "value_proof"
            ? 90
            : 60;
          const cash = choice.value === "value_proof"
            ? 15_000
            : choice.value === "pilot"
            ? 40_000
            : 0;
          return (
            <button
              type="button"
              class="decision-option"
              disabled={props.capacity < capacity || props.cashCents < cash}
              onClick={() =>
                props.dispatch({
                  type: "negotiate_deal",
                  dealId: props.dealId,
                  approach: choice.value,
                })}
            >
              <strong>{choice.label}</strong>
              <span>{choice.consequence}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TicketResolutionControls(props: {
  ticketId: string;
  title: string;
  capacity: number;
  cashCents: number;
  dispatch: (command: GameCommand) => void;
}) {
  return (
    <article class="decision-fork ticket-decision">
      <div>
        <strong>{props.title}</strong>
        <span>Choose how support resolves this acknowledged ticket.</span>
      </div>
      <div class="decision-options">
        {TICKET_RESOLUTION_CHOICES.map((choice) => {
          const capacity = choice.value === "fast_workaround"
            ? 15
            : choice.value === "thorough_fix"
            ? 90
            : 30;
          const cash = choice.value === "thorough_fix"
            ? 10_000
            : choice.value === "specialist_escalation"
            ? 35_000
            : 0;
          return (
            <button
              type="button"
              class="decision-option"
              disabled={props.capacity < capacity || props.cashCents < cash}
              onClick={() =>
                props.dispatch({
                  type: "resolve_ticket_with_approach",
                  ticketId: props.ticketId,
                  approach: choice.value,
                })}
            >
              <strong>{choice.label}</strong>
              <span>{choice.consequence}</span>
            </button>
          );
        })}
      </div>
    </article>
  );
}

function CustomerSuccessWorkspace(props: {
  game: GameState;
  currentMinute: number;
  dispatch: (command: GameCommand) => boolean;
}) {
  const repName = useSignal("");
  const repLevel = useSignal<SalesRepLevel>("junior");
  const supportRepName = useSignal("");
  const supportRepLevel = useSignal<SalesRepLevel>("junior");
  const customers = Object.values(props.game.records.customers).sort((a, b) =>
    a.renewalAt - b.renewalAt
  );
  const successReps = Object.values(props.game.records.successReps).sort((
    a,
    b,
  ) => a.hiredAt - b.hiredAt);
  const supportReps = Object.values(props.game.records.supportReps).sort((
    a,
    b,
  ) => a.hiredAt - b.hiredAt);
  const incidents = Object.values(props.game.records.incidents).sort((a, b) =>
    b.createdAt - a.createdAt
  );
  const tickets = Object.values(props.game.records.tickets).sort((a, b) => {
    if (a.status === "resolved" && b.status !== "resolved") return 1;
    if (a.status !== "resolved" && b.status === "resolved") return -1;
    return a.resolutionDueAt - b.resolutionDueAt;
  });
  const openTickets = tickets.filter((ticket) => ticket.status !== "resolved");
  const breachedTickets = openTickets.filter((ticket) =>
    ticket.responseBreachedAt !== undefined ||
    ticket.resolutionBreachedAt !== undefined
  );
  const unassignedTickets = openTickets.filter((ticket) => !ticket.ownerId);
  const atRisk =
    customers.filter((customer) => customer.lifecycle === "at_risk").length;
  const averageHealth = customers.length
    ? Math.round(
      customers.reduce((total, customer) => total + customer.health, 0) /
        customers.length,
    )
    : 0;
  const renewalWindow =
    customers.filter((customer) =>
      customer.renewalAt <= props.currentMinute + 7 * 24 * 60
    ).length;
  const monthlyPayrollCents = successReps.reduce(
    (total, rep) => total + rep.monthlySalaryCents,
    0,
  );
  const retention = retentionReport(props.game);
  const hireSuccessRep = (event: SubmitEvent) => {
    event.preventDefault();
    const accepted = props.dispatch({
      type: "hire_success_rep",
      name: repName.value,
      level: repLevel.value,
    });
    if (accepted) repName.value = "";
  };
  const hireSupportRep = (event: SubmitEvent) => {
    event.preventDefault();
    const accepted = props.dispatch({
      type: "hire_support_rep",
      name: supportRepName.value,
      level: supportRepLevel.value,
    });
    if (accepted) supportRepName.value = "";
  };

  return (
    <>
      <div class="page-heading">
        <div>
          <span>Retention operations</span>
          <h1>Customer success</h1>
          <p>
            Specialists and support agents work assigned accounts and tickets
            over time.
          </p>
        </div>
      </div>
      <div class="pipeline-summary" aria-label="Customer health summary">
        <div>
          <span>Active customers</span>
          <strong>{customers.length}</strong>
        </div>
        <div>
          <span>Average health</span>
          <strong>{averageHealth}%</strong>
        </div>
        <div>
          <span>At risk</span>
          <strong>{atRisk}</strong>
        </div>
        <div>
          <span>Net retention</span>
          <strong>{retention.netRetentionPercent}%</strong>
        </div>
      </div>
      <div class="pipeline-summary" aria-label="Retention report">
        <div>
          <span>Gross retention</span>
          <strong>{retention.grossRetentionPercent}%</strong>
        </div>
        <div>
          <span>Average NPS</span>
          <strong>{retention.averageNps ?? "--"}</strong>
        </div>
        <div>
          <span>SLA attainment</span>
          <strong>{retention.slaAttainmentPercent}%</strong>
        </div>
        <div>
          <span>Renewing in 7 days</span>
          <strong>{renewalWindow}</strong>
        </div>
      </div>
      <section class="panel success-team-panel">
        <div class="panel-heading">
          <div>
            <h2>Success team</h2>
            <span>
              {successReps.length} specialists ·{" "}
              {money.format(monthlyPayrollCents / 100)} monthly payroll
            </span>
          </div>
          <button
            type="button"
            class="secondary"
            disabled={successReps.length === 0}
            onClick={() => props.dispatch({ type: "route_customers" })}
          >
            <ArrowUpDown size={16} />Route accounts
          </button>
        </div>
        <form class="success-hire-form" onSubmit={hireSuccessRep}>
          <label>
            <span>Specialist name</span>
            <input
              required
              minLength={2}
              maxLength={60}
              placeholder="e.g. Morgan Lee"
              value={repName.value}
              onInput={(event) => repName.value = event.currentTarget.value}
            />
          </label>
          <label>
            <span>Experience</span>
            <select
              value={repLevel.value}
              onChange={(event) =>
                repLevel.value = event.currentTarget.value as SalesRepLevel}
            >
              <option value="junior">Junior · $3,500/mo · 8 accounts</option>
              <option value="mid">Mid-level · $6,500/mo · 12 accounts</option>
              <option value="senior">Senior · $9,500/mo · 16 accounts</option>
            </select>
          </label>
          <button
            type="submit"
            class="primary"
            disabled={successReps.length >= DEFAULT_RULES.maxSuccessReps}
          >
            <Users size={16} />Hire specialist
          </button>
        </form>
        {successReps.length > 0 && (
          <div class="success-team-list">
            {successReps.map((rep) => {
              const accountLoad = customers.filter((customer) =>
                customer.ownerId === rep.id
              ).length;
              return (
                <div>
                  <span class="rep-avatar">{initials(rep.name)}</span>
                  <span>
                    <strong>{rep.name}</strong>
                    <small>{statusLabel(rep.level)} specialist</small>
                  </span>
                  <span>{accountLoad}/{rep.accountCapacity} accounts</span>
                  <span class={rep.burnout >= 60 ? "overloaded" : ""}>
                    {rep.burnout}% burnout
                  </span>
                  <button
                    type="button"
                    class="text-button staff-fire"
                    onClick={() => {
                      if (globalThis.confirm(`Dismiss ${rep.name}?`)) {
                        props.dispatch({
                          type: "fire_success_rep",
                          successRepId: rep.id,
                        });
                      }
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
      <section class="panel support-panel">
        <div class="panel-heading">
          <div>
            <h2>Support inbox</h2>
            <span>
              {supportReps.length}{" "}
              agents · Respond before SLAs expire to protect account health
            </span>
          </div>
        </div>
        <form class="support-hire-form" onSubmit={hireSupportRep}>
          <label>
            <span>Agent name</span>
            <input
              required
              minLength={2}
              maxLength={60}
              placeholder="e.g. Alex Rivera"
              value={supportRepName.value}
              onInput={(event) =>
                supportRepName.value = event.currentTarget.value}
            />
          </label>
          <label>
            <span>Experience</span>
            <select
              value={supportRepLevel.value}
              onChange={(event) =>
                supportRepLevel.value = event.currentTarget
                  .value as SalesRepLevel}
            >
              <option value="junior">Junior · $3,200/mo · 6 tickets</option>
              <option value="mid">Mid-level · $5,600/mo · 10 tickets</option>
              <option value="senior">Senior · $8,500/mo · 14 tickets</option>
            </select>
          </label>
          <button
            type="submit"
            class="primary"
            disabled={supportReps.length >= DEFAULT_RULES.maxSupportReps}
          >
            <Users size={16} />Hire agent
          </button>
        </form>
        {supportReps.length > 0 && (
          <div class="support-team-list">
            {supportReps.map((rep) => {
              const ticketLoad = openTickets.filter((ticket) =>
                ticket.ownerId === rep.id
              ).length;
              return (
                <div>
                  <span class="rep-avatar">{initials(rep.name)}</span>
                  <span>
                    <strong>{rep.name}</strong>
                    <small>{statusLabel(rep.level)} support</small>
                  </span>
                  <span>{ticketLoad}/{rep.ticketCapacity} tickets</span>
                  <span class={rep.burnout >= 60 ? "overloaded" : ""}>
                    {rep.burnout}% burnout
                  </span>
                  <button
                    type="button"
                    class="text-button staff-fire"
                    onClick={() => {
                      if (globalThis.confirm(`Dismiss ${rep.name}?`)) {
                        props.dispatch({
                          type: "fire_support_rep",
                          supportRepId: rep.id,
                        });
                      }
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div class="support-summary" aria-label="Support queue summary">
          <div>
            <span>Open</span>
            <strong>{openTickets.length}</strong>
          </div>
          <div>
            <span>Unassigned</span>
            <strong>{unassignedTickets.length}</strong>
          </div>
          <div>
            <span>SLA breached</span>
            <strong>{breachedTickets.length}</strong>
          </div>
          <div>
            <span>Resolved</span>
            <strong>{tickets.length - openTickets.length}</strong>
          </div>
        </div>
        {tickets.some((ticket) => ticket.status === "acknowledged") && (
          <div class="ticket-decision-list" aria-label="Ticket details">
            {tickets.filter((ticket) =>
              ticket.status === "acknowledged"
            ).map((ticket) => (
              <TicketResolutionControls
                ticketId={ticket.id}
                title={ticket.title}
                capacity={props.game.company.founderCapacityRemaining}
                cashCents={props.game.company.cashCents}
                dispatch={props.dispatch}
              />
            ))}
          </div>
        )}
        {tickets.length === 0
          ? (
            <EmptyState
              title="Support queue is clear"
              detail="New customer issues will appear here for triage."
            />
          )
          : (
            <div class="table-scroll support-ticket-scroll">
              <table class="support-table">
                <thead>
                  <tr>
                    <th>Issue</th>
                    <th>Account</th>
                    <th>Priority</th>
                    <th>Channel</th>
                    <th>Status</th>
                    <th>SLA</th>
                    <th>Owner</th>
                    <th aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((ticket) => {
                    const customer =
                      props.game.records.customers[ticket.customerId];
                    const company = customer
                      ? props.game.records.companies[customer.companyId]
                      : undefined;
                    const breached = ticket.responseBreachedAt !== undefined ||
                      ticket.resolutionBreachedAt !== undefined;
                    const dueAt = ticket.status === "open"
                      ? ticket.responseDueAt
                      : ticket.resolutionDueAt;
                    return (
                      <tr id={`record-${ticket.id}`} tabIndex={-1}>
                        <td>
                          <strong>{ticket.title}</strong>
                          <small>{ticket.id}</small>
                        </td>
                        <td>{company?.name ?? "Unknown company"}</td>
                        <td>
                          <span class={`ticket-priority ${ticket.priority}`}>
                            {statusLabel(ticket.priority)}
                          </span>
                        </td>
                        <td>{statusLabel(ticket.channel)}</td>
                        <td>
                          <span class={`status ${ticket.status}`}>
                            {statusLabel(ticket.status)}
                          </span>
                        </td>
                        <td class={breached ? "sla-breached" : ""}>
                          {ticket.status === "resolved"
                            ? "Met"
                            : breached
                            ? "Breached"
                            : relativeGameTime(dueAt, props.currentMinute)}
                        </td>
                        <td>
                          <select
                            aria-label={`Owner for ${ticket.title}`}
                            disabled={ticket.status === "resolved"}
                            value={ticket.ownerId ?? ""}
                            onChange={(event) =>
                              props.dispatch({
                                type: "assign_ticket",
                                ticketId: ticket.id,
                                ownerId: event.currentTarget.value || undefined,
                              })}
                          >
                            <option value="">Unassigned</option>
                            {supportReps.map((rep) => (
                              <option value={rep.id}>{rep.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <div class="ticket-actions">
                            {ticket.status === "open" && (
                              <button
                                type="button"
                                class="secondary"
                                onClick={() =>
                                  props.dispatch({
                                    type: "acknowledge_ticket",
                                    ticketId: ticket.id,
                                  })}
                              >
                                <Check size={15} />Acknowledge
                              </button>
                            )}
                            {ticket.status !== "resolved" &&
                              !ticket.escalated && (
                              <button
                                type="button"
                                class="secondary"
                                onClick={() =>
                                  props.dispatch({
                                    type: "escalate_ticket",
                                    ticketId: ticket.id,
                                  })}
                              >
                                <ArrowUpDown size={15} />Escalate
                              </button>
                            )}
                            {ticket.escalated && ticket.status !== "resolved" &&
                              !incidents.some((incident) =>
                                incident.ticketId === ticket.id &&
                                incident.status === "investigating"
                              ) && (
                              <button
                                type="button"
                                class="secondary"
                                onClick={() =>
                                  props.dispatch({
                                    type: "declare_incident",
                                    ticketId: ticket.id,
                                    severity: "major",
                                  })}
                              >
                                <Bell size={15} />Incident
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        {incidents.length > 0 && (
          <div class="incident-list">
            <div class="table-toolbar">
              <strong>Incidents</strong>
              <span>
                Unresolved incidents continuously reduce account health
              </span>
            </div>
            {incidents.map((incident) => {
              const linkedTicket =
                props.game.records.tickets[incident.ticketId];
              return (
                <div>
                  <span>
                    <strong>{incident.title}</strong>
                    <small>
                      {statusLabel(incident.severity)} · {incident.id}
                    </small>
                  </span>
                  <span class={`status ${incident.status}`}>
                    {statusLabel(incident.status)}
                  </span>
                  <span>
                    {linkedTicket?.resolutionQuality === undefined
                      ? "Quality pending"
                      : `${linkedTicket.resolutionQuality}% resolution quality`}
                  </span>
                  {incident.status === "investigating" && (
                    <button
                      type="button"
                      class="secondary"
                      disabled={linkedTicket?.status !== "resolved"}
                      onClick={() =>
                        props.dispatch({
                          type: "resolve_incident",
                          incidentId: incident.id,
                        })}
                    >
                      <Check size={15} />Close incident
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
      <section class="panel table-panel customer-portfolio-panel">
        <div class="table-toolbar">
          <strong>Account portfolio</strong>
          <span>Health declines after seven days without a success touch</span>
        </div>
        {customers.length === 0
          ? (
            <EmptyState
              title="No retained customers"
              detail="Won deals appear here as onboarding accounts."
            />
          )
          : (
            <div class="table-scroll customer-portfolio-scroll">
              <table class="customer-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Lifecycle</th>
                    <th>Health</th>
                    <th>Adoption</th>
                    <th>MRR</th>
                    <th>Plan</th>
                    <th>Owner</th>
                    <th>Renewal</th>
                    <th>NPS</th>
                    <th aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => {
                    const company =
                      props.game.records.companies[customer.companyId];
                    const renewalOpen = customer.renewalAt -
                        props.currentMinute <= 7 * 24 * 60;
                    const expansionReady = customer.lifecycle === "active" &&
                      customer.health >= 70 && customer.adoption >= 70;
                    return (
                      <tr id={`record-${customer.id}`} tabIndex={-1}>
                        <td>
                          <strong>{company?.name ?? "Unknown company"}</strong>
                          <small>{customer.expansions} expansions</small>
                        </td>
                        <td>
                          <span class={`status ${customer.lifecycle}`}>
                            {statusLabel(customer.lifecycle)}
                          </span>
                        </td>
                        <td>
                          <div class="health-meter">
                            <span style={{ width: `${customer.health}%` }} />
                          </div>
                          <small>{customer.health}%</small>
                        </td>
                        <td>{customer.adoption}%</td>
                        <td>
                          {money.format(customer.monthlyValueCents / 100)}
                        </td>
                        <td>
                          <select
                            aria-label={`Account plan for ${
                              company?.name ?? "account"
                            }`}
                            value={customer.accountPlan}
                            onChange={(event) =>
                              props.dispatch({
                                type: "set_customer_plan",
                                customerId: customer.id,
                                accountPlan: event.currentTarget
                                  .value as CustomerAccountPlan,
                              })}
                          >
                            {CUSTOMER_ACCOUNT_PLANS.map((plan) => (
                              <option value={plan.value}>{plan.label}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            aria-label={`Owner for ${
                              company?.name ?? "account"
                            }`}
                            value={customer.ownerId ?? ""}
                            onChange={(event) =>
                              props.dispatch({
                                type: "assign_customer",
                                customerId: customer.id,
                                ownerId: event.currentTarget.value || undefined,
                              })}
                          >
                            <option value="">Founder</option>
                            {successReps.map((rep) => (
                              <option value={rep.id}>{rep.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          {relativeGameTime(
                            customer.renewalAt,
                            props.currentMinute,
                          )}
                        </td>
                        <td>
                          <strong>{customer.lastNpsScore ?? "--"}</strong>
                          <small>
                            {customer.lastFeedback ?? "No feedback yet"}
                          </small>
                        </td>
                        <td>
                          <div class="customer-actions">
                            {customer.lifecycle === "onboarding" && (
                              <button
                                type="button"
                                class="primary"
                                onClick={() =>
                                  props.dispatch({
                                    type: "complete_customer_onboarding",
                                    customerId: customer.id,
                                  })}
                              >
                                <Check size={15} />Onboard
                              </button>
                            )}
                            <button
                              type="button"
                              class="secondary"
                              disabled={customer.lastSurveyAt !== undefined &&
                                props.currentMinute - customer.lastSurveyAt <
                                  7 * 24 * 60}
                              onClick={() =>
                                props.dispatch({
                                  type: "send_nps_survey",
                                  customerId: customer.id,
                                })}
                            >
                              <Send size={15} />Survey
                            </button>
                            <button
                              type="button"
                              class="secondary"
                              onClick={() =>
                                props.dispatch({
                                  type: "customer_check_in",
                                  customerId: customer.id,
                                })}
                            >
                              <Activity size={15} />Check in
                            </button>
                            <button
                              type="button"
                              class="secondary"
                              onClick={() =>
                                props.dispatch({
                                  type: "run_success_playbook",
                                  customerId: customer.id,
                                  playbook: customer.lifecycle === "at_risk"
                                    ? "recovery"
                                    : "adoption",
                                })}
                            >
                              <SlidersHorizontal size={15} />
                              {customer.lifecycle === "at_risk"
                                ? "Recover"
                                : "Adopt"}
                            </button>
                            <button
                              type="button"
                              class="secondary"
                              disabled={!renewalOpen || customer.health < 40}
                              onClick={() =>
                                props.dispatch({
                                  type: "renew_customer",
                                  customerId: customer.id,
                                })}
                            >
                              <RefreshCw size={15} />Renew
                            </button>
                            <button
                              type="button"
                              class="secondary"
                              disabled={!expansionReady}
                              onClick={() =>
                                props.dispatch({
                                  type: "expand_customer",
                                  customerId: customer.id,
                                })}
                            >
                              <CircleDollarSign size={15} />Expand
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </>
  );
}

function PlatformWorkspace(props: {
  game: GameState;
  mode: "automation" | "analytics" | "operations";
  dispatch: (command: GameCommand) => boolean;
}) {
  const name = useSignal("");
  const secondary = useSignal("");
  const trigger = useSignal<AutomationTrigger>("lead_created");
  const condition = useSignal<AutomationCondition>("all");
  const action = useSignal<AutomationAction>("create_task");
  const managerDepartment = useSignal<ManagerDepartment>("sales");
  const initiativeType = useSignal<InitiativeType>("growth");
  const report = analyticsReport(props.game);
  const platform = props.game.platform;
  if (props.mode === "analytics") {
    const metrics = [
      ["Lead qualification", `${report.qualificationPercent}%`],
      ["Win rate", `${report.winRatePercent}%`],
      ["Cohort retention", `${report.activeCohortRetentionPercent}%`],
      [
        "Multi-touch revenue",
        money.format(report.weightedAttributionCents / 100),
      ],
      ["Forecast variance", money.format(report.forecastVarianceCents / 100)],
      ["Automation errors", `${report.automationErrorPercent}%`],
    ];
    return (
      <>
        <div class="page-heading">
          <div>
            <span>Decision support</span>
            <h1>Analytics</h1>
            <p>Funnel, cohort, attribution, and forecast performance.</p>
          </div>
        </div>
        <div class="pipeline-summary advanced-summary">
          {metrics.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <section class="panel">
          <div class="panel-heading">
            <div>
              <h2>Dashboard composition</h2>
              <span>{platform.dashboardWidgets.join(" · ")}</span>
            </div>
          </div>
        </section>
      </>
    );
  }
  if (props.mode === "operations") {
    const operating = operatingMetrics(props.game);
    const daysRemaining = quarterDaysRemaining(props.game.clock.gameMinute);
    const marketing = platform.departments.find((department) =>
      department.id === "department_marketing"
    );
    const activeInitiative = platform.initiatives.find((initiative) =>
      initiative.status === "active"
    );
    const recentInitiatives = platform.initiatives.filter((initiative) =>
      initiative.status === "completed"
    ).slice(-3).reverse();
    const managerDepartments: Array<{
      id: ManagerDepartment;
      label: string;
      headcount: number;
      demand: number;
      capacity: number;
    }> = [{
      id: "sales",
      label: "Sales",
      headcount: Object.keys(props.game.records.salesReps).length,
      demand: Object.values(props.game.records.leads).filter((lead) =>
        ["new", "contacted", "cold"].includes(lead.status)
      ).length + Object.values(props.game.records.deals).filter((deal) =>
        deal.stage !== "won" && deal.stage !== "lost"
      ).length,
      capacity: Object.values(props.game.records.salesReps).reduce(
        (total, rep) =>
          total + rep.dealCapacity,
        0,
      ),
    }, {
      id: "marketing",
      label: "Marketing",
      headcount: marketing?.headcount ?? 0,
      demand: Object.values(props.game.records.campaigns).filter((campaign) =>
        campaign.status === "active"
      ).length,
      capacity: (marketing?.headcount ?? 0) * 2,
    }, {
      id: "customer_success",
      label: "Customer Success",
      headcount: Object.keys(props.game.records.successReps).length,
      demand: Object.keys(props.game.records.customers).length,
      capacity: Object.values(props.game.records.successReps).reduce(
        (total, rep) =>
          total + rep.accountCapacity,
        0,
      ),
    }, {
      id: "support",
      label: "Support",
      headcount: Object.keys(props.game.records.supportReps).length,
      demand: Object.values(props.game.records.tickets).filter((ticket) =>
        ticket.status !== "resolved"
      ).length,
      capacity: Object.values(props.game.records.supportReps).reduce(
        (total, rep) =>
          total + rep.ticketCapacity,
        0,
      ),
    }];
    return (
      <>
        <div class="page-heading">
          <div>
            <span>Company operating system</span>
            <h1>Operations</h1>
            <p>Headcount, budgets, controls, and quarterly targets.</p>
          </div>
        </div>
        <div class="pipeline-summary">
          <div>
            <span>Quarter</span>
            <strong>Q{platform.quarter}</strong>
          </div>
          <div>
            <span>Resilience</span>
            <strong>{platform.resilienceLevel}</strong>
          </div>
          <div>
            <span>Audit entries</span>
            <strong>{platform.auditEntriesArchived}</strong>
          </div>
          <div>
            <span>Endless goal</span>
            <strong>{money.format(platform.endlessGoal * 10_000)}</strong>
          </div>
        </div>
        <section class="panel initiative-panel">
          <div class="panel-heading">
            <div>
              <h2>Company initiatives</h2>
              <span>
                One active project · {platform.initiativesCompleted}{" "}
                completed · rewards scale with the endless goal
              </span>
            </div>
          </div>
          {activeInitiative
            ? (() => {
              const definition = initiativeDefinition(activeInitiative.type);
              const nextMilestone = activeInitiative.decisions.length;
              const ready = activeInitiative.promptedMilestone > nextMilestone;
              return (
                <div class="initiative-active">
                  <div>
                    <span class="status-chip active">Active</span>
                    <h3>{definition.name}</h3>
                    <p>{definition.summary}</p>
                    <small>
                      Milestone {Math.min(3, nextMilestone + 1)} of 3 ·{" "}
                      {Math.max(
                        0,
                        Math.ceil(
                          (activeInitiative.milestoneAt[
                            Math.min(2, nextMilestone)
                          ] - props.game.clock.gameMinute) / 1_440,
                        ),
                      )} days remaining
                    </small>
                  </div>
                  <div class="initiative-progress">
                    {[0, 1, 2].map((index) => (
                      <span
                        class={index < activeInitiative.decisions.length
                          ? "complete"
                          : index === nextMilestone
                          ? "current"
                          : ""}
                        key={index}
                      >
                        {index + 1}
                      </span>
                    ))}
                  </div>
                  {ready
                    ? (
                      <div class="initiative-decisions">
                        <button
                          class="primary"
                          type="button"
                          onClick={() =>
                            props.dispatch({
                              type: "decide_initiative_milestone",
                              initiativeId: activeInitiative.id,
                              approach: "accelerate",
                            })}
                        >
                          {definition.accelerateLabel}
                        </button>
                        <button
                          class="secondary"
                          type="button"
                          onClick={() =>
                            props.dispatch({
                              type: "decide_initiative_milestone",
                              initiativeId: activeInitiative.id,
                              approach: "stabilize",
                            })}
                        >
                          {definition.stabilizeLabel}
                        </button>
                      </div>
                    )
                    : (
                      <span class="initiative-waiting">
                        Work pauses at every milestone for an operating choice.
                      </span>
                    )}
                </div>
              );
            })()
            : (
              <>
                <div class="initiative-catalog">
                  {INITIATIVE_DEFINITIONS.map((definition) => (
                    <button
                      class={initiativeType.value === definition.type
                        ? "selected"
                        : ""}
                      type="button"
                      key={definition.type}
                      onClick={() => initiativeType.value = definition.type}
                    >
                      <strong>{definition.name}</strong>
                      <span>{definition.summary}</span>
                      <small>
                        {money.format(definition.startCostCents / 100)} ·{" "}
                        {definition.durationDays} days · 3 decisions
                      </small>
                    </button>
                  ))}
                </div>
                <button
                  class="primary"
                  type="button"
                  onClick={() =>
                    props.dispatch({
                      type: "start_initiative",
                      initiativeType: initiativeType.value,
                    })}
                >
                  <Target size={15} />Start{" "}
                  {initiativeDefinition(initiativeType.value).name}
                </button>
              </>
            )}
          {recentInitiatives.length > 0 && (
            <div class="initiative-history">
              {recentInitiatives.map((initiative) => (
                <div key={initiative.id}>
                  <strong>{initiativeDefinition(initiative.type).name}</strong>
                  <span>{initiative.outcome}</span>
                  <small>
                    {money.format((initiative.rewardCents ?? 0) / 100)} reward
                  </small>
                </div>
              ))}
            </div>
          )}
        </section>
        <section class="panel">
          <div class="panel-heading">
            <div>
              <h2>Department leadership</h2>
              <span>
                {platform.managers.length}/4 managers · Daily staffing reviews
              </span>
            </div>
          </div>
          <form
            class="operations-manager-form"
            onSubmit={(event) => {
              event.preventDefault();
              const hired = props.dispatch({
                type: "hire_manager",
                name: name.value,
                department: managerDepartment.value,
              });
              if (!hired) return;
              name.value = "";
              const nextVacancy = managerDepartments.find((department) =>
                department.id !== managerDepartment.value &&
                !platform.managers.some((manager) =>
                  manager.department === department.id
                )
              );
              if (nextVacancy) managerDepartment.value = nextVacancy.id;
            }}
          >
            <label>
              <span>Manager name</span>
              <input
                required
                minLength={2}
                value={name.value}
                onInput={(event) => name.value = event.currentTarget.value}
              />
            </label>
            <label>
              <span>Department</span>
              <select
                value={managerDepartment.value}
                onChange={(event) =>
                  managerDepartment.value = event.currentTarget
                    .value as ManagerDepartment}
              >
                {managerDepartments.map((department) => (
                  <option
                    key={department.id}
                    value={department.id}
                    disabled={platform.managers.some((manager) =>
                      manager.department === department.id
                    )}
                  >
                    {department.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              class="primary"
              type="submit"
              disabled={platform.managers.some((manager) =>
                manager.department === managerDepartment.value
              )}
            >
              <Users size={16} />Hire manager
            </button>
          </form>
          <div class="operations-manager-list">
            {managerDepartments.map((department) => {
              const manager = platform.managers.find((item) =>
                item.department === department.id
              );
              return (
                <div key={department.id}>
                  <span class="rep-avatar">{initials(department.label)}</span>
                  <span class="operations-manager-identity">
                    <strong>{department.label}</strong>
                    <small>{manager?.name ?? "Manager position vacant"}</small>
                  </span>
                  <span class="operations-manager-metric">
                    <small>Headcount</small>
                    <strong>{department.headcount}</strong>
                  </span>
                  <span class="operations-manager-metric">
                    <small>Work / capacity</small>
                    <strong>{department.demand} / {department.capacity}</strong>
                  </span>
                  <span class="operations-manager-decision">
                    <small>Latest decision</small>
                    <strong>
                      {manager?.lastDecision ?? "Awaiting leadership"}
                    </strong>
                  </span>
                  {manager && (
                    <button
                      class="icon-button staff-fire"
                      type="button"
                      title={`Dismiss ${manager.name}`}
                      aria-label={`Dismiss ${manager.name}`}
                      onClick={() =>
                        props.dispatch({
                          type: "fire_manager",
                          department: department.id,
                        })}
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        <section class="panel operations-plan-panel">
          <div class="panel-heading">
            <div>
              <h2>Quarterly operating plan</h2>
              <span>
                Closes automatically in {daysRemaining} day
                {daysRemaining === 1 ? "" : "s"}
              </span>
            </div>
            <button
              class="secondary"
              type="button"
              onClick={() => props.dispatch({ type: "invest_resilience" })}
            >
              <Gauge size={15} />Invest in resilience
            </button>
          </div>
          <div class="operations-plan-grid">
            {[
              [
                "MRR",
                money.format(operating.mrrCents / 100),
                money.format(platform.growthTargetCents / 100),
                operating.mrrCents >= platform.growthTargetCents,
              ],
              [
                "Efficiency",
                `${operating.efficiencyPercent}%`,
                `${platform.efficiencyTargetPercent}%`,
                operating.efficiencyPercent >=
                  platform.efficiencyTargetPercent,
              ],
              [
                "Retention",
                `${operating.retentionPercent}%`,
                `${platform.retentionTargetPercent}%`,
                operating.retentionPercent >= platform.retentionTargetPercent,
              ],
            ].map(([label, current, target, met]) => (
              <div class={met ? "target-met" : "target-open"} key={label}>
                <span>{label}</span>
                <strong>{current}</strong>
                <small>Target {target}</small>
                <b>{met ? "On target" : "Needs attention"}</b>
              </div>
            ))}
          </div>
          <div class="operations-plan-note">
            <span>$2,500 cash for each target met</span>
            <span>
              Miss pressure reduction: {Math.min(
                platform.resilienceLevel,
                5,
              )} burnout per target
            </span>
          </div>
        </section>
      </>
    );
  }
  return (
    <>
      <div class="page-heading">
        <div>
          <span>Systems at scale</span>
          <h1>Automation</h1>
          <p>
            Workflows assign owners, send outreach, and advance matching
            records.
          </p>
        </div>
      </div>
      <div class="pipeline-summary">
        <div>
          <span>Sequences</span>
          <strong>{platform.sequences.length}</strong>
        </div>
        <div>
          <span>Workflow runs</span>
          <strong>{platform.automationRunsArchived}</strong>
        </div>
        <div>
          <span>Errors</span>
          <strong>{platform.automationErrorsArchived}</strong>
        </div>
      </div>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>Sequences</h2>
            <span>Repeatable outreach</span>
          </div>
        </div>
        <form
          class="support-hire-form"
          onSubmit={(event) => {
            event.preventDefault();
            props.dispatch({
              type: "create_sequence",
              name: name.value,
              audience: "leads",
            });
            name.value = "";
          }}
        >
          <label>
            <span>Name</span>
            <input
              required
              minLength={2}
              value={name.value}
              onInput={(event) => name.value = event.currentTarget.value}
            />
          </label>
          <button class="primary" type="submit">
            <Send size={16} />Create sequence
          </button>
        </form>
        <div class="tag-list">
          {platform.sequences.map((sequence) => (
            <button
              key={sequence.id}
              type="button"
              class="secondary"
              onClick={() =>
                props.dispatch({
                  type: "toggle_sequence",
                  sequenceId: sequence.id,
                })}
            >
              {sequence.name} · {sequence.enabled ? "Active" : "Paused"} ·{" "}
              {sequence.completed}/{sequence.enrolled}
            </button>
          ))}
        </div>
      </section>
      <section class="panel workflow-panel">
        <div class="panel-heading">
          <div>
            <h2>Workflow builder</h2>
            <span>
              Matching events mutate the live record: outreach, assignment, or
              status
            </span>
          </div>
          <span class="record-count">{platform.workflows.length}/20</span>
        </div>
        <form
          class="workflow-builder-form"
          onSubmit={(event) => {
            event.preventDefault();
            const accepted = props.dispatch({
              type: "create_workflow",
              name: secondary.value,
              trigger: trigger.value,
              condition: condition.value,
              action: action.value,
            });
            if (accepted) secondary.value = "";
          }}
        >
          <label class="workflow-name-field">
            <span>Workflow name</span>
            <input
              required
              minLength={2}
              maxLength={60}
              placeholder="Route urgent renewals"
              value={secondary.value}
              onInput={(event) => secondary.value = event.currentTarget.value}
            />
          </label>
          <label>
            <span>When this happens</span>
            <select
              value={trigger.value}
              onChange={(event) =>
                trigger.value = event.currentTarget.value as AutomationTrigger}
            >
              <option value="lead_created">Lead created</option>
              <option value="lead_contacted">Lead contacted</option>
              <option value="lead_qualified">Lead qualified</option>
              <option value="quote_sent">Quote sent</option>
              <option value="deal_won">Deal won</option>
              <option value="customer_at_risk">Customer at risk</option>
              <option value="ticket_created">Support ticket created</option>
              <option value="ticket_sla_breached">Ticket SLA breached</option>
            </select>
          </label>
          <label>
            <span>Only if</span>
            <select
              value={condition.value}
              onChange={(event) => condition.value = event.currentTarget
                .value as AutomationCondition}
            >
              <option value="all">Any matching record</option>
              <option value="high_value">Value is high</option>
              <option value="unassigned">Owner is unassigned</option>
              <option value="high_intent">Intent is over 70%</option>
              <option value="overdue">Record is overdue</option>
            </select>
          </label>
          <label>
            <span>Then do this</span>
            <select
              value={action.value}
              onChange={(event) =>
                action.value = event.currentTarget.value as AutomationAction}
            >
              <option value="create_task">Create task</option>
              <option value="send_outreach">Send outreach</option>
              <option value="assign_owner">Assign owner</option>
              <option value="notify_team">Notify team</option>
              <option value="qualify_lead">Qualify lead</option>
              <option value="update_record">Advance record status</option>
              <option value="launch_playbook">Launch playbook</option>
            </select>
          </label>
          <div class="workflow-preview">
            <span>WHEN</span>
            <strong>{statusLabel(trigger.value)}</strong>
            <ChevronRight size={15} />
            <span>IF</span>
            <strong>{statusLabel(condition.value)}</strong>
            <ChevronRight size={15} />
            <span>THEN</span>
            <strong>{statusLabel(action.value)}</strong>
          </div>
          <button
            class="primary workflow-publish"
            type="submit"
            disabled={platform.workflows.length >= 20}
          >
            <Activity size={16} />Publish workflow
          </button>
        </form>
        {platform.workflows.length > 0
          ? (
            <div class="workflow-list">
              {platform.workflows.map((workflow) => (
                <article
                  key={workflow.id}
                  class={`workflow-card ${workflow.enabled ? "" : "paused"}`}
                >
                  <header>
                    <div>
                      <strong>{workflow.name}</strong>
                      <span
                        class={`status ${
                          workflow.enabled ? "active" : "paused"
                        }`}
                      >
                        {workflow.enabled ? "Active" : "Paused"}
                      </span>
                    </div>
                    <small>
                      {workflow.runs} runs · {workflow.errors} errors
                    </small>
                  </header>
                  <div class="workflow-flow">
                    <span>
                      <small>WHEN</small>
                      {statusLabel(workflow.trigger)}
                    </span>
                    <ChevronRight size={15} />
                    <span>
                      <small>IF</small>
                      {statusLabel(workflow.condition)}
                    </span>
                    <ChevronRight size={15} />
                    <span>
                      <small>THEN</small>
                      {statusLabel(workflow.action)}
                    </span>
                  </div>
                  <footer>
                    <span>
                      {workflow.lastRunAt === undefined
                        ? "Has not run yet"
                        : `Last ran ${gameDate(workflow.lastRunAt)}`}
                    </span>
                    <div>
                      <button
                        type="button"
                        class="secondary"
                        onClick={() =>
                          props.dispatch({
                            type: "toggle_workflow",
                            workflowId: workflow.id,
                          })}
                      >
                        {workflow.enabled ? "Pause" : "Resume"}
                      </button>
                      <button
                        type="button"
                        class="text-button workflow-remove"
                        onClick={() => {
                          if (globalThis.confirm(`Remove ${workflow.name}?`)) {
                            props.dispatch({
                              type: "delete_workflow",
                              workflowId: workflow.id,
                            });
                          }
                        }}
                      >
                        <X size={15} />Remove
                      </button>
                    </div>
                  </footer>
                </article>
              ))}
            </div>
          )
          : (
            <div class="automation-empty">
              <Activity size={22} />
              <div>
                <strong>No workflows published</strong>
                <span>Choose an event, rule, and response above.</span>
              </div>
            </div>
          )}
      </section>
    </>
  );
}

function PipelineWorkspace(props: {
  game: GameState;
  currentMinute: number;
  mode: "list" | "board";
  onModeChange: (mode: "list" | "board") => void;
  dispatch: (command: GameCommand) => boolean;
}) {
  const editingDealId = useSignal<string | undefined>(undefined);
  const editProduct = useSignal<DealProduct>("growth");
  const editValue = useSignal("500");
  const editCloseDays = useSignal("14");
  const lossReason = useSignal<DealLossReason>("budget");
  const repName = useSignal("");
  const repLevel = useSignal<SalesRepLevel>("junior");
  const repTerritory = useSignal<SalesTerritory>("all");
  const repTarget = useSignal("15000");
  const quoteDealId = useSignal("");
  const quoteProduct = useSignal<DealProduct>("growth");
  const quoteBilling = useSignal<BillingCycle>("monthly");
  const quoteSeats = useSignal("10");
  const quoteDiscount = useSignal("0");
  const quoteValidDays = useSignal("14");
  const selectedDeals = useSignal<Set<string>>(new Set());
  const bulkOwner = useSignal("");
  const deals = Object.values(props.game.records.deals).sort((a, b) =>
    b.updatedAt - a.updatedAt
  );
  const openDeals = deals.filter((deal) =>
    deal.stage !== "won" && deal.stage !== "lost"
  );
  const negotiationDeals = openDeals.filter((deal) =>
    deal.stage === "negotiation"
  );
  const salesReps = Object.values(props.game.records.salesReps).sort((a, b) =>
    a.hiredAt - b.hiredAt
  );
  const quotes = Object.values(props.game.records.quotes).sort((a, b) =>
    b.updatedAt - a.updatedAt
  );
  const quoteSeatCount = Number(quoteSeats.value);
  const quoteDiscountPercent = Number(quoteDiscount.value);
  const quoteValidityDays = Number(quoteValidDays.value);
  const quoteTermsValid = Number.isInteger(quoteSeatCount) &&
    quoteSeatCount >= 1 && quoteSeatCount <= 500 &&
    Number.isInteger(quoteDiscountPercent) &&
    quoteDiscountPercent >= 0 && quoteDiscountPercent <= 30 &&
    Number.isInteger(quoteValidityDays) && quoteValidityDays >= 1 &&
    quoteValidityDays <= 30;
  const quotePreviewCents = quoteTermsValid
    ? quoteMonthlyValueCents(
      quoteProduct.value,
      quoteBilling.value,
      quoteSeatCount,
      quoteDiscountPercent,
    )
    : undefined;
  const monthlyPayrollCents = salesReps.reduce(
    (total, rep) => total + rep.monthlySalaryCents,
    0,
  );
  const pipelineCents = openDeals.reduce(
    (total, deal) => total + deal.monthlyValueCents,
    0,
  );
  const weightedCents = openDeals.reduce(
    (total, deal) => total + deal.monthlyValueCents * deal.probability / 100,
    0,
  );
  const closingSoon =
    openDeals.filter((deal) =>
      deal.expectedCloseAt <= props.currentMinute + 7 * 24 * 60
    ).length;
  const averageAge = openDeals.length > 0
    ? Math.floor(
      openDeals.reduce(
        (total, deal) => total + props.currentMinute - deal.updatedAt,
        0,
      ) / openDeals.length / (24 * 60),
    )
    : 0;
  const detail = (deal: Deal) => {
    const lead = props.game.records.leads[deal.leadId];
    const company = props.game.records.companies[deal.companyId];
    return { lead, company };
  };
  const editingDeal = editingDealId.value
    ? props.game.records.deals[editingDealId.value]
    : undefined;
  const beginEdit = (deal: Deal) => {
    editingDealId.value = deal.id;
    editProduct.value = deal.product;
    editValue.value = String(deal.monthlyValueCents / 100);
    editCloseDays.value = String(
      Math.max(
        1,
        Math.ceil((deal.expectedCloseAt - props.currentMinute) / (24 * 60)),
      ),
    );
    lossReason.value = "budget";
  };
  const submitDeal = (event: SubmitEvent) => {
    event.preventDefault();
    if (!editingDeal) return;
    props.dispatch({
      type: "update_deal",
      dealId: editingDeal.id,
      product: editProduct.value,
      monthlyValueCents: Math.round(Number(editValue.value) * 100),
      expectedCloseInDays: Number(editCloseDays.value),
    });
    editingDealId.value = undefined;
  };
  const closeLost = () => {
    if (!editingDeal) return;
    props.dispatch({
      type: "lose_deal",
      dealId: editingDeal.id,
      reason: lossReason.value,
    });
    editingDealId.value = undefined;
  };
  const hireRep = (event: SubmitEvent) => {
    event.preventDefault();
    const accepted = props.dispatch({
      type: "hire_sales_rep",
      name: repName.value,
      level: repLevel.value,
      territory: repTerritory.value,
      monthlyTargetCents: Math.round(Number(repTarget.value) * 100),
    });
    if (accepted) repName.value = "";
  };
  const createQuote = (event: SubmitEvent) => {
    event.preventDefault();
    if (!quoteDealId.value) return;
    const accepted = props.dispatch({
      type: "create_quote",
      dealId: quoteDealId.value,
      product: quoteProduct.value,
      billingCycle: quoteBilling.value,
      seats: Number(quoteSeats.value),
      discountPercent: Number(quoteDiscount.value),
      validDays: Number(quoteValidDays.value),
    });
    if (accepted) quoteDealId.value = "";
  };
  const toggleDeal = (dealId: string) => {
    const next = new Set(selectedDeals.value);
    if (next.has(dealId)) next.delete(dealId);
    else next.add(dealId);
    selectedDeals.value = next;
  };
  const clearSelection = () => selectedDeals.value = new Set();

  return (
    <>
      <div class="page-heading">
        <div>
          <span>Sales operations</span>
          <h1>Pipeline</h1>
          <p>
            Assigned representatives contact, qualify, and advance their
            pipeline.
          </p>
        </div>
        <div class="segmented-control" aria-label="Pipeline view">
          <button
            type="button"
            class={props.mode === "list" ? "active" : ""}
            aria-pressed={props.mode === "list"}
            onClick={() => props.onModeChange("list")}
          >
            <List size={16} />List
          </button>
          <button
            type="button"
            class={props.mode === "board" ? "active" : ""}
            aria-pressed={props.mode === "board"}
            onClick={() => props.onModeChange("board")}
          >
            <Columns3 size={16} />Board
          </button>
        </div>
      </div>
      <div class="pipeline-summary" aria-label="Pipeline forecast">
        <div>
          <span>Open pipeline</span>
          <strong>{money.format(pipelineCents / 100)}</strong>
        </div>
        <div>
          <span>Weighted pipeline</span>
          <strong>{money.format(weightedCents / 100)}</strong>
        </div>
        <div>
          <span>Forecast MRR</span>
          <strong>
            {money.format((props.game.company.mrrCents + weightedCents) / 100)}
          </strong>
        </div>
        <div>
          <span>Closing in 7 days</span>
          <strong>{closingSoon}</strong>
        </div>
        <div>
          <span>Average stage age</span>
          <strong>{averageAge}d</strong>
        </div>
      </div>
      {negotiationDeals.length > 0 && (
        <section
          class="panel negotiation-decisions"
          aria-label="Deals awaiting negotiation"
        >
          <div class="panel-heading">
            <div>
              <h2>Negotiations</h2>
              <span>Choose terms to close deals and shape new accounts.</span>
            </div>
            <span class="record-count">{negotiationDeals.length}</span>
          </div>
          <div class="negotiation-decision-list">
            {negotiationDeals.map((deal) => {
              const { company, lead } = detail(deal);
              return (
                <div class="negotiation-decision-row">
                  <div class="negotiation-deal-context">
                    <span>Ready to close</span>
                    <strong>{company?.name ?? "Unknown company"}</strong>
                    <small>
                      {lead?.firstName} {lead?.lastName} ·{" "}
                      {money.format(deal.monthlyValueCents / 100)} MRR
                    </small>
                  </div>
                  <DealNegotiationControls
                    dealId={deal.id}
                    capacity={props.game.company.founderCapacityRemaining}
                    cashCents={props.game.company.cashCents}
                    dispatch={props.dispatch}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}
      <section class="panel sales-team-panel">
        <div class="panel-heading">
          <div>
            <h2>Sales team</h2>
            <span>
              {salesReps.length} representatives ·{" "}
              {money.format(monthlyPayrollCents / 100)} monthly payroll
            </span>
          </div>
          <button
            type="button"
            class="secondary"
            disabled={salesReps.length === 0}
            onClick={() => props.dispatch({ type: "route_leads" })}
          >
            <ArrowUpDown size={16} />Route leads
          </button>
        </div>
        <form class="hire-rep-form" onSubmit={hireRep}>
          <label>
            <span>Representative name</span>
            <input
              value={repName.value}
              minLength={2}
              maxLength={60}
              required
              placeholder="e.g. Avery Chen"
              onInput={(event) => repName.value = event.currentTarget.value}
            />
          </label>
          <label>
            <span>Experience</span>
            <select
              value={repLevel.value}
              onChange={(event) =>
                repLevel.value = event.currentTarget.value as SalesRepLevel}
            >
              <option value="junior">Junior · $3,000/mo</option>
              <option value="mid">Mid-level · $6,000/mo</option>
              <option value="senior">Senior · $10,000/mo</option>
            </select>
          </label>
          <label>
            <span>Territory</span>
            <select
              value={repTerritory.value}
              onChange={(event) => repTerritory.value = event.currentTarget
                .value as SalesTerritory}
            >
              <option value="all">All regions</option>
              <option value="North America">North America</option>
              <option value="Europe">Europe</option>
              <option value="Asia Pacific">Asia Pacific</option>
            </select>
          </label>
          <label>
            <span>Monthly target</span>
            <input
              type="number"
              min="1000"
              max="50000"
              step="500"
              required
              value={repTarget.value}
              onInput={(event) => repTarget.value = event.currentTarget.value}
            />
          </label>
          <button
            type="submit"
            class="primary"
            disabled={salesReps.length >= DEFAULT_RULES.maxSalesReps}
          >
            <Users size={16} />Hire rep
          </button>
        </form>
        {salesReps.length > 0 && (
          <div class="sales-team-list">
            {salesReps.map((rep) => {
              const ownedDeals = openDeals.filter((deal) =>
                deal.ownerId === rep.id
              );
              const ownedLeads = Object.values(props.game.records.leads).filter(
                (lead) =>
                  lead.ownerId === rep.id &&
                  ["new", "contacted", "cold"].includes(lead.status),
              );
              const workload = ownedDeals.length + ownedLeads.length;
              const weightedOwnedCents = ownedDeals.reduce(
                (total, deal) =>
                  total + deal.monthlyValueCents * deal.probability / 100,
                0,
              );
              return (
                <div>
                  <span class="rep-avatar">{initials(rep.name)}</span>
                  <span>
                    <strong>{rep.name}</strong>
                    <small>{statusLabel(rep.level)} representative</small>
                    <small>
                      {rep.territory === "all" ? "All regions" : rep.territory}
                    </small>
                  </span>
                  <dl>
                    <div>
                      <dt>Skill</dt>
                      <dd>{rep.skill}</dd>
                    </div>
                    <div>
                      <dt>Workload</dt>
                      <dd
                        class={workload > rep.dealCapacity ? "overloaded" : ""}
                      >
                        {workload}/{rep.dealCapacity}
                      </dd>
                    </div>
                    <div>
                      <dt>Target coverage</dt>
                      <dd>
                        {Math.round(
                          weightedOwnedCents / rep.monthlyTargetCents * 100,
                        )}%
                      </dd>
                    </div>
                    <div>
                      <dt>Burnout</dt>
                      <dd class={rep.burnout >= 60 ? "overloaded" : ""}>
                        {rep.burnout}%
                      </dd>
                    </div>
                  </dl>
                  <div class="rep-actions">
                    <button
                      type="button"
                      class="secondary rep-training"
                      onClick={() =>
                        props.dispatch({
                          type: "train_sales_rep",
                          salesRepId: rep.id,
                        })}
                    >
                      <GraduationCap size={15} />Train · $1,000
                    </button>
                    <button
                      type="button"
                      class="text-button staff-fire"
                      onClick={() => {
                        if (globalThis.confirm(`Dismiss ${rep.name}?`)) {
                          props.dispatch({
                            type: "fire_sales_rep",
                            salesRepId: rep.id,
                          });
                        }
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      <section class="panel quotes-panel">
        <div class="panel-heading">
          <div>
            <h2>Quotes</h2>
            <span>Build subscription terms and close negotiated deals</span>
          </div>
          <span class="record-count">{quotes.length} records</span>
        </div>
        <div class="quote-builder">
          <div class="quote-builder-heading">
            <span class="quote-builder-icon">
              <FileText size={18} />
            </span>
            <div>
              <strong>New commercial proposal</strong>
              <span>Configure the terms before sending them to a buyer.</span>
            </div>
          </div>
          <form class="quote-form" onSubmit={createQuote}>
            <div class="quote-fields">
              <label class="quote-deal-field">
                <span>Deal</span>
                <select
                  required
                  value={quoteDealId.value}
                  onChange={(event) =>
                    quoteDealId.value = event.currentTarget.value}
                >
                  <option value="">Select an open deal</option>
                  {openDeals.map((deal) => (
                    <option value={deal.id}>
                      {detail(deal).company?.name ?? "Unknown company"} ·{" "}
                      {statusLabel(deal.stage)}
                    </option>
                  ))}
                </select>
              </label>
              <label class="quote-plan-field">
                <span>Plan</span>
                <select
                  value={quoteProduct.value}
                  onChange={(event) =>
                    quoteProduct.value = event.currentTarget
                      .value as DealProduct}
                >
                  <option value="starter">Starter · $200 + $10/seat</option>
                  <option value="growth">Growth · $450 + $15/seat</option>
                  <option value="scale">Scale · $800 + $25/seat</option>
                </select>
              </label>
              <label>
                <span>Billing</span>
                <select
                  value={quoteBilling.value}
                  onChange={(event) =>
                    quoteBilling.value = event.currentTarget
                      .value as BillingCycle}
                >
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual · 10% savings</option>
                </select>
              </label>
              <label>
                <span>Seats</span>
                <input
                  type="number"
                  min="1"
                  max="500"
                  required
                  value={quoteSeats.value}
                  onInput={(event) =>
                    quoteSeats.value = event.currentTarget.value}
                />
              </label>
              <label>
                <span>Discount</span>
                <div class="input-suffix">
                  <input
                    type="number"
                    min="0"
                    max="30"
                    required
                    value={quoteDiscount.value}
                    onInput={(event) =>
                      quoteDiscount.value = event.currentTarget.value}
                  />
                  <span>%</span>
                </div>
              </label>
              <label>
                <span>Valid for</span>
                <div class="input-suffix">
                  <input
                    type="number"
                    min="1"
                    max="30"
                    required
                    value={quoteValidDays.value}
                    onInput={(event) =>
                      quoteValidDays.value = event.currentTarget.value}
                  />
                  <span>days</span>
                </div>
              </label>
            </div>
            <aside class="quote-preview" aria-live="polite">
              <span>Draft economics</span>
              <strong>
                {quotePreviewCents === undefined
                  ? "—"
                  : money.format(quotePreviewCents / 100)}
                <small>MRR</small>
              </strong>
              <dl>
                <div>
                  <dt>Annualized</dt>
                  <dd>
                    {quotePreviewCents === undefined
                      ? "—"
                      : money.format(quotePreviewCents * 12 / 100)}
                  </dd>
                </div>
                <div>
                  <dt>Buyer discount</dt>
                  <dd>{quoteTermsValid ? `${quoteDiscountPercent}%` : "—"}</dd>
                </div>
              </dl>
              <button
                type="submit"
                class="primary full"
                disabled={!quoteTermsValid || !quoteDealId.value}
              >
                <FileText size={16} />Create draft
              </button>
            </aside>
          </form>
        </div>
        {quotes.length > 0
          ? (
            <div class="quote-list">
              {quotes.map((quote) => {
                const deal = props.game.records.deals[quote.dealId];
                const lead = deal
                  ? props.game.records.leads[deal.leadId]
                  : undefined;
                const closeRisk = deal?.stage === "negotiation" && lead
                  ? closeLossRiskPercent(lead.engagement)
                  : 0;
                const company = deal
                  ? props.game.records.companies[deal.companyId]
                  : undefined;
                return (
                  <article class="quote-row">
                    <div class="quote-identity">
                      <span>
                        <FileText size={17} />
                      </span>
                      <div>
                        <strong>{company?.name ?? "Unknown company"}</strong>
                        <small>
                          Quote {quote.id.replace("quote_", "#")} · Updated{" "}
                          {gameDate(quote.updatedAt)}
                        </small>
                      </div>
                    </div>
                    <dl class="quote-terms">
                      <div>
                        <dt>Plan</dt>
                        <dd>{statusLabel(quote.product)}</dd>
                      </div>
                      <div>
                        <dt>Seats</dt>
                        <dd>{quote.seats}</dd>
                      </div>
                      <div>
                        <dt>Billing</dt>
                        <dd>{statusLabel(quote.billingCycle)}</dd>
                      </div>
                      <div>
                        <dt>Discount</dt>
                        <dd>{quote.discountPercent}%</dd>
                      </div>
                      <div>
                        <dt>Valid until</dt>
                        <dd>{gameDate(quote.validUntil)}</dd>
                      </div>
                    </dl>
                    <div class="quote-value">
                      <span>Monthly value</span>
                      <strong>
                        {money.format(quote.monthlyValueCents / 100)}
                      </strong>
                      <span class={`status ${quote.status}`}>
                        {statusLabel(quote.status)}
                      </span>
                    </div>
                    <div class="quote-actions">
                      {quote.status === "sent" && closeRisk > 0 && (
                        <small class="close-risk-inline">
                          {closeRisk}% loss risk
                        </small>
                      )}
                      {quote.status === "draft" && (
                        <button
                          type="button"
                          class="secondary"
                          onClick={() =>
                            props.dispatch({
                              type: "set_quote_status",
                              quoteId: quote.id,
                              status: "sent",
                            })}
                        >
                          <Send size={15} />Send
                        </button>
                      )}
                      {quote.status === "sent" && (
                        <button
                          type="button"
                          class="primary"
                          disabled={deal?.stage !== "negotiation"}
                          title={deal?.stage === "negotiation"
                            ? "Accept quote"
                            : "Advance deal to negotiation first"}
                          onClick={() =>
                            props.dispatch({
                              type: "accept_quote",
                              quoteId: quote.id,
                            })}
                        >
                          <Check size={15} />Accept
                        </button>
                      )}
                      {(quote.status === "draft" || quote.status === "sent") &&
                        (
                          <button
                            type="button"
                            class="secondary"
                            onClick={() =>
                              props.dispatch({
                                type: "set_quote_status",
                                quoteId: quote.id,
                                status: "expired",
                              })}
                          >
                            Expire
                          </button>
                        )}
                    </div>
                  </article>
                );
              })}
            </div>
          )
          : (
            <div class="quote-empty">
              <FileText size={22} />
              <div>
                <strong>No quotes yet</strong>
                <span>
                  Create a draft to begin negotiating commercial terms.
                </span>
              </div>
            </div>
          )}
      </section>
      {editingDeal && (
        <section class="panel deal-editor">
          <div class="panel-heading">
            <div>
              <h2>Edit {detail(editingDeal).company?.name ?? "deal"}</h2>
              <span>Update terms or record a closed-lost outcome</span>
            </div>
            <button
              type="button"
              class="icon-button"
              aria-label="Close deal editor"
              onClick={() => editingDealId.value = undefined}
            >
              <X size={17} />
            </button>
          </div>
          <form onSubmit={submitDeal}>
            <label>
              <span>Owner</span>
              <select
                value={editingDeal.ownerId ?? ""}
                onChange={(event) =>
                  props.dispatch({
                    type: "assign_deal",
                    dealId: editingDeal.id,
                    ownerId: event.currentTarget.value || undefined,
                  })}
              >
                <option value="">Founder</option>
                {salesReps.map((rep) => (
                  <option value={rep.id}>{rep.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Product</span>
              <select
                value={editProduct.value}
                onChange={(event) =>
                  editProduct.value = event.currentTarget.value as DealProduct}
              >
                <option value="starter">Starter</option>
                <option value="growth">Growth</option>
                <option value="scale">Scale</option>
              </select>
            </label>
            <label>
              <span>Monthly value</span>
              <input
                type="number"
                min="100"
                max="5000"
                step="25"
                required
                value={editValue.value}
                onInput={(event) => editValue.value = event.currentTarget.value}
              />
            </label>
            <label>
              <span>Expected close (days)</span>
              <input
                type="number"
                min="1"
                max="90"
                required
                value={editCloseDays.value}
                onInput={(event) =>
                  editCloseDays.value = event.currentTarget.value}
              />
            </label>
            <button type="submit" class="primary">
              <Check size={16} />Save deal
            </button>
          </form>
          <div class="deal-loss-controls">
            <label>
              <span>Loss reason</span>
              <select
                value={lossReason.value}
                onChange={(event) =>
                  lossReason.value = event.currentTarget
                    .value as DealLossReason}
              >
                <option value="budget">Budget</option>
                <option value="timing">Timing</option>
                <option value="competition">Competition</option>
                <option value="no_decision">No decision</option>
                <option value="poor_fit">Poor fit</option>
              </select>
            </label>
            <button type="button" class="danger-button" onClick={closeLost}>
              <X size={16} />Close as lost
            </button>
          </div>
        </section>
      )}
      {openDeals.length === 0
        ? (
          <div class="panel">
            <EmptyState
              title="No open deals"
              detail="Qualify contacted leads to create pipeline records."
            />
          </div>
        )
        : props.mode === "list"
        ? (
          <div class="panel table-panel">
            <div class="table-toolbar">
              <strong>
                {selectedDeals.value.size || openDeals.length}{" "}
                {selectedDeals.value.size ? "selected" : "open deals"}
              </strong>
              {selectedDeals.value.size > 0
                ? (
                  <div class="bulk-actions">
                    <select
                      aria-label="Bulk deal owner"
                      value={bulkOwner.value}
                      onChange={(event) =>
                        bulkOwner.value = event.currentTarget.value}
                    >
                      <option value="">Founder</option>
                      {salesReps.map((rep) => (
                        <option value={rep.id}>{rep.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      class="secondary"
                      onClick={() => {
                        props.dispatch({
                          type: "bulk_assign_deals",
                          dealIds: [...selectedDeals.value],
                          ownerId: bulkOwner.value || undefined,
                        });
                        clearSelection();
                      }}
                    >
                      <Users size={15} />Assign
                    </button>
                    <button
                      type="button"
                      class="primary"
                      onClick={() => {
                        props.dispatch({
                          type: "bulk_advance_deals",
                          dealIds: [...selectedDeals.value],
                        });
                        clearSelection();
                      }}
                    >
                      Advance <ChevronRight size={15} />
                    </button>
                  </div>
                )
                : <span>Forecast derived from current probabilities</span>}
            </div>
            <div class="table-scroll">
              <table class="pipeline-table">
                <thead>
                  <tr>
                    <th aria-label="Select deals"></th>
                    <th>Deal</th>
                    <th>Stage</th>
                    <th>Product</th>
                    <th>Owner</th>
                    <th>Value</th>
                    <th>Probability</th>
                    <th>Stage age</th>
                    <th>Expected close</th>
                    <th aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {openDeals.map((deal) => {
                    const { lead, company } = detail(deal);
                    const closeRisk = deal.stage === "negotiation" && lead
                      ? closeLossRiskPercent(lead.engagement)
                      : 0;
                    return (
                      <tr id={`record-${deal.id}`} tabIndex={-1}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${company?.name ?? "deal"}`}
                            disabled={deal.stage === "negotiation"}
                            checked={selectedDeals.value.has(deal.id)}
                            onChange={() => toggleDeal(deal.id)}
                          />
                        </td>
                        <td>
                          <strong>{company?.name ?? "Unknown company"}</strong>
                          <small>
                            {lead
                              ? `${lead.firstName} ${lead.lastName}`
                              : "Unknown contact"}
                          </small>
                        </td>
                        <td>
                          <span class={`status ${deal.stage}`}>
                            {statusLabel(deal.stage)}
                          </span>
                        </td>
                        <td>{statusLabel(deal.product)}</td>
                        <td>
                          {deal.ownerId
                            ? props.game.records.salesReps[deal.ownerId]
                              ?.name ?? "Unknown"
                            : "Founder"}
                        </td>
                        <td>
                          {money.format(deal.monthlyValueCents / 100)} MRR
                        </td>
                        <td>{deal.probability}%</td>
                        <td>
                          {relativeGameTime(deal.updatedAt, props.currentMinute)
                            .replace(" overdue", "")}
                        </td>
                        <td>
                          {relativeGameTime(
                            deal.expectedCloseAt,
                            props.currentMinute,
                          )}
                        </td>
                        <td>
                          <div class="pipeline-row-actions">
                            {closeRisk > 0 && (
                              <small class="close-risk-inline">
                                {closeRisk}% loss risk
                              </small>
                            )}
                            <button
                              type="button"
                              class="icon-button"
                              aria-label={`Edit ${company?.name ?? "deal"}`}
                              onClick={() => beginEdit(deal)}
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              type="button"
                              class="secondary pipeline-advance"
                              disabled={deal.stage === "negotiation"}
                              onClick={() =>
                                props.dispatch({
                                  type: "advance_deal",
                                  dealId: deal.id,
                                })}
                            >
                              {deal.stage === "negotiation"
                                ? "Decision needed"
                                : "Advance"} <ChevronRight size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
        : (
          <div class="pipeline-board" aria-label="Deal stage board">
            {PIPELINE_STAGES.map((stage) => {
              const stageDeals = openDeals.filter((deal) =>
                deal.stage === stage
              );
              const stageValue = stageDeals.reduce(
                (total, deal) => total + deal.monthlyValueCents,
                0,
              );
              return (
                <section
                  class="pipeline-column"
                  aria-label={statusLabel(stage)}
                >
                  <header>
                    <div>
                      <strong>{statusLabel(stage)}</strong>
                      <span>{stageDeals.length}</span>
                    </div>
                    <small>{money.format(stageValue / 100)} MRR</small>
                  </header>
                  <div>
                    {stageDeals.map((deal) => {
                      const { lead, company } = detail(deal);
                      const closeRisk = deal.stage === "negotiation" && lead
                        ? closeLossRiskPercent(lead.engagement)
                        : 0;
                      return (
                        <article class="pipeline-card">
                          <div>
                            <strong>
                              {company?.name ?? "Unknown company"}
                            </strong>
                            <span>{deal.probability}%</span>
                          </div>
                          <p>
                            {lead
                              ? `${lead.firstName} ${lead.lastName}`
                              : "Unknown contact"}
                          </p>
                          <span class="product-label">
                            {statusLabel(deal.product)}
                          </span>
                          <span class="deal-owner">
                            {deal.ownerId
                              ? props.game.records.salesReps[deal.ownerId]
                                ?.name ?? "Unknown"
                              : "Founder owned"}
                          </span>
                          <b>
                            {money.format(deal.monthlyValueCents / 100)} MRR
                          </b>
                          <dl>
                            <div>
                              <dt>Stage age</dt>
                              <dd>
                                {relativeGameTime(
                                  deal.updatedAt,
                                  props.currentMinute,
                                ).replace(" overdue", "")}
                              </dd>
                            </div>
                            <div>
                              <dt>Close</dt>
                              <dd>
                                {relativeGameTime(
                                  deal.expectedCloseAt,
                                  props.currentMinute,
                                )}
                              </dd>
                            </div>
                          </dl>
                          <div class="pipeline-card-actions">
                            {closeRisk > 0 && (
                              <small class="close-risk-inline">
                                {closeRisk}% loss risk
                              </small>
                            )}
                            <button
                              type="button"
                              class="icon-button"
                              aria-label={`Edit ${company?.name ?? "deal"}`}
                              onClick={() => beginEdit(deal)}
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              type="button"
                              class="secondary"
                              disabled={deal.stage === "negotiation"}
                              onClick={() =>
                                props.dispatch({
                                  type: "advance_deal",
                                  dealId: deal.id,
                                })}
                            >
                              {deal.stage === "negotiation"
                                ? "Decision needed"
                                : "Advance"} <ChevronRight size={15} />
                            </button>
                          </div>
                        </article>
                      );
                    })}
                    {stageDeals.length === 0 && (
                      <span class="column-empty">No deals</span>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
    </>
  );
}

export default function CrmApp(props: CrmAppProps) {
  const store = useGameStore(props.initial);
  const view = useSignal<View>(
    props.loadStatus === "new"
      ? "campaign"
      : onboardingActive(props.initial)
      ? onboardingWorkspace(props.initial)
      : "dashboard",
  );
  const selectedLeadId = useSignal<string | undefined>(undefined);
  const selectedCompanyId = useSignal<string | undefined>(
    Object.keys(props.initial.records.companies)[0],
  );
  const companyName = useSignal(props.initial.company.name);
  const campaignName = useSignal("");
  const campaignChannel = useSignal<CampaignChannel>("email");
  const campaignAudience = useSignal<CampaignAudience>("mid_market");
  const campaignObjective = useSignal<CampaignObjective>("balanced");
  const campaignBudget = useSignal("50");
  const campaignDuration = useSignal("7");
  const campaignMessage = useSignal("");
  const editingCampaignId = useSignal<string | undefined>(undefined);
  const searchQuery = useSignal("");
  const leadFilter = useSignal("all");
  const leadSort = useSignal("newest");
  const showLeadFilters = useSignal(false);
  const showNotifications = useSignal(false);
  const showCompanyMenu = useSignal(false);
  const mobileNav = useSignal(false);
  const showOffline = useSignal(
    props.loadStatus === "offline" || props.loadStatus === "crisis",
  );
  const showCorrupt = useSignal(props.loadStatus === "corrupt");
  const confirmReset = useSignal(false);
  const confirmSkipTutorial = useSignal(false);
  const game = store.game.value;
  const soundDesign = useRef<SoundDesign | undefined>(undefined);
  const previousMusicTarget = useRef<MusicTarget | undefined>(undefined);
  const previousActivityId = useRef(
    game.recentActivities.at(-1)?.id,
  );
  const leadTapOrigin = useRef<
    { pointerId: number; x: number; y: number; moved: boolean } | undefined
  >(undefined);
  const leadReturnFocus = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const musicTarget = resolveMusicTarget(
    musicSnapshotFor(game),
    previousMusicTarget.current,
  );
  const musicTargetKey = musicDirectionKey(musicTarget);
  if (!soundDesign.current) soundDesign.current = new SoundDesign();

  useEffect(() => {
    const audio = soundDesign.current!;
    const handleVisibility = () =>
      void audio.setPageVisible(document.visibilityState === "visible");
    const activateMusic = () => {
      if (store.game.value.preferences.musicEnabled) {
        void audio.setMusic(true);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    document.addEventListener("pointerdown", activateMusic, { once: true });
    document.addEventListener("keydown", activateMusic, { once: true });
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      document.removeEventListener("pointerdown", activateMusic);
      document.removeEventListener("keydown", activateMusic);
      audio.destroy();
    };
  }, []);

  useEffect(() => {
    const latest = game.recentActivities.at(-1);
    if (!latest || latest.id === previousActivityId.current) return;
    previousActivityId.current = latest.id;
    const tone = notificationToneFor(latest.kind);
    if (tone && game.preferences.soundEnabled) {
      void soundDesign.current?.ping(tone);
    }
  }, [game.recentActivities, game.preferences.soundEnabled]);

  useEffect(() => {
    if (!game.preferences.musicEnabled) {
      void soundDesign.current?.setMusic(false);
    }
  }, [game.preferences.musicEnabled]);

  useEffect(() => {
    soundDesign.current?.setMusicVolume(game.preferences.musicVolume);
  }, [game.preferences.musicVolume]);

  useEffect(() => {
    soundDesign.current?.setMusicTarget(musicTarget);
  }, [musicTargetKey]);

  useEffect(() => {
    if (!mobileNav.value) return;
    const scrollPosition = globalThis.scrollY;
    const body = document.body;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollPosition}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") mobileNav.value = false;
    };
    globalThis.addEventListener("keydown", closeOnEscape);
    return () => {
      globalThis.removeEventListener("keydown", closeOnEscape);
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      globalThis.scrollTo(0, scrollPosition);
    };
  }, [mobileNav.value]);
  previousMusicTarget.current = musicTarget.movement === "recovery"
    ? {
      movement: musicTarget.nextMovement ?? "calm",
      intensity: musicTarget.nextMovement === "growth" ? 1 : 0,
      variant: musicTarget.variant,
    }
    : musicTarget;
  const leads = Object.values(game.records.leads).sort((a, b) =>
    b.createdAt - a.createdAt
  );
  const companies = Object.values(game.records.companies).sort((a, b) =>
    b.createdAt - a.createdAt
  );
  const openTasks = Object.values(game.records.tasks).filter((task) =>
    task.status === "open"
  );
  const actionableLeads = leads.filter((lead) =>
    ["new", "contacted", "cold"].includes(lead.status)
  );
  const selectedLead = selectedLeadId.value
    ? game.records.leads[selectedLeadId.value]
    : undefined;
  const selectedCompany = selectedCompanyId.value
    ? game.records.companies[selectedCompanyId.value]
    : undefined;
  const normalizedQuery = searchQuery.value.trim().toLowerCase();
  const searchResults = normalizedQuery
    ? leads.filter((lead) => {
      const company = game.records.companies[lead.companyId];
      return [
        lead.firstName,
        lead.lastName,
        lead.email,
        lead.role,
        company?.name,
        company?.industry,
      ].some((value) => value?.toLowerCase().includes(normalizedQuery));
    }).slice(0, 6)
    : [];
  const filteredLeads = leads.filter((lead) =>
    leadFilter.value === "all" || lead.status === leadFilter.value
  ).sort((a, b) => {
    if (leadSort.value === "fit") return b.fit - a.fit;
    if (leadSort.value === "intent") return b.engagement - a.engagement;
    return b.createdAt - a.createdAt;
  });
  const marketingUnlocked = game.unlocks.includes("marketing");
  const pipelineUnlocked = game.unlocks.includes("pipeline");
  const customerSuccessUnlocked = game.unlocks.includes("customer_success");
  const automationUnlocked = customerSuccessUnlocked &&
    game.company.customerCount >= 8;
  const operationsUnlocked = game.company.mrrCents >= 1_000_000 ||
    game.platform.departments.length > 0;
  const referralLeads = leads.filter((lead) => lead.source === "referral");
  const allCampaigns = Object.values(game.records.campaigns).sort((a, b) =>
    b.createdAt - a.createdAt
  );
  const campaigns = allCampaigns.filter((campaign) =>
    campaign.status !== "archived"
  );
  const campaignLeads = leads.filter((lead) => lead.source === "campaign");
  const campaignSpendCents = game.history.campaignSpendArchivedCents +
    allCampaigns.reduce(
      (total, campaign) => total + campaign.totalSpentCents,
      0,
    );
  const campaignLeadIds = new Set(campaignLeads.map((lead) => lead.id));
  const campaignDeals = Object.values(game.records.deals).filter((deal) =>
    campaignLeadIds.has(deal.leadId)
  );
  const campaignCustomers = Object.values(game.records.customers).filter(
    (customer) => campaignLeadIds.has(customer.primaryLeadId),
  );
  const attributedMrrCents = campaignCustomers.reduce(
    (total, customer) => total + customer.monthlyValueCents,
    0,
  );
  const openPipelineCents = campaignDeals.filter((deal) =>
    !["won", "lost"].includes(deal.stage)
  ).reduce((total, deal) => total + deal.monthlyValueCents, 0);
  const channelReports = (["email", "paid_social", "events"] as const).map(
    (channel) => {
      const channelCampaigns = allCampaigns.filter((campaign) =>
        campaign.channel === channel
      );
      const campaignIds = new Set(
        channelCampaigns.map((campaign) => campaign.id),
      );
      const channelLeads = campaignLeads.filter((lead) =>
        lead.campaignId && campaignIds.has(lead.campaignId)
      );
      const leadIds = new Set(channelLeads.map((lead) => lead.id));
      const customers = Object.values(game.records.customers).filter((
        customer,
      ) => leadIds.has(customer.primaryLeadId));
      return {
        channel,
        spendCents: channelCampaigns.reduce(
          (total, campaign) => total + campaign.totalSpentCents,
          0,
        ),
        leads: channelLeads.length,
        customers: customers.length,
        mrrCents: customers.reduce(
          (total, customer) => total + customer.monthlyValueCents,
          0,
        ),
      };
    },
  );
  const normalizedCompanyName = companyName.value.trim().replaceAll(
    /\s+/g,
    " ",
  );
  const companyNameError = normalizedCompanyName.length < 2
    ? "Enter at least 2 characters."
    : normalizedCompanyName.length > 60
    ? "Use 60 characters or fewer."
    : undefined;
  const referralBlockedReason = game.clock.status !== "active"
    ? "Company time must be active before requesting introductions."
    : game.company.founderCapacityRemaining < 60
    ? "Requires 60 minutes of available founder capacity."
    : undefined;
  const prospectingBlockedReason = game.clock.status !== "active"
    ? "Company time must be active before prospecting."
    : game.company.founderCapacityRemaining <
        DEFAULT_RULES.prospectingCapacityMinutes
    ? `Requires ${DEFAULT_RULES.prospectingCapacityMinutes} minutes of founder capacity.`
    : undefined;
  const effectiveMinute = game.clock.gameMinute + Math.max(
    0,
    Math.floor(
      (store.now.value - game.lastSimulatedAt) /
        DEFAULT_RULES.realMillisecondsPerGameMinute *
        game.preferences.timeScale,
    ),
  );
  const guidance = selectGuidance(game);
  const saveDetail = savedAtLabel(
    store.lastSuccessfulSaveAt.value,
    store.now.value,
  );

  const navigate = (next: View) => {
    if (!tutorialAllowsView(game, next)) return;
    if (next === "contacts") selectedLeadId.value = undefined;
    view.value = next;
    mobileNav.value = false;
    showNotifications.value = false;
    showCompanyMenu.value = false;
  };

  const openCampaignBriefing = () => {
    navigate("campaign");
    globalThis.requestAnimationFrame(() => {
      globalThis.requestAnimationFrame(() => {
        const briefing = document.getElementById("campaign-briefing");
        briefing?.scrollIntoView({ behavior: "smooth", block: "start" });
        briefing?.focus({ preventScroll: true });
      });
    });
  };

  const openSearchResult = (leadId: string, trigger: HTMLElement) => {
    openLead(leadId, trigger);
    searchQuery.value = "";
    navigate("leads");
  };

  const openGuidance = (trigger?: HTMLElement) => {
    navigate(guidance.workspace);
    if (
      guidance.workspace === "leads" &&
      game.records.leads[guidance.targetId]
    ) {
      globalThis.requestAnimationFrame(() =>
        openLead(guidance.targetId, trigger)
      );
      return;
    }
    globalThis.requestAnimationFrame(() => {
      globalThis.requestAnimationFrame(() => {
        const target = document.getElementById(`record-${guidance.targetId}`);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
      });
    });
  };

  const openLead = (leadId: string, trigger?: HTMLElement) => {
    const activeElement = document.activeElement;
    leadReturnFocus.current = trigger ??
      (activeElement instanceof HTMLElement ? activeElement : null);
    selectedLeadId.value = leadId;
  };

  const closeLead = () => {
    selectedLeadId.value = undefined;
    const returnTarget = leadReturnFocus.current;
    leadReturnFocus.current = null;
    globalThis.requestAnimationFrame(() => {
      if (returnTarget?.isConnected) {
        returnTarget.focus();
        return;
      }
      searchInputRef.current?.focus();
    });
  };

  const beginLeadTap = (
    event: JSX.TargetedPointerEvent<HTMLTableRowElement>,
  ) => {
    if ((event.target as Element).closest("button")) {
      leadTapOrigin.current = undefined;
      return;
    }
    leadTapOrigin.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
  };

  const moveLeadTap = (
    event: JSX.TargetedPointerEvent<HTMLTableRowElement>,
  ) => {
    const origin = leadTapOrigin.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    if (
      Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8
    ) origin.moved = true;
  };

  const finishLeadTap = (
    event: JSX.TargetedPointerEvent<HTMLTableRowElement>,
    leadId: string,
  ) => {
    const origin = leadTapOrigin.current;
    leadTapOrigin.current = undefined;
    if (
      !origin || origin.pointerId !== event.pointerId || origin.moved ||
      (event.target as Element).closest("button")
    ) return;
    openLead(leadId, event.currentTarget);
  };

  const cancelLeadTap = () => {
    leadTapOrigin.current = undefined;
  };

  const openLeadFromKeyboard = (
    event: JSX.TargetedKeyboardEvent<HTMLTableRowElement>,
    leadId: string,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openLead(leadId, event.currentTarget);
  };

  const dispatch = (command: GameCommand) => {
    const previousChapter = store.game.value.narrative.chapter;
    const previousOnboardingStep = store.game.value.onboarding.step;
    const accepted = store.dispatch(command);
    if (
      accepted && store.game.value.narrative.chapter > previousChapter
    ) view.value = "campaign";
    else if (
      accepted && onboardingActive(store.game.value) &&
      store.game.value.onboarding.step !== previousOnboardingStep
    ) view.value = onboardingWorkspace(store.game.value);
    return accepted;
  };

  const performTutorialAction = () => {
    const step = game.onboarding.step;
    if (step === "complete") return;
    if (onboardingPausesSimulation(game)) {
      if (!dispatch({ type: "acknowledge_onboarding", step })) return;
    } else {
      navigate(onboardingWorkspace(game));
    }
    if (
      [
        "inspect_lead",
        "contact_lead",
        "qualify_lead",
        "work_deal",
        "repeat_sales",
      ].includes(step)
    ) {
      const targetLead = Object.values(store.game.value.records.leads).find(
        (lead) => lead.status !== "converted" && lead.status !== "disqualified",
      );
      if (targetLead) {
        globalThis.requestAnimationFrame(() => openLead(targetLead.id));
      }
    }
  };

  const renameCompany = (event: SubmitEvent) => {
    event.preventDefault();
    if (dispatch({ type: "rename_company", name: companyName.value })) {
      companyName.value = store.game.value.company.name;
    }
  };

  const resetCampaignForm = () => {
    editingCampaignId.value = undefined;
    campaignName.value = "";
    campaignChannel.value = "email";
    campaignAudience.value = "mid_market";
    campaignObjective.value = "balanced";
    campaignBudget.value = "50";
    campaignDuration.value = "7";
    campaignMessage.value = "";
  };

  const editCampaign = (campaignId: string) => {
    const campaign = game.records.campaigns[campaignId];
    editingCampaignId.value = campaign.id;
    campaignName.value = campaign.name;
    campaignChannel.value = campaign.channel;
    campaignAudience.value = campaign.audience;
    campaignObjective.value = campaign.objective;
    campaignBudget.value = String(campaign.dailyBudgetCents / 100);
    campaignDuration.value = String(
      Math.max(
        1,
        Math.min(30, Math.ceil((campaign.endsAt - effectiveMinute) / 1_440)),
      ),
    );
    campaignMessage.value = campaign.message;
  };

  const submitCampaign = (event: SubmitEvent) => {
    event.preventDefault();
    const values = {
      name: campaignName.value,
      channel: campaignChannel.value,
      audience: campaignAudience.value,
      objective: campaignObjective.value,
      dailyBudgetCents: Math.round(Number(campaignBudget.value) * 100),
      durationDays: Number(campaignDuration.value),
      message: campaignMessage.value,
    };
    const accepted = editingCampaignId.value
      ? dispatch({
        type: "update_campaign",
        campaignId: editingCampaignId.value,
        ...values,
      })
      : dispatch({ type: "create_campaign", ...values });
    if (accepted) resetCampaignForm();
  };

  const iterateCampaign = (campaignId: string) => {
    const nextCampaignId = `campaign_${game.sequences.campaign + 1}`;
    if (dispatch({ type: "duplicate_campaign", campaignId })) {
      editCampaign(nextCampaignId);
      document.querySelector(".campaign-builder")?.scrollIntoView({
        behavior: game.preferences.reducedMotion ? "auto" : "smooth",
        block: "start",
      });
    }
  };

  const importFile = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      await store.importSave(JSON.parse(await file.text()));
      companyName.value = store.game.value.company.name;
      store.notice.value = "Company imported";
      view.value = "dashboard";
    } catch (error) {
      store.notice.value = error instanceof Error
        ? error.message
        : "Import failed";
    } finally {
      input.value = "";
    }
  };

  const navItems: Array<
    { id: View; label: string; icon: JSX.Element; count?: number }
  > = [
    {
      id: "campaign",
      label: "Campaign",
      icon: <FileText size={17} />,
      count:
        narrativeObjectives(game).filter((objective) =>
          objective.current < objective.target
        ).length,
    },
    {
      id: "dashboard",
      label: "Dashboard",
      icon: <LayoutDashboard size={17} />,
    },
    {
      id: "leads",
      label: "Lead inbox",
      icon: <Inbox size={17} />,
      count: leads.length,
    },
    {
      id: "contacts",
      label: "Contacts",
      icon: <Users size={17} />,
      count: leads.length,
    },
    {
      id: "companies",
      label: "Companies",
      icon: <Building2 size={17} />,
      count: companies.length,
    },
    {
      id: "tasks",
      label: "Tasks",
      icon: <Check size={17} />,
      count: openTasks.length,
    },
  ];

  if (game.narrative.chapter === 0 && game.narrative.pendingBriefing) {
    return (
      <PrologueScreen
        game={game}
        onBegin={() => {
          dispatch({ type: "acknowledge_narrative" });
          view.value = "leads";
        }}
      />
    );
  }

  return (
    <div
      class={`crm-app palette-${game.preferences.palette} ${
        game.preferences.darkMode ? "dark-mode" : ""
      } ${game.preferences.reducedMotion ? "reduce-motion" : ""}`}
    >
      <aside class={`sidebar ${mobileNav.value ? "open" : ""}`}>
        <div class="brand">
          <div class="brand-mark">{initials(game.company.name)}</div>
          <div>
            <strong>{game.company.name}</strong>
            <span>Founder Campaign</span>
          </div>
          <button
            type="button"
            class="icon-button mobile-only"
            onClick={() => mobileNav.value = false}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <nav aria-label="Primary">
          <span class="nav-heading">Workspace</span>
          {navItems.map((item) => {
            const available = tutorialAllowsView(game, item.id);
            const current = onboardingActive(game) &&
              onboardingWorkspace(game) === item.id;
            return (
              <button
                type="button"
                class={`${view.value === item.id ? "active" : ""} ${
                  available ? "" : "locked"
                } ${current ? "tutorial-current" : ""}`}
                disabled={!available}
                title={available
                  ? undefined
                  : "Introduced later in Guided Chapter 1"}
                onClick={() => navigate(item.id)}
              >
                {available ? item.icon : <LockKeyhole size={16} />}
                <span>{item.label}</span>
                {item.count !== undefined && <b>{item.count}</b>}
              </button>
            );
          })}
          <span class="nav-heading">Growth</span>
          <button
            type="button"
            class={`${marketingUnlocked ? "" : "locked"} ${
              view.value === "marketing" ? "active" : ""
            }`}
            disabled={!marketingUnlocked}
            onClick={() => navigate("marketing")}
          >
            <BarChart3 size={17} />
            <span>Marketing</span>
            {marketingUnlocked
              ? <ChevronRight size={14} />
              : <LockKeyhole size={13} />}
          </button>
          <button
            type="button"
            class={`${pipelineUnlocked ? "" : "locked"} ${
              view.value === "pipeline" ? "active" : ""
            }`}
            disabled={!pipelineUnlocked}
            onClick={() => navigate("pipeline")}
          >
            <Target size={17} />
            <span>Pipeline</span>
            {pipelineUnlocked
              ? <ChevronRight size={14} />
              : <LockKeyhole size={13} />}
          </button>
          <button
            type="button"
            class={`${customerSuccessUnlocked ? "" : "locked"} ${
              view.value === "customers" ? "active" : ""
            }`}
            disabled={!customerSuccessUnlocked}
            onClick={() => navigate("customers")}
          >
            <Activity size={17} />
            <span>Customer success</span>
            {customerSuccessUnlocked
              ? <ChevronRight size={14} />
              : <LockKeyhole size={13} />}
          </button>
          <button
            type="button"
            class={`${automationUnlocked ? "" : "locked"} ${
              view.value === "automation" ? "active" : ""
            }`}
            disabled={!automationUnlocked}
            onClick={() => navigate("automation")}
          >
            <Activity size={17} />
            <span>Automation</span>
            {automationUnlocked
              ? <ChevronRight size={14} />
              : <LockKeyhole size={13} />}
          </button>
          <button
            type="button"
            class={`${automationUnlocked ? "" : "locked"} ${
              view.value === "analytics" ? "active" : ""
            }`}
            disabled={!automationUnlocked}
            onClick={() => navigate("analytics")}
          >
            <BarChart3 size={17} />
            <span>Analytics</span>
            {automationUnlocked
              ? <ChevronRight size={14} />
              : <LockKeyhole size={13} />}
          </button>
          <button
            type="button"
            class={`${operationsUnlocked ? "" : "locked"} ${
              view.value === "operations" ? "active" : ""
            }`}
            disabled={!operationsUnlocked}
            onClick={() => navigate("operations")}
          >
            <Building2 size={17} />
            <span>Operations</span>
            {operationsUnlocked
              ? <ChevronRight size={14} />
              : <LockKeyhole size={13} />}
          </button>
        </nav>
        <div class={`unlock-note ${pipelineUnlocked ? "unlocked" : ""}`}>
          {pipelineUnlocked ? <Target size={15} /> : <LockKeyhole size={15} />}
          <div>
            <strong>
              {pipelineUnlocked ? "Sales operations active" : "Pipeline locked"}
            </strong>
            <span>
              {pipelineUnlocked
                ? "Forecast and manage every open deal."
                : `${
                  money.format(DEFAULT_RULES.pipelineUnlockMrrCents / 100)
                } MRR and ${DEFAULT_RULES.pipelineUnlockCustomers} customers required.`}
            </span>
          </div>
        </div>
        <button
          type="button"
          class={`settings-link ${view.value === "settings" ? "active" : ""}`}
          onClick={() => navigate("settings")}
        >
          <Settings size={17} />Settings
        </button>
      </aside>
      {mobileNav.value && (
        <button
          type="button"
          class="nav-scrim"
          aria-label="Close navigation"
          onClick={() => mobileNav.value = false}
        />
      )}

      <main>
        <header class="topbar">
          <button
            type="button"
            class="icon-button mobile-only"
            onClick={() => mobileNav.value = true}
            aria-label="Open navigation"
          >
            <Menu size={19} />
          </button>
          <div class="search-shell">
            <div class="search">
              <Search size={16} />
              <input
                ref={searchInputRef}
                aria-label="Search CRM"
                placeholder="Search contacts and companies"
                value={searchQuery.value}
                onInput={(event) =>
                  searchQuery.value = event.currentTarget.value}
              />
              {searchQuery.value && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => searchQuery.value = ""}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            {normalizedQuery && (
              <div class="search-results">
                {searchResults.map((lead) => (
                  <button
                    type="button"
                    onClick={(event) =>
                      openSearchResult(lead.id, event.currentTarget)}
                  >
                    <Users size={17} />
                    <span>
                      <strong>{lead.firstName} {lead.lastName}</strong>
                      <small>
                        {lead.role} ·{" "}
                        {game.records.companies[lead.companyId].name}
                      </small>
                    </span>
                  </button>
                ))}
                {searchResults.length === 0 && (
                  <div class="search-empty">No matching CRM records</div>
                )}
              </div>
            )}
          </div>
          <span
            class={`save-state mobile-save-state ${store.saveStatus.value}`}
            role="status"
            aria-live="polite"
            title={saveDetail}
          >
            {store.saveStatus.value === "saving" && <RefreshCw size={13} />}
            {statusLabel(store.saveStatus.value)}
          </span>
          <details class="mobile-topbar-overflow">
            <summary class="icon-button" aria-label="More workspace controls">
              <SlidersHorizontal size={18} />
            </summary>
            <div class="mobile-topbar-menu">
              <div class="mobile-topbar-clock">
                <Clock3 size={15} />
                <span>
                  <small>Simulation time</small>
                  <strong>{gameDate(effectiveMinute)}</strong>
                </span>
              </div>
              <div class="mobile-speed-control">
                <span>Simulation speed</span>
                <div
                  class="time-controls"
                  role="group"
                  aria-label="Simulation speed"
                >
                  {([1, 2, 4] as const).map((timeScale) => (
                    <button
                      type="button"
                      class={game.preferences.timeScale === timeScale
                        ? "active"
                        : ""}
                      aria-pressed={game.preferences.timeScale === timeScale}
                      onClick={() =>
                        dispatch({ type: "set_time_scale", timeScale })}
                    >
                      {timeScale}×
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute(
                    "open",
                  );
                  navigate("tasks");
                }}
              >
                <Bell size={16} />
                <span>Notifications</span>
                <b>{openTasks.length}</b>
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute(
                    "open",
                  );
                  navigate("settings");
                }}
              >
                <Settings size={16} />
                <span>Workspace settings</span>
              </button>
            </div>
          </details>
          <div class="topbar-meta">
            <div
              class="time-controls"
              role="group"
              aria-label="Simulation speed"
            >
              {([1, 2, 4] as const).map((timeScale) => (
                <button
                  type="button"
                  class={game.preferences.timeScale === timeScale
                    ? "active"
                    : ""}
                  aria-pressed={game.preferences.timeScale === timeScale}
                  onClick={() =>
                    dispatch({ type: "set_time_scale", timeScale })}
                >
                  {timeScale}×
                </button>
              ))}
            </div>
            <span
              class={`save-state ${store.saveStatus.value}`}
              role="status"
              aria-live="polite"
              title={saveDetail}
            >
              {store.saveStatus.value === "saving" && <RefreshCw size={13} />}
              <span>
                {statusLabel(store.saveStatus.value)}
                <small>{saveDetail}</small>
              </span>
            </span>
            <span class="game-clock">
              <Clock3 size={14} />
              {gameDate(effectiveMinute)}
            </span>
            <div class="topbar-popover">
              <button
                type="button"
                class="icon-button"
                aria-label="Notifications"
                aria-expanded={showNotifications.value}
                onClick={() => {
                  showNotifications.value = !showNotifications.value;
                  showCompanyMenu.value = false;
                }}
              >
                <Bell size={18} />
                {openTasks.length > 0 && <i />}
              </button>
              {showNotifications.value && (
                <div class="popover notification-popover">
                  <strong>Work requiring attention</strong>
                  {openTasks.length === 0
                    ? <span>Your queue is clear.</span>
                    : openTasks.slice(0, 4).map((task) => (
                      <button
                        type="button"
                        onClick={() => navigate("tasks")}
                      >
                        <span>{task.title}</span>
                        <small>
                          {relativeGameTime(task.dueAt, effectiveMinute)}
                        </small>
                      </button>
                    ))}
                  {openTasks.length > 4 && (
                    <button
                      type="button"
                      onClick={() => navigate("tasks")}
                    >
                      View all {openTasks.length} tasks
                    </button>
                  )}
                </div>
              )}
            </div>
            <div class="topbar-popover">
              <button
                type="button"
                class="avatar"
                aria-label="Company menu"
                aria-expanded={showCompanyMenu.value}
                onClick={() => {
                  showCompanyMenu.value = !showCompanyMenu.value;
                  showNotifications.value = false;
                }}
              >
                {initials(game.company.name)}
              </button>
              {showCompanyMenu.value && (
                <div class="popover company-menu">
                  <strong>{game.company.name}</strong>
                  <span>{money.format(game.company.mrrCents / 100)} MRR</span>
                  <button type="button" onClick={() => navigate("settings")}>
                    <Settings size={16} />Workspace settings
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {store.saveStatus.value === "error" && (
          <div class="inline-alert error" role="alert">
            <span>
              <strong>Changes are not saved.</strong>
              Your previous browser save remains intact. {saveDetail}.
              {store.consecutiveSaveFailures.value > 1
                ? ` Save has failed ${store.consecutiveSaveFailures.value} times; export a backup after retrying.`
                : " Retry without closing this tab."}
            </span>
            <button
              type="button"
              class="secondary"
              onClick={() =>
                void store.saveNow()}
            >
              <RefreshCw size={16} />Retry save
            </button>
          </div>
        )}

        <section class="workspace">
          <NarrativePanel game={game} onOpen={openCampaignBriefing} />
          <TutorialPanel
            game={game}
            onAction={performTutorialAction}
            onSkip={() => confirmSkipTutorial.value = true}
          />
          {view.value === "campaign" && <CampaignWorkspace game={game} />}
          {view.value === "dashboard" && (
            <>
              <div class="page-heading">
                <div>
                  <span>Revenue operations</span>
                  <h1>Company pulse</h1>
                  <p>Your live acquisition and delivery workload.</p>
                </div>
                <button
                  type="button"
                  class="primary"
                  onClick={() => navigate("leads")}
                >
                  <Inbox size={16} />Work leads
                </button>
              </div>
              {!onboardingActive(game) && (
                <section class="guidance-card" aria-labelledby="guidance-title">
                  <div class="guidance-icon">
                    <Target size={20} />
                  </div>
                  <div>
                    <span>Next best action</span>
                    <h2 id="guidance-title">{guidance.actionLabel}</h2>
                    <p>{guidance.reason}</p>
                  </div>
                  <button
                    type="button"
                    class="primary"
                    onClick={(event) =>
                      openGuidance(event.currentTarget)}
                  >
                    Open work <ChevronRight size={15} />
                  </button>
                </section>
              )}
              <div class="kpi-grid">
                <Kpi
                  label="Cash"
                  value={money.format(game.company.cashCents / 100)}
                  detail={`${
                    Math.max(
                      0,
                      Math.floor(
                        game.company.cashCents /
                          Math.max(
                            1,
                            game.company.baselineMonthlyExpensesCents,
                          ),
                      ),
                    )
                  } months runway`}
                  icon={<CircleDollarSign size={19} />}
                  tone={game.company.cashCents <
                      game.company.baselineMonthlyExpensesCents
                    ? "warning"
                    : "positive"}
                />
                <Kpi
                  label="Monthly revenue"
                  value={money.format(game.company.mrrCents / 100)}
                  detail={`${game.company.customerCount} active customers`}
                  icon={<Gauge size={19} />}
                  tone="positive"
                />
                <Kpi
                  label="Open leads"
                  value={String(
                    leads.filter((lead) =>
                      !["converted", "disqualified"].includes(lead.status)
                    ).length,
                  )}
                  detail={`${game.history.leadsQualified} qualified all time`}
                  icon={<Users size={19} />}
                />
                <Kpi
                  label="Founder capacity"
                  value={`${game.company.founderCapacityRemaining}m`}
                  detail={`of ${game.company.founderCapacityMinutes}m today`}
                  icon={<Clock3 size={19} />}
                />
              </div>
              <div class="dashboard-grid">
                <div class="panel">
                  <div class="panel-heading">
                    <div>
                      <h2>Priority work</h2>
                      <span>Tasks requiring attention</span>
                    </div>
                    <button
                      type="button"
                      class="text-button"
                      onClick={() => navigate("tasks")}
                    >
                      View all <ChevronRight size={14} />
                    </button>
                  </div>
                  {openTasks.length === 0
                    ? (
                      <EmptyState
                        title="Queue cleared"
                        detail="New work appears as leads and customers progress."
                      />
                    )
                    : (
                      <div class="task-list">
                        {openTasks.slice(0, 5).map((task) => (
                          <TaskRow
                            task={task}
                            currentMinute={effectiveMinute}
                            onComplete={() =>
                              dispatch({
                                type: "complete_task",
                                taskId: task.id,
                              })}
                            onCancel={() =>
                              dispatch({
                                type: "cancel_task",
                                taskId: task.id,
                              })}
                          />
                        ))}
                      </div>
                    )}
                </div>
                <div class="panel">
                  <div class="panel-heading">
                    <div>
                      <h2>Recent activity</h2>
                      <span>Company timeline</span>
                    </div>
                  </div>
                  <div class="activity-list">
                    {game.recentActivities.length === 0
                      ? (
                        <EmptyState
                          title="No activity yet"
                          detail="CRM events appear here as work is completed."
                        />
                      )
                      : game.recentActivities.slice(-7).reverse().map((
                        activity,
                      ) => (
                        <div>
                          <i />
                          <span>
                            <strong>{activity.summary}</strong>
                            <small>{gameDate(activity.gameMinute)}</small>
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {view.value === "leads" && (
            <>
              <div class="page-heading">
                <div>
                  <span>Acquisition</span>
                  <h1>Lead inbox</h1>
                  <p>Qualify fit, build intent, and convert demand.</p>
                </div>
                <div class="view-actions">
                  <button
                    type="button"
                    class="primary"
                    disabled={Boolean(prospectingBlockedReason)}
                    title={prospectingBlockedReason}
                    onClick={() => {
                      if (dispatch({ type: "prospect_lead" })) {
                        openLead(
                          `lead_${store.game.value.sequences.lead}`,
                        );
                      }
                    }}
                  >
                    <Search size={16} />Prospect lead ·{" "}
                    {DEFAULT_RULES.prospectingCapacityMinutes}m
                  </button>
                  <button
                    type="button"
                    class={`secondary ${showLeadFilters.value ? "active" : ""}`}
                    aria-expanded={showLeadFilters.value}
                    onClick={() =>
                      showLeadFilters.value = !showLeadFilters.value}
                  >
                    <SlidersHorizontal size={16} />Filter
                  </button>
                  <button
                    type="button"
                    class="secondary"
                    disabled={actionableLeads.length === 0}
                    onClick={(event) => {
                      const leadId = actionableLeads[0]?.id;
                      if (leadId) openLead(leadId, event.currentTarget);
                    }}
                  >
                    <Target size={16} />Next lead
                  </button>
                </div>
              </div>
              {!onboardingActive(game) && (
                <section
                  class="guidance-card compact"
                  aria-labelledby="lead-guidance-title"
                >
                  <div class="guidance-icon">
                    <Target size={18} />
                  </div>
                  <div>
                    <span>Recommended now</span>
                    <h2 id="lead-guidance-title">{guidance.actionLabel}</h2>
                    <p>{guidance.reason}</p>
                  </div>
                  <button
                    type="button"
                    class="secondary"
                    onClick={(event) => openGuidance(event.currentTarget)}
                  >
                    Go <ChevronRight size={14} />
                  </button>
                </section>
              )}
              {showLeadFilters.value && (
                <div class="filter-bar">
                  <label>
                    <span>Status</span>
                    <select
                      value={leadFilter.value}
                      onChange={(event) =>
                        leadFilter.value = event.currentTarget.value}
                    >
                      <option value="all">All statuses</option>
                      <option value="new">New</option>
                      <option value="contacted">Contacted</option>
                      <option value="qualified">Qualified</option>
                      <option value="converted">Converted</option>
                      <option value="disqualified">Disqualified</option>
                    </select>
                  </label>
                  <label>
                    <span>
                      <ArrowUpDown size={15} />Sort
                    </span>
                    <select
                      value={leadSort.value}
                      onChange={(event) =>
                        leadSort.value = event.currentTarget.value}
                    >
                      <option value="newest">Newest first</option>
                      <option value="fit">Highest fit</option>
                      <option value="intent">Highest intent</option>
                    </select>
                  </label>
                  {leadFilter.value !== "all" && (
                    <button
                      type="button"
                      class="text-button"
                      onClick={() => leadFilter.value = "all"}
                    >
                      Clear filter
                    </button>
                  )}
                </div>
              )}
              <div
                class={`record-layout lead-record-layout ${
                  showLeadFilters.value ? "filters-open" : ""
                }`}
              >
                <div class="panel table-panel">
                  <div class="table-toolbar">
                    <strong>{filteredLeads.length} leads</strong>
                    <span>
                      {leads.filter((lead) => lead.status === "new").length} new
                    </span>
                  </div>
                  <div class="table-scroll">
                    <table class="lead-table">
                      <thead>
                        <tr>
                          <th>Contact</th>
                          <th>Company</th>
                          <th>Status</th>
                          <th>Fit</th>
                          <th>Intent</th>
                          <th class="mobile-actions-heading">Open</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLeads.map((lead) => {
                          const company =
                            game.records.companies[lead.companyId];
                          return (
                            <tr
                              class={selectedLead?.id === lead.id
                                ? "selected"
                                : ""}
                              tabIndex={0}
                              aria-label={`Open ${lead.firstName} ${lead.lastName}`}
                              onPointerDown={beginLeadTap}
                              onPointerMove={moveLeadTap}
                              onPointerUp={(event) =>
                                finishLeadTap(event, lead.id)}
                              onPointerCancel={cancelLeadTap}
                              onKeyDown={(event) =>
                                openLeadFromKeyboard(event, lead.id)}
                            >
                              <td>
                                <strong>
                                  {lead.firstName} {lead.lastName}
                                </strong>
                                <small>{lead.role}</small>
                              </td>
                              <td>
                                {company.name}
                                <small>{company.industry}</small>
                              </td>
                              <td>
                                <span class={`status ${lead.status}`}>
                                  {statusLabel(lead.status)}
                                </span>
                              </td>
                              <td>
                                <b class="score">{lead.fit}</b>
                              </td>
                              <td>
                                <div class="meter">
                                  <i style={{ width: `${lead.engagement}%` }} />
                                </div>
                                <small>{lead.engagement}%</small>
                              </td>
                              <td class="mobile-actions-cell">
                                <button
                                  type="button"
                                  class="record-open-button"
                                  aria-label={`Open details for ${lead.firstName} ${lead.lastName}`}
                                  aria-haspopup="dialog"
                                  onClick={(event) =>
                                    openLead(lead.id, event.currentTarget)}
                                >
                                  <span>Open</span>
                                  <ChevronRight size={15} />
                                </button>
                                <MobileLeadActions
                                  lead={lead}
                                  dispatch={dispatch}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {filteredLeads.length === 0 && (
                      <EmptyState
                        title="No leads match"
                        detail="Choose another status to restore the inbox."
                      />
                    )}
                  </div>
                </div>
                {selectedLead
                  ? (
                    <>
                      <button
                        type="button"
                        class="lead-detail-scrim"
                        aria-label="Close lead details"
                        onClick={closeLead}
                      />
                      <LeadPanel
                        lead={selectedLead}
                        game={game}
                        dispatch={dispatch}
                        onClose={closeLead}
                      />
                    </>
                  )
                  : (
                    <div class="panel detail-placeholder">
                      <Users size={28} />
                      <strong>Select a lead</strong>
                      <span>Open a record to review fit and take action.</span>
                    </div>
                  )}
              </div>
            </>
          )}

          {view.value === "contacts" && (
            <>
              <div class="page-heading">
                <div>
                  <span>Relationships</span>
                  <h1>Contacts</h1>
                  <p>Every person connected to your pipeline and customers.</p>
                </div>
              </div>
              <div
                class={`record-layout ${selectedLead ? "" : "single-panel"}`}
              >
                <div class="panel table-panel">
                  <div class="table-toolbar">
                    <strong>{leads.length} contacts</strong>
                    <span>All lifecycle stages</span>
                  </div>
                  <div class="table-scroll">
                    <table class="contacts-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Company</th>
                          <th>Email</th>
                          <th>Lifecycle</th>
                          <th>Last activity</th>
                          <th class="mobile-actions-heading">Open</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leads.map((lead) => (
                          <tr
                            tabIndex={0}
                            aria-label={`Open ${lead.firstName} ${lead.lastName}`}
                            onPointerDown={beginLeadTap}
                            onPointerMove={moveLeadTap}
                            onPointerUp={(event) =>
                              finishLeadTap(event, lead.id)}
                            onPointerCancel={cancelLeadTap}
                            onKeyDown={(event) =>
                              openLeadFromKeyboard(event, lead.id)}
                          >
                            <td>
                              <strong>{lead.firstName} {lead.lastName}</strong>
                              <small>{lead.role}</small>
                            </td>
                            <td>
                              {game.records.companies[lead.companyId].name}
                            </td>
                            <td>{lead.email}</td>
                            <td>
                              <span class={`status ${lead.status}`}>
                                {statusLabel(lead.status)}
                              </span>
                            </td>
                            <td>{gameDate(lead.lastActivityAt)}</td>
                            <td class="mobile-actions-cell">
                              <button
                                type="button"
                                class="record-open-button"
                                aria-label={`Open details for ${lead.firstName} ${lead.lastName}`}
                                aria-haspopup="dialog"
                                onClick={(event) =>
                                  openLead(lead.id, event.currentTarget)}
                              >
                                <span>Open</span>
                                <ChevronRight size={15} />
                              </button>
                              <MobileLeadActions
                                lead={lead}
                                dispatch={dispatch}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {selectedLead && (
                  <>
                    <button
                      type="button"
                      class="lead-detail-scrim"
                      aria-label="Close contact details"
                      onClick={closeLead}
                    />
                    <LeadPanel
                      lead={selectedLead}
                      game={game}
                      dispatch={dispatch}
                      onClose={closeLead}
                    />
                  </>
                )}
              </div>
            </>
          )}

          {view.value === "companies" && (
            <>
              <div class="page-heading">
                <div>
                  <span>Accounts</span>
                  <h1>Companies</h1>
                  <p>Organizations connected to leads, deals, and customers.</p>
                </div>
              </div>
              <div class="record-layout">
                <div class="panel table-panel">
                  <div class="table-toolbar">
                    <strong>{companies.length} companies</strong>
                    <span>{game.company.customerCount} customers</span>
                  </div>
                  <div class="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Company</th>
                          <th>Industry</th>
                          <th>Region</th>
                          <th>Employees</th>
                          <th>Relationship</th>
                        </tr>
                      </thead>
                      <tbody>
                        {companies.map((company) => {
                          const customer = Object.values(
                            game.records.customers,
                          ).find((entry) => entry.companyId === company.id);
                          return (
                            <tr
                              class={selectedCompany?.id === company.id
                                ? "selected"
                                : ""}
                              onClick={() =>
                                selectedCompanyId.value = company.id}
                            >
                              <td>
                                <strong>{company.name}</strong>
                              </td>
                              <td>{company.industry}</td>
                              <td>{company.region}</td>
                              <td>{company.employeeCount}</td>
                              <td>
                                <span
                                  class={`status ${customer ? "won" : "new"}`}
                                >
                                  {customer ? "Customer" : "Prospect"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                {selectedCompany
                  ? (
                    <CompanyPanel
                      companyId={selectedCompany.id}
                      game={game}
                    />
                  )
                  : (
                    <div class="panel detail-placeholder">
                      <Building2 size={30} />
                      <strong>Select a company</strong>
                      <span>
                        Open an account to review its commercial history.
                      </span>
                    </div>
                  )}
              </div>
            </>
          )}

          {view.value === "tasks" && (
            <>
              <div class="page-heading">
                <div>
                  <span>Execution</span>
                  <h1>Tasks</h1>
                  <p>Keep every promise and follow-up on schedule.</p>
                </div>
              </div>
              <div class="panel">
                <div class="table-toolbar">
                  <strong>{openTasks.length} open tasks</strong>
                  <span>Sorted by due time</span>
                </div>
                {openTasks.length === 0
                  ? (
                    <EmptyState
                      title="Nothing due"
                      detail="Your task queue is clear."
                    />
                  )
                  : (
                    <div class="task-list roomy">
                      {openTasks.sort((a, b) => a.dueAt - b.dueAt).map((
                        task,
                      ) => (
                        <TaskRow
                          task={task}
                          currentMinute={effectiveMinute}
                          onComplete={() =>
                            dispatch({
                              type: "complete_task",
                              taskId: task.id,
                            })}
                          onCancel={() =>
                            dispatch({
                              type: "cancel_task",
                              taskId: task.id,
                            })}
                        />
                      ))}
                    </div>
                  )}
              </div>
            </>
          )}

          {view.value === "marketing" && marketingUnlocked && (
            <>
              <div class="page-heading">
                <div>
                  <span>Demand generation</span>
                  <h1>Marketing</h1>
                  <p>Turn customer trust into qualified introductions.</p>
                </div>
              </div>
              <div class="campaign-summary" aria-label="Campaign performance">
                <div>
                  <span>Total spend</span>
                  <strong>{money.format(campaignSpendCents / 100)}</strong>
                </div>
                <div>
                  <span>Campaign leads</span>
                  <strong>{campaignLeads.length}</strong>
                </div>
                <div>
                  <span>Cost per lead</span>
                  <strong>
                    {campaignLeads.length > 0
                      ? money.format(
                        campaignSpendCents / campaignLeads.length / 100,
                      )
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>Conversion</span>
                  <strong>
                    {campaignLeads.length > 0
                      ? `${
                        Math.round(
                          campaignCustomers.length / campaignLeads.length * 100,
                        )
                      }%`
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>Open pipeline</span>
                  <strong>{money.format(openPipelineCents / 100)}</strong>
                </div>
                <div>
                  <span>Attributed MRR</span>
                  <strong>{money.format(attributedMrrCents / 100)}</strong>
                </div>
              </div>
              <div class="marketing-layout">
                <section class="panel campaign-builder">
                  <div class="panel-heading">
                    <div>
                      <h2>
                        {editingCampaignId.value
                          ? "Edit campaign"
                          : "New campaign"}
                      </h2>
                      <span>
                        {editingCampaignId.value
                          ? "Update a paused campaign before resuming delivery"
                          : "Configure a bounded acquisition program"}
                      </span>
                    </div>
                  </div>
                  <form onSubmit={submitCampaign}>
                    <label>
                      <span>Campaign name</span>
                      <input
                        value={campaignName.value}
                        minLength={2}
                        maxLength={60}
                        required
                        onInput={(event) =>
                          campaignName.value = event.currentTarget.value}
                      />
                    </label>
                    <div class="form-row">
                      <label>
                        <span>Channel</span>
                        <select
                          value={campaignChannel.value}
                          onChange={(event) =>
                            campaignChannel.value = event.currentTarget
                              .value as CampaignChannel}
                        >
                          <option value="email">Email</option>
                          <option value="paid_social">Paid social</option>
                          <option value="events">Events</option>
                        </select>
                      </label>
                      <label>
                        <span>Audience</span>
                        <select
                          value={campaignAudience.value}
                          onChange={(event) =>
                            campaignAudience.value = event.currentTarget
                              .value as CampaignAudience}
                        >
                          <option value="small_business">Small business</option>
                          <option value="mid_market">Mid-market</option>
                          <option value="enterprise">Enterprise</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      <span>Objective / hypothesis</span>
                      <select
                        value={campaignObjective.value}
                        onChange={(event) =>
                          campaignObjective.value = event.currentTarget
                            .value as CampaignObjective}
                      >
                        <option value="balanced">
                          Balanced — neutral benchmark
                        </option>
                        <option value="reach">
                          Reach — more leads, lower fit, higher spend
                        </option>
                        <option value="quality">
                          Quality — fewer leads, stronger fit, higher spend
                        </option>
                        <option value="efficiency">
                          Efficiency — lower spend, slower lead flow
                        </option>
                      </select>
                      <small>
                        Persist this hypothesis so completed results can guide
                        the next iteration.
                      </small>
                    </label>
                    <div class="form-row">
                      <label>
                        <span>Daily budget</span>
                        <input
                          type="number"
                          min="10"
                          max="1000"
                          step="10"
                          value={campaignBudget.value}
                          required
                          onInput={(event) =>
                            campaignBudget.value = event.currentTarget.value}
                        />
                      </label>
                      <label>
                        <span>Duration</span>
                        <select
                          value={campaignDuration.value}
                          onChange={(event) =>
                            campaignDuration.value = event.currentTarget.value}
                        >
                          <option value="3">3 days</option>
                          <option value="7">7 days</option>
                          <option value="14">14 days</option>
                          <option value="30">30 days</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      <span>Message</span>
                      <textarea
                        value={campaignMessage.value}
                        minLength={10}
                        maxLength={200}
                        required
                        onInput={(event) =>
                          campaignMessage.value = event.currentTarget.value}
                      />
                    </label>
                    <button
                      type="submit"
                      class="primary"
                      disabled={game.clock.status !== "active" ||
                        campaigns.filter((campaign) =>
                            campaign.status === "active"
                          ).length >= DEFAULT_RULES.maxActiveCampaigns}
                    >
                      {editingCampaignId.value
                        ? <Pencil size={17} />
                        : <BarChart3 size={17} />}
                      {editingCampaignId.value
                        ? "Save campaign"
                        : "Launch campaign"}
                    </button>
                    {editingCampaignId.value && (
                      <button
                        type="button"
                        class="text-button"
                        onClick={resetCampaignForm}
                      >
                        Cancel editing
                      </button>
                    )}
                  </form>
                </section>
                <section class="panel acquisition-tool">
                  <div class="acquisition-icon">
                    <Users size={24} />
                  </div>
                  <div>
                    <span>Available channel</span>
                    <h2>Customer referral motion</h2>
                    <p>
                      Spend 60 minutes asking current customers for a warm
                      introduction. Referral leads arrive with stronger fit and
                      intent than typical inbound demand.
                    </p>
                  </div>
                  <dl>
                    <div>
                      <dt>Capacity cost</dt>
                      <dd>60m</dd>
                    </div>
                    <div>
                      <dt>Referrals sourced</dt>
                      <dd>{referralLeads.length}</dd>
                    </div>
                    <div>
                      <dt>Capacity available</dt>
                      <dd>{game.company.founderCapacityRemaining}m</dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    class="primary"
                    disabled={referralBlockedReason !== undefined}
                    onClick={() => dispatch({ type: "request_referrals" })}
                  >
                    <Users size={17} />Request introductions
                  </button>
                  {referralBlockedReason && (
                    <p class="blocked-reason">
                      <LockKeyhole size={15} />
                      {referralBlockedReason}
                    </p>
                  )}
                </section>
                <section class="panel campaign-list-panel">
                  <div class="panel-heading">
                    <div>
                      <h2>Campaigns</h2>
                      <span>Spend, attributed demand, and delivery status</span>
                    </div>
                  </div>
                  {campaigns.length === 0
                    ? (
                      <EmptyState
                        title="No campaigns yet"
                        detail="Launch a campaign to create a repeatable source of demand."
                      />
                    )
                    : (
                      <div class="campaign-list">
                        {campaigns.map((campaign) => (
                          <div>
                            <span>
                              <strong>{campaign.name}</strong>
                              <small>
                                {statusLabel(campaign.channel)} ·{" "}
                                {statusLabel(campaign.audience)} ·{" "}
                                {statusLabel(campaign.objective)}
                              </small>
                            </span>
                            <dl>
                              <div>
                                <dt>Spend</dt>
                                <dd>
                                  {money.format(campaign.totalSpentCents / 100)}
                                </dd>
                              </div>
                              <div>
                                <dt>Leads</dt>
                                <dd>{campaign.leadsGenerated}</dd>
                              </div>
                              <div>
                                <dt>Saturation</dt>
                                <dd>
                                  {campaignSaturation(campaign.leadsGenerated)}%
                                </dd>
                              </div>
                            </dl>
                            <span class={`status ${campaign.status}`}>
                              {statusLabel(campaign.status)}
                            </span>
                            <div class="campaign-actions">
                              {campaign.status !== "completed" && (
                                <button
                                  type="button"
                                  class="secondary"
                                  onClick={() =>
                                    dispatch({
                                      type: "set_campaign_status",
                                      campaignId: campaign.id,
                                      status: campaign.status === "active"
                                        ? "paused"
                                        : "active",
                                    })}
                                >
                                  {campaign.status === "active"
                                    ? "Pause"
                                    : "Resume"}
                                </button>
                              )}
                              {campaign.status === "paused" && (
                                <button
                                  type="button"
                                  class="icon-button"
                                  aria-label={`Edit ${campaign.name}`}
                                  title="Edit campaign"
                                  onClick={() => editCampaign(campaign.id)}
                                >
                                  <Pencil size={16} />
                                </button>
                              )}
                              <button
                                type="button"
                                class="secondary"
                                aria-label={`Iterate on ${campaign.name}`}
                                title="Duplicate and edit as a new iteration"
                                onClick={() => iterateCampaign(campaign.id)}
                              >
                                <Copy size={16} /> Iterate
                              </button>
                              {campaign.status !== "active" && (
                                <button
                                  type="button"
                                  class="icon-button"
                                  aria-label={`Archive ${campaign.name}`}
                                  title="Archive campaign"
                                  onClick={() =>
                                    dispatch({
                                      type: "archive_campaign",
                                      campaignId: campaign.id,
                                    })}
                                >
                                  <Archive size={16} />
                                </button>
                              )}
                            </div>
                            {(campaign.status === "completed" ||
                              campaign.status === "archived") &&
                              (() => {
                                const outcome = campaignOutcomeSummary(
                                  game,
                                  campaign,
                                );
                                return (
                                  <div class="campaign-outcome">
                                    <strong>Outcome summary</strong>
                                    <span>
                                      {outcome.deals} deals ·{" "}
                                      {outcome.customers} customers ·{" "}
                                      {money.format(
                                        outcome.openPipelineCents / 100,
                                      )} open pipeline ·{" "}
                                      {money.format(outcome.wonMrrCents / 100)}
                                      {" "}
                                      MRR
                                    </span>
                                    <span>
                                      CPL {outcome.costPerLeadCents === null
                                        ? "—"
                                        : money.format(
                                          outcome.costPerLeadCents / 100,
                                        )} · CAC {outcome
                                          .customerAcquisitionCostCents === null
                                        ? "—"
                                        : money.format(
                                          outcome
                                            .customerAcquisitionCostCents /
                                            100,
                                        )}
                                    </span>
                                  </div>
                                );
                              })()}
                          </div>
                        ))}
                      </div>
                    )}
                </section>
                <section class="panel campaign-report-panel">
                  <div class="panel-heading">
                    <div>
                      <h2>Channel performance</h2>
                      <span>Single-touch revenue attribution</span>
                    </div>
                  </div>
                  <div class="table-scroll">
                    <table class="channel-report">
                      <thead>
                        <tr>
                          <th>Channel</th>
                          <th>Spend</th>
                          <th>Leads</th>
                          <th>Customers</th>
                          <th>CAC</th>
                          <th>MRR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {channelReports.map((report) => (
                          <tr>
                            <td>
                              <strong>{statusLabel(report.channel)}</strong>
                            </td>
                            <td>{money.format(report.spendCents / 100)}</td>
                            <td>{report.leads}</td>
                            <td>{report.customers}</td>
                            <td>
                              {report.customers > 0
                                ? money.format(
                                  report.spendCents / report.customers / 100,
                                )
                                : "—"}
                            </td>
                            <td>{money.format(report.mrrCents / 100)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section class="panel">
                  <div class="panel-heading">
                    <div>
                      <h2>Referral leads</h2>
                      <span>Warm introductions generated by customers</span>
                    </div>
                  </div>
                  {referralLeads.length === 0
                    ? (
                      <EmptyState
                        title="No referrals yet"
                        detail="Request introductions to add the first warm lead."
                      />
                    )
                    : (
                      <div class="referral-list">
                        {referralLeads.slice(0, 6).map((lead) => (
                          <button
                            type="button"
                            onClick={(event) =>
                              openSearchResult(lead.id, event.currentTarget)}
                          >
                            <span>
                              <strong>{lead.firstName} {lead.lastName}</strong>
                              <small>
                                {game.records.companies[lead.companyId].name}
                              </small>
                            </span>
                            <b>{lead.fit} fit</b>
                            <ChevronRight size={16} />
                          </button>
                        ))}
                      </div>
                    )}
                </section>
              </div>
            </>
          )}

          {view.value === "customers" && customerSuccessUnlocked && (
            <CustomerSuccessWorkspace
              game={game}
              currentMinute={effectiveMinute}
              dispatch={dispatch}
            />
          )}

          {view.value === "pipeline" && pipelineUnlocked && (
            <PipelineWorkspace
              game={game}
              currentMinute={effectiveMinute}
              mode={game.preferences.pipelineView}
              onModeChange={(view) =>
                dispatch({ type: "set_pipeline_view", view })}
              dispatch={dispatch}
            />
          )}

          {(view.value === "automation" || view.value === "analytics") &&
            automationUnlocked && (
            <PlatformWorkspace
              game={game}
              mode={view.value}
              dispatch={dispatch}
            />
          )}
          {view.value === "operations" && operationsUnlocked && (
            <PlatformWorkspace
              game={game}
              mode="operations"
              dispatch={dispatch}
            />
          )}

          {view.value === "settings" && (
            <>
              <div class="page-heading">
                <div>
                  <span>Workspace</span>
                  <h1>Settings</h1>
                  <p>Manage this browser's company save.</p>
                </div>
              </div>
              <div class="settings-grid">
                <div class="panel settings-panel palette-panel">
                  <h2>Color palette</h2>
                  <p>Choose the workspace colors used throughout the CRM.</p>
                  <div
                    class="palette-options"
                    role="radiogroup"
                    aria-label="Color palette"
                  >
                    {([
                      ["ruby", "Ruby"],
                      ["citrine", "Citrine"],
                      ["emerald", "Emerald"],
                      ["sapphire", "Sapphire"],
                      ["amethyst", "Amethyst"],
                      ["pearl", "Pearl"],
                      ["moonstone", "Moonstone"],
                      ["onyx", "Onyx"],
                      ["obsidian", "Obsidian"],
                    ] as Array<[ColorPalette, string]>).map(([
                      palette,
                      label,
                    ]) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={game.preferences.palette === palette}
                        class={game.preferences.palette === palette
                          ? "active"
                          : ""}
                        onClick={() =>
                          dispatch({ type: "set_palette", palette })}
                      >
                        <span class={`palette-swatch ${palette}`}>
                          <i />
                          <i />
                          <i />
                        </span>
                        <strong>{label}</strong>
                      </button>
                    ))}
                  </div>
                </div>
                <div class="panel settings-panel appearance-panel">
                  <h2>Appearance</h2>
                  <p>
                    Adjust workspace brightness independently of your color
                    palette.
                  </p>
                  <label class="toggle-row">
                    <span>
                      <strong>Dark mode</strong>
                      <small>
                        Use lower-glare surfaces throughout the CRM.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={game.preferences.darkMode}
                      onChange={(event) =>
                        dispatch({
                          type: "set_dark_mode",
                          enabled: event.currentTarget.checked,
                        })}
                    />
                  </label>
                </div>
                <div class="panel settings-panel identity-panel">
                  <h2>Workspace identity</h2>
                  <p>
                    Choose the company name shown throughout your CRM and
                    reports.
                  </p>
                  <form class="identity-form" onSubmit={renameCompany}>
                    <label for="company-name">Company name</label>
                    <div>
                      <input
                        id="company-name"
                        name="companyName"
                        value={companyName.value}
                        minLength={2}
                        maxLength={60}
                        required
                        aria-invalid={companyNameError !== undefined}
                        aria-describedby={companyNameError
                          ? "company-name-error"
                          : undefined}
                        onInput={(event) =>
                          companyName.value = event.currentTarget.value}
                      />
                      <button
                        type="submit"
                        class="primary"
                        disabled={companyNameError !== undefined ||
                          normalizedCompanyName === game.company.name}
                      >
                        Save name
                      </button>
                    </div>
                    {companyNameError && (
                      <small id="company-name-error" class="field-error">
                        {companyNameError}
                      </small>
                    )}
                  </form>
                </div>
                <div class="panel settings-panel preference-panel">
                  <h2>Accessibility</h2>
                  <p>
                    Tune workspace behavior for a more comfortable operating
                    experience.
                  </p>
                  <label class="toggle-row">
                    <span>
                      <strong>Reduce motion</strong>
                      <small>
                        Disable transitions and animated status indicators.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={game.preferences.reducedMotion}
                      onChange={(event) =>
                        dispatch({
                          type: "set_reduced_motion",
                          enabled: event.currentTarget.checked,
                        })}
                    />
                  </label>
                </div>
                <div class="panel settings-panel sound-panel">
                  <h2>Sound</h2>
                  <p>
                    Optional audio stays local to this browser and can be
                    changed independently.
                  </p>
                  <label class="toggle-row">
                    <span>
                      <strong>
                        <Volume2 size={17} />Notification pings
                      </strong>
                      <small>
                        Hear important arrivals, wins, and warnings.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={game.preferences.soundEnabled}
                      onChange={(event) => {
                        const enabled = event.currentTarget.checked;
                        if (enabled) {
                          void soundDesign.current?.ping("neutral");
                        }
                        dispatch({ type: "set_sound_enabled", enabled });
                      }}
                    />
                  </label>
                  <label class="toggle-row">
                    <span>
                      <strong>
                        <Music2 size={17} />Lounge music
                      </strong>
                      <small>Play a procedural jazz focus mix.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={game.preferences.musicEnabled}
                      onChange={(event) => {
                        const enabled = event.currentTarget.checked;
                        void soundDesign.current?.setMusic(enabled);
                        dispatch({ type: "set_music_enabled", enabled });
                      }}
                    />
                  </label>
                  <label class="sound-volume">
                    <span>
                      <strong>Music volume</strong>
                      <output for="music-volume">
                        {game.preferences.musicVolume}%
                      </output>
                    </span>
                    <input
                      id="music-volume"
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={game.preferences.musicVolume}
                      onInput={(event) => {
                        const volume = Number(event.currentTarget.value);
                        soundDesign.current?.setMusicVolume(volume);
                        dispatch({ type: "set_music_volume", volume });
                      }}
                    />
                  </label>
                </div>
                <div class="panel settings-panel">
                  <h2>Data portability</h2>
                  <p>
                    Live progress is stored only in signed browser cookies.
                    Export a backup before clearing browser data.
                  </p>
                  <div class="settings-actions">
                    <button
                      type="button"
                      class="secondary"
                      disabled={store.operationStatus.value !== "idle"}
                      onClick={() =>
                        void store.exportSave().catch((error) =>
                          store.notice.value = error.message
                        )}
                    >
                      {store.operationStatus.value === "exporting"
                        ? <RefreshCw class="spin" size={16} />
                        : <Download size={16} />}
                      {store.operationStatus.value === "exporting"
                        ? "Exporting..."
                        : "Export company"}
                    </button>
                    <label
                      class={`secondary file-button ${
                        store.operationStatus.value !== "idle" ? "disabled" : ""
                      }`}
                    >
                      {store.operationStatus.value === "importing"
                        ? <RefreshCw class="spin" size={16} />
                        : <Upload size={16} />}
                      {store.operationStatus.value === "importing"
                        ? "Importing..."
                        : "Import company"}
                      <input
                        type="file"
                        accept="application/json"
                        disabled={store.operationStatus.value !== "idle"}
                        onChange={(event) => void importFile(event)}
                      />
                    </label>
                  </div>
                </div>
                <div class="panel settings-panel danger">
                  <h2>Start over</h2>
                  <p>
                    Delete this company's cookie save and return to a new
                    founder inbox.
                  </p>
                  <button
                    type="button"
                    class="danger-button"
                    onClick={() => confirmReset.value = true}
                  >
                    Reset company
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      {store.notice.value && (
        <div class="toast">
          <span>{store.notice.value}</span>
          <button
            type="button"
            onClick={() => store.notice.value = undefined}
            aria-label="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {game.narrative.chapter > 0 && game.narrative.pendingBriefing &&
        !showOffline.value &&
        !showCorrupt.value && game.clock.status !== "bankrupt" && (
        <Modal
          title={NARRATIVE_CHAPTERS[game.narrative.chapter].title}
          onClose={() => dispatch({ type: "acknowledge_narrative" })}
        >
          <span class="story-eyebrow">
            {NARRATIVE_CHAPTERS[game.narrative.chapter].eyebrow}
          </span>
          <p class="story-copy">
            {NARRATIVE_CHAPTERS[game.narrative.chapter].briefing}
          </p>
          <div class="story-directive">
            <Target size={18} />
            <span>
              <strong>Current directive</strong>
              {NARRATIVE_CHAPTERS[game.narrative.chapter].directive}
            </span>
          </div>
          <button
            type="button"
            class="primary full"
            onClick={() => {
              dispatch({ type: "acknowledge_narrative" });
              view.value = "campaign";
            }}
          >
            {game.narrative.chapter === NARRATIVE_CHAPTERS.length - 1
              ? "Continue in endless mode"
              : "Begin chapter"}
          </button>
        </Modal>
      )}

      {showOffline.value && (
        <Modal
          title={props.loadStatus === "crisis"
            ? "Company needs attention"
            : "While you were away"}
          onClose={() => showOffline.value = false}
        >
          <div class="summary-grid">
            <div>
              <span>Time processed</span>
              <strong>{props.offlineSummary?.elapsedGameMinutes ?? 0}m</strong>
            </div>
            <div>
              <span>New leads</span>
              <strong>{props.offlineSummary?.leadsCreated ?? 0}</strong>
            </div>
            <div>
              <span>Revenue</span>
              <strong>
                {money.format(
                  (props.offlineSummary?.revenueAccruedCents ?? 0) / 100,
                )}
              </strong>
            </div>
            <div>
              <span>Costs</span>
              <strong>
                {money.format(
                  (props.offlineSummary?.expensesAccruedCents ?? 0) / 100,
                )}
              </strong>
            </div>
          </div>
          {props.loadStatus === "crisis" && (
            <div class="crisis-note">
              Offline progress stopped before operating costs could bankrupt the
              company. Review cash and resume only when ready.
            </div>
          )}
          <button
            type="button"
            class="primary full"
            onClick={() => {
              if (game.clock.status === "crisis") {
                dispatch({ type: "resume_crisis" });
              }
              showOffline.value = false;
            }}
          >
            {game.clock.status === "crisis"
              ? "Resume company"
              : "Review dashboard"}
          </button>
        </Modal>
      )}

      {showCorrupt.value && (
        <Modal title="Save could not be loaded" onClose={() => {}}>
          <p class="modal-copy">
            The signed cookie save is incomplete or invalid. It has not been
            overwritten.
          </p>
          <code class="error-code">{props.loadError}</code>
          <div class="modal-actions">
            <label class="secondary file-button">
              <Upload size={16} />Import backup<input
                type="file"
                accept="application/json"
                onChange={(event) =>
                  void importFile(event).then(() =>
                    showCorrupt.value = false
                  )}
              />
            </label>
            <button
              type="button"
              class="danger-button"
              onClick={() => confirmReset.value = true}
            >
              Reset save
            </button>
          </div>
        </Modal>
      )}

      {game.clock.status === "bankrupt" && (
        <Modal title="Company closed" onClose={() => {}}>
          <p class="modal-copy">
            {game.company.name} exhausted its operating cash on{" "}
            {gameDate(game.clock.bankruptAt ?? game.clock.gameMinute)}.
          </p>
          <div class="summary-grid">
            <div>
              <span>Peak MRR</span>
              <strong>{money.format(game.company.peakMrrCents / 100)}</strong>
            </div>
            <div>
              <span>Customers won</span>
              <strong>{game.history.dealsWon}</strong>
            </div>
            <div>
              <span>Leads created</span>
              <strong>{game.history.leadsCreated}</strong>
            </div>
            <div>
              <span>Company age</span>
              <strong>{Math.floor(game.clock.gameMinute / (24 * 60))}d</strong>
            </div>
          </div>
          <button
            type="button"
            class="primary full"
            onClick={() =>
              confirmReset.value = true}
          >
            Start a new company
          </button>
        </Modal>
      )}

      {confirmReset.value && (
        <Modal
          title="Reset this company?"
          onClose={() => confirmReset.value = false}
        >
          <p class="modal-copy">
            This permanently clears the current cookie save. Export first if you
            want a backup.
          </p>
          <div class="modal-actions">
            <button
              type="button"
              class="secondary"
              onClick={() => confirmReset.value = false}
            >
              Cancel
            </button>
            <button
              type="button"
              class="danger-button"
              disabled={store.operationStatus.value === "resetting"}
              onClick={() =>
                void store.reset().then(() => {
                  globalThis.location.assign("/");
                })}
            >
              {store.operationStatus.value === "resetting"
                ? "Resetting..."
                : "Reset company"}
            </button>
          </div>
        </Modal>
      )}

      {confirmSkipTutorial.value && (
        <Modal
          title="Skip guided Chapter 1?"
          onClose={() => confirmSkipTutorial.value = false}
        >
          <p class="modal-copy">
            This removes tutorial guidance and opens the core CRM workspaces.
            Marketing, Pipeline, and later modules will still require their
            normal business milestones.
          </p>
          <div class="modal-actions">
            <button
              type="button"
              class="secondary"
              onClick={() => confirmSkipTutorial.value = false}
            >
              Keep guidance
            </button>
            <button
              type="button"
              class="primary"
              onClick={() => {
                if (dispatch({ type: "skip_onboarding" })) {
                  confirmSkipTutorial.value = false;
                }
              }}
            >
              Skip tutorial
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TaskRow(
  props: {
    task: Task;
    currentMinute: number;
    onComplete: () => void;
    onCancel: () => void;
  },
) {
  const overdue = props.task.dueAt < props.currentMinute;
  return (
    <div class="task-row">
      <button
        type="button"
        class="task-check"
        onClick={props.onComplete}
        aria-label={`Complete ${props.task.title}`}
      >
        <Check size={14} />
      </button>
      <div>
        <strong>{props.task.title}</strong>
        <span>{statusLabel(props.task.kind)}</span>
      </div>
      <time class={overdue ? "overdue" : ""}>
        {relativeGameTime(props.task.dueAt, props.currentMinute)}
      </time>
      {props.task.kind === "onboarding" ? <span /> : (
        <button
          type="button"
          class="icon-button task-cancel"
          aria-label={`Cancel ${props.task.title}`}
          title="Cancel task"
          onClick={props.onCancel}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

function LeadPanel(
  props: {
    lead: Lead;
    game: GameState;
    dispatch: (command: GameCommand) => void;
    onClose: () => void;
  },
) {
  const company = props.game.records.companies[props.lead.companyId];
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = `lead-detail-title-${props.lead.id}`;
  const deal = Object.values(props.game.records.deals).find((entry) =>
    entry.leadId === props.lead.id
  );
  const dealClosed = deal?.stage === "won" || deal?.stage === "lost";
  useEffect(() => {
    closeButton.current?.focus();
  }, [props.lead.id]);
  return (
    <aside
      class="panel record-detail lead-detail"
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        props.onClose();
      }}
    >
      <div class="detail-heading">
        <div class="contact-avatar">
          {props.lead.firstName[0]}
          {props.lead.lastName[0]}
        </div>
        <div>
          <span>{statusLabel(props.lead.status)}</span>
          <h2 id={titleId}>{props.lead.firstName} {props.lead.lastName}</h2>
          <p>{props.lead.role} at {company.name}</p>
        </div>
        <button
          type="button"
          class="icon-button"
          ref={closeButton}
          onClick={props.onClose}
          aria-label={`Close details for ${props.lead.firstName} ${props.lead.lastName}`}
        >
          <X size={17} />
        </button>
      </div>
      <div class="quick-actions">
        <button
          type="button"
          onClick={() =>
            props.dispatch({
              type: "contact_lead",
              leadId: props.lead.id,
              channel: "email",
            })}
        >
          <Mail size={16} />
          <span>Email</span>
        </button>
        <button
          type="button"
          onClick={() =>
            props.dispatch({
              type: "contact_lead",
              leadId: props.lead.id,
              channel: "call",
            })}
        >
          <Phone size={16} />
          <span>Call</span>
        </button>
        <button
          type="button"
          onClick={() =>
            props.dispatch({ type: "follow_up_lead", leadId: props.lead.id })}
        >
          <RefreshCw size={16} />
          <span>Follow up</span>
        </button>
      </div>
      <div class="record-section">
        <h3>Qualification</h3>
        <dl>
          <div>
            <dt>Fit score</dt>
            <dd>{props.lead.fit}/100</dd>
          </div>
          <div>
            <dt>Intent</dt>
            <dd>{props.lead.engagement}%</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{statusLabel(props.lead.source)}</dd>
          </div>
          <div>
            <dt>Company size</dt>
            <dd>{company.employeeCount} people</dd>
          </div>
          <div>
            <dt>Region</dt>
            <dd>{company.region}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{props.lead.email}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>
              <select
                aria-label={`Owner for ${props.lead.firstName} ${props.lead.lastName}`}
                value={props.lead.ownerId ?? ""}
                disabled={dealClosed}
                title={dealClosed
                  ? "Closed deals cannot be reassigned"
                  : undefined}
                onChange={(event) => {
                  const ownerId = event.currentTarget.value || undefined;
                  props.dispatch(
                    deal
                      ? {
                        type: "assign_deal",
                        dealId: deal.id,
                        ownerId,
                      }
                      : {
                        type: "assign_lead",
                        leadId: props.lead.id,
                        ownerId,
                      },
                  );
                }}
              >
                <option value="">Founder</option>
                {Object.values(props.game.records.salesReps).map((rep) => (
                  <option value={rep.id}>{rep.name}</option>
                ))}
              </select>
            </dd>
          </div>
        </dl>
      </div>
      {deal
        ? (
          <DealCard
            deal={deal}
            intent={props.lead.engagement}
            capacity={props.game.company.founderCapacityRemaining}
            cashCents={props.game.company.cashCents}
            dispatch={props.dispatch}
          />
        )
        : (
          <div class="record-footer">
            <button
              type="button"
              class="secondary"
              onClick={() =>
                props.dispatch({
                  type: "disqualify_lead",
                  leadId: props.lead.id,
                })}
            >
              Disqualify
            </button>
            <button
              type="button"
              class="primary"
              disabled={props.lead.status !== "contacted"}
              onClick={() =>
                props.dispatch({ type: "qualify_lead", leadId: props.lead.id })}
            >
              Qualify lead
            </button>
          </div>
        )}
    </aside>
  );
}

function DealCard(
  props: {
    deal: Deal;
    intent: number;
    capacity: number;
    cashCents: number;
    dispatch: (command: GameCommand) => void;
  },
) {
  const closed = props.deal.stage === "won" || props.deal.stage === "lost";
  const closeRisk = props.deal.stage === "negotiation"
    ? closeLossRiskPercent(props.intent)
    : 0;
  return (
    <div class="deal-card">
      <div>
        <span>Open deal</span>
        <strong>{money.format(props.deal.monthlyValueCents / 100)} MRR</strong>
      </div>
      <div class="deal-progress">
        <i style={{ width: `${props.deal.probability}%` }} />
      </div>
      <div class="deal-meta">
        <span>{statusLabel(props.deal.stage)}</span>
        <b>{props.deal.probability}%</b>
      </div>
      {!closed && (
        <>
          {closeRisk > 0 && (
            <p class="close-risk">
              Closing now has a {closeRisk}% chance of losing this client.
            </p>
          )}
          {props.deal.stage === "negotiation"
            ? (
              <DealNegotiationControls
                dealId={props.deal.id}
                capacity={props.capacity}
                cashCents={props.cashCents}
                dispatch={props.dispatch}
              />
            )
            : (
              <button
                type="button"
                class="primary full"
                onClick={() =>
                  props.dispatch({
                    type: "advance_deal",
                    dealId: props.deal.id,
                  })}
              >
                Advance deal <ChevronRight size={15} />
              </button>
            )}
        </>
      )}
    </div>
  );
}

function CompanyPanel(
  props: { companyId: string; game: GameState },
) {
  const company = props.game.records.companies[props.companyId];
  const leads = Object.values(props.game.records.leads).filter((lead) =>
    lead.companyId === company.id
  );
  const deals = Object.values(props.game.records.deals).filter((deal) =>
    deal.companyId === company.id
  );
  const customer = Object.values(props.game.records.customers).find((entry) =>
    entry.companyId === company.id
  );
  const pipelineCents = deals.filter((deal) => deal.stage !== "lost").reduce(
    (total, deal) => total + deal.monthlyValueCents,
    0,
  );

  return (
    <aside class="panel record-detail">
      <div class="detail-heading company-heading">
        <div class="contact-avatar">
          <Building2 size={21} />
        </div>
        <div>
          <span>{customer ? "Customer account" : "Prospect account"}</span>
          <h2>{company.name}</h2>
          <p>{company.industry} · {company.region}</p>
        </div>
      </div>
      <div class="record-section">
        <h3>Account overview</h3>
        <dl>
          <div>
            <dt>Employees</dt>
            <dd>{company.employeeCount}</dd>
          </div>
          <div>
            <dt>Contacts</dt>
            <dd>{leads.length}</dd>
          </div>
          <div>
            <dt>Deals</dt>
            <dd>{deals.length}</dd>
          </div>
          <div>
            <dt>Pipeline MRR</dt>
            <dd>{money.format(pipelineCents / 100)}</dd>
          </div>
          <div>
            <dt>Customer MRR</dt>
            <dd>{money.format((customer?.monthlyValueCents ?? 0) / 100)}</dd>
          </div>
          <div>
            <dt>Added</dt>
            <dd>{gameDate(company.createdAt)}</dd>
          </div>
        </dl>
      </div>
      <div class="related-records">
        <h3>People</h3>
        {leads.map((lead) => (
          <div>
            <span>{lead.firstName} {lead.lastName}</span>
            <small>{lead.role}</small>
          </div>
        ))}
      </div>
    </aside>
  );
}

function Modal(
  props: {
    title: string;
    children: preact.ComponentChildren;
    onClose: () => void;
  },
) {
  return (
    <div class="modal-backdrop" role="presentation">
      <section
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
      >
        <div class="modal-heading">
          <h2>{props.title}</h2>
          <button
            type="button"
            class="icon-button"
            onClick={props.onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        {props.children}
      </section>
    </div>
  );
}
