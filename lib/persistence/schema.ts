import { validateGameState } from "../game/state.ts";
import {
  CONTENT_VERSION,
  type GameState,
  SAVE_SCHEMA_VERSION,
  type ValidationIssue,
} from "../game/types.ts";

const MAX_RECORDS = 2_000;
const MAX_STRING_LENGTH = 500;
const CLOCK_STATUSES = new Set(["active", "crisis", "bankrupt"]);
const LEAD_STATUSES = new Set([
  "new",
  "contacted",
  "qualified",
  "disqualified",
  "converted",
  "cold",
]);
const DEAL_STAGES = new Set([
  "qualified",
  "discovery",
  "evaluation",
  "negotiation",
  "won",
  "lost",
]);
const DEAL_PRODUCTS = new Set(["starter", "growth", "scale"]);
const DEAL_LOSS_REASONS = new Set([
  "budget",
  "timing",
  "competition",
  "no_decision",
  "poor_fit",
]);
const SALES_REP_LEVELS = new Set(["junior", "mid", "senior"]);
const SALES_TERRITORIES = new Set([
  "all",
  "North America",
  "Europe",
  "Asia Pacific",
]);
const BILLING_CYCLES = new Set(["monthly", "annual"]);
const QUOTE_STATUSES = new Set(["draft", "sent", "accepted", "expired"]);
const TASK_KINDS = new Set(["call", "email", "follow_up", "onboarding"]);
const TASK_STATUSES = new Set(["open", "completed", "cancelled"]);
const CAMPAIGN_CHANNELS = new Set(["email", "paid_social", "events"]);
const CAMPAIGN_AUDIENCES = new Set([
  "small_business",
  "mid_market",
  "enterprise",
]);
const CAMPAIGN_STATUSES = new Set([
  "active",
  "paused",
  "completed",
  "archived",
]);
const UNLOCKS = new Set(["marketing", "pipeline", "customer_success"]);

export class SaveValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(issues.map((entry) => `${entry.path}: ${entry.message}`).join("; "));
    this.name = "SaveValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null);
}

function isInteger(value: unknown, minimum = 0): value is number {
  return Number.isInteger(value) && Number(value) >= minimum;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_STRING_LENGTH;
}

function hasStrings(record: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => isString(record[key]));
}

function validEntityMap(
  value: unknown,
  validate: (entry: Record<string, unknown>) => boolean,
): boolean {
  if (!isRecord(value) || Object.keys(value).length > MAX_RECORDS) return false;
  return Object.values(value).every((entry) =>
    isRecord(entry) && validate(entry)
  );
}

function validCompany(entry: Record<string, unknown>): boolean {
  return hasStrings(entry, ["id", "name", "industry", "region"]) &&
    isInteger(entry.employeeCount) && isInteger(entry.createdAt);
}

function validLead(entry: Record<string, unknown>): boolean {
  return hasStrings(entry, [
    "id",
    "companyId",
    "firstName",
    "lastName",
    "email",
    "role",
    "source",
    "status",
  ]) && ["organic", "referral", "campaign"].includes(String(entry.source)) &&
    LEAD_STATUSES.has(String(entry.status)) && isInteger(entry.fit) &&
    isInteger(entry.engagement) && isInteger(entry.createdAt) &&
    isInteger(entry.lastActivityAt) &&
    (entry.campaignId === undefined || isString(entry.campaignId)) &&
    (entry.ownerId === undefined || isString(entry.ownerId));
}

function validCampaign(entry: Record<string, unknown>): boolean {
  return hasStrings(entry, [
    "id",
    "name",
    "channel",
    "audience",
    "status",
    "message",
  ]) && CAMPAIGN_CHANNELS.has(String(entry.channel)) &&
    CAMPAIGN_AUDIENCES.has(String(entry.audience)) &&
    CAMPAIGN_STATUSES.has(String(entry.status)) &&
    isInteger(entry.dailyBudgetCents, 1) && isInteger(entry.createdAt) &&
    isInteger(entry.endsAt, 1) && isInteger(entry.totalSpentCents) &&
    isInteger(entry.leadsGenerated);
}

function validDeal(entry: Record<string, unknown>): boolean {
  return hasStrings(entry, ["id", "leadId", "companyId", "stage", "product"]) &&
    DEAL_STAGES.has(String(entry.stage)) &&
    DEAL_PRODUCTS.has(String(entry.product)) &&
    (entry.lossReason === undefined ||
      DEAL_LOSS_REASONS.has(String(entry.lossReason))) &&
    (entry.stage === "lost" || entry.lossReason === undefined) &&
    (entry.ownerId === undefined || isString(entry.ownerId)) &&
    isInteger(entry.monthlyValueCents) &&
    isInteger(entry.probability) && isInteger(entry.expectedCloseAt) &&
    isInteger(entry.createdAt) && isInteger(entry.updatedAt);
}

function validSalesRep(entry: Record<string, unknown>): boolean {
  return hasStrings(entry, ["id", "name", "level", "territory"]) &&
    SALES_REP_LEVELS.has(String(entry.level)) &&
    SALES_TERRITORIES.has(String(entry.territory)) &&
    isInteger(entry.monthlySalaryCents, 1) && isInteger(entry.skill, 1) &&
    isInteger(entry.monthlyTargetCents, 1) && Number(entry.skill) <= 100 &&
    isInteger(entry.dealCapacity, 1) &&
    isInteger(entry.burnout) && Number(entry.burnout) <= 100 &&
    isInteger(entry.hiredAt);
}

function validQuote(entry: Record<string, unknown>): boolean {
  return hasStrings(entry, [
    "id",
    "dealId",
    "product",
    "billingCycle",
    "status",
  ]) && DEAL_PRODUCTS.has(String(entry.product)) &&
    BILLING_CYCLES.has(String(entry.billingCycle)) &&
    QUOTE_STATUSES.has(String(entry.status)) && isInteger(entry.seats, 1) &&
    Number(entry.seats) <= 500 && isInteger(entry.discountPercent) &&
    Number(entry.discountPercent) <= 30 &&
    isInteger(entry.monthlyValueCents, 1) && isInteger(entry.validUntil) &&
    isInteger(entry.createdAt) && isInteger(entry.updatedAt);
}

function validCustomer(entry: Record<string, unknown>): boolean {
  return hasStrings(entry, ["id", "companyId", "primaryLeadId"]) &&
    isInteger(entry.monthlyValueCents) && isInteger(entry.health) &&
    isInteger(entry.startedAt) && isInteger(entry.nextBillingAt);
}

function validTask(entry: Record<string, unknown>): boolean {
  return hasStrings(entry, ["id", "kind", "status", "relatedId", "title"]) &&
    TASK_KINDS.has(String(entry.kind)) &&
    TASK_STATUSES.has(String(entry.status)) &&
    isInteger(entry.dueAt) && isInteger(entry.createdAt) &&
    (entry.completedAt === undefined || isInteger(entry.completedAt));
}

export function parseGameState(value: unknown): GameState {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    throw new SaveValidationError([{
      path: "$",
      message: "Save must be a plain object",
    }]);
  }

  if (value.schemaVersion !== SAVE_SCHEMA_VERSION) {
    issues.push({
      path: "schemaVersion",
      message: "Unsupported schema version",
    });
  }
  if (value.contentVersion !== CONTENT_VERSION) {
    issues.push({
      path: "contentVersion",
      message: "Unsupported content version",
    });
  }
  for (
    const key of [
      "seed",
      "rngCursor",
      "revision",
      "createdAt",
      "savedAt",
      "lastSimulatedAt",
    ]
  ) {
    if (!isInteger(value[key])) {
      issues.push({ path: key, message: "Expected a nonnegative integer" });
    }
  }

  if (
    !isRecord(value.clock) || !isInteger(value.clock.gameMinute) ||
    !CLOCK_STATUSES.has(String(value.clock.status))
  ) {
    issues.push({ path: "clock", message: "Invalid game clock" });
  }
  const company = value.company;
  if (
    !isRecord(company) || !hasStrings(company, ["name"]) ||
    !isFiniteNumber(company.cashCents) ||
    ![
      "mrrCents",
      "baselineMonthlyExpensesCents",
      "bankruptcyThresholdCents",
      "founderCapacityMinutes",
      "founderCapacityRemaining",
      "customerCount",
      "peakMrrCents",
    ].every((key) => isInteger(company[key]))
  ) {
    issues.push({ path: "company", message: "Invalid company economy" });
  }
  const sequences = value.sequences;
  if (
    !isRecord(sequences) ||
    ![
      "company",
      "lead",
      "deal",
      "customer",
      "task",
      "activity",
      "campaign",
      "salesRep",
      "quote",
    ].every((key) => isInteger(sequences[key]))
  ) {
    issues.push({ path: "sequences", message: "Invalid entity sequences" });
  }

  if (!isRecord(value.records)) {
    issues.push({ path: "records", message: "Invalid record collection" });
  } else {
    if (!validEntityMap(value.records.companies, validCompany)) {
      issues.push({ path: "records.companies", message: "Invalid companies" });
    }
    if (!validEntityMap(value.records.leads, validLead)) {
      issues.push({ path: "records.leads", message: "Invalid leads" });
    }
    if (!validEntityMap(value.records.deals, validDeal)) {
      issues.push({ path: "records.deals", message: "Invalid deals" });
    }
    if (!validEntityMap(value.records.customers, validCustomer)) {
      issues.push({ path: "records.customers", message: "Invalid customers" });
    }
    if (!validEntityMap(value.records.tasks, validTask)) {
      issues.push({ path: "records.tasks", message: "Invalid tasks" });
    }
    if (!validEntityMap(value.records.campaigns, validCampaign)) {
      issues.push({ path: "records.campaigns", message: "Invalid campaigns" });
    }
    if (!validEntityMap(value.records.salesReps, validSalesRep)) {
      issues.push({
        path: "records.salesReps",
        message: "Invalid sales representatives",
      });
    }
    if (!validEntityMap(value.records.quotes, validQuote)) {
      issues.push({ path: "records.quotes", message: "Invalid quotes" });
    }
  }

  if (
    !Array.isArray(value.recentActivities) ||
    value.recentActivities.length > 100 ||
    !value.recentActivities.every((entry) =>
      isRecord(entry) &&
      hasStrings(entry, ["id", "kind", "summary"]) &&
      isInteger(entry.gameMinute)
    )
  ) {
    issues.push({
      path: "recentActivities",
      message: "Invalid recent activities",
    });
  }
  const history = value.history;
  if (
    !isRecord(history) ||
    ![
      "leadsCreated",
      "leadsQualified",
      "dealsWon",
      "dealsLost",
      "customersLost",
      "revenueAccruedCents",
      "expensesAccruedCents",
      "activitiesArchived",
      "campaignsArchived",
      "campaignSpendArchivedCents",
      "campaignLeadsArchived",
    ].every((key) => isInteger(history[key]))
  ) {
    issues.push({ path: "history", message: "Invalid aggregate history" });
  }
  if (
    !Array.isArray(value.unlocks) || value.unlocks.length > UNLOCKS.size ||
    !value.unlocks.every((entry) => UNLOCKS.has(String(entry)))
  ) {
    issues.push({ path: "unlocks", message: "Invalid unlock list" });
  }
  if (
    !isRecord(value.onboarding) || !hasStrings(value.onboarding, ["step"]) ||
    typeof value.onboarding.dismissed !== "boolean"
  ) {
    issues.push({ path: "onboarding", message: "Invalid onboarding state" });
  }
  if (
    !isRecord(value.preferences) ||
    typeof value.preferences.reducedMotion !== "boolean" ||
    typeof value.preferences.soundEnabled !== "boolean" ||
    !["list", "board"].includes(String(value.preferences.pipelineView))
  ) {
    issues.push({ path: "preferences", message: "Invalid preferences" });
  }

  if (issues.length > 0) throw new SaveValidationError(issues);

  const state = value as unknown as GameState;
  const invariantResult = validateGameState(state);
  if (!invariantResult.ok) {
    throw new SaveValidationError(invariantResult.issues);
  }
  return state;
}
