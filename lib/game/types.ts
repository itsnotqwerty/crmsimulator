export const SAVE_SCHEMA_VERSION = 8 as const;
export const CONTENT_VERSION = 1 as const;

export type EntityId = string;
export type GameMinute = number;

export type SimulationStatus = "active" | "crisis" | "bankrupt";
export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "disqualified"
  | "converted"
  | "cold";
export type DealStage =
  | "qualified"
  | "discovery"
  | "evaluation"
  | "negotiation"
  | "won"
  | "lost";
export type DealProduct = "starter" | "growth" | "scale";
export type BillingCycle = "monthly" | "annual";
export type QuoteStatus = "draft" | "sent" | "accepted" | "expired";
export type SalesRepLevel = "junior" | "mid" | "senior";
export type SalesTerritory =
  | "all"
  | "North America"
  | "Europe"
  | "Asia Pacific";
export type DealLossReason =
  | "budget"
  | "timing"
  | "competition"
  | "no_decision"
  | "poor_fit";
export type TaskKind = "call" | "email" | "follow_up" | "onboarding";
export type TaskStatus = "open" | "completed" | "cancelled";
export type ActivityKind =
  | "lead_created"
  | "lead_contacted"
  | "lead_qualified"
  | "lead_disqualified"
  | "deal_created"
  | "deal_updated"
  | "deal_advanced"
  | "deal_won"
  | "deal_lost"
  | "sales_rep_hired"
  | "sales_rep_trained"
  | "deal_assigned"
  | "leads_routed"
  | "quote_created"
  | "quote_updated"
  | "quote_sent"
  | "quote_accepted"
  | "quote_expired"
  | "task_created"
  | "task_completed"
  | "task_overdue"
  | "revenue_accrued"
  | "expense_accrued"
  | "unlock_earned"
  | "crisis_entered"
  | "bankruptcy_declared"
  | "campaign_created"
  | "campaign_edited"
  | "campaign_duplicated"
  | "campaign_paused"
  | "campaign_resumed"
  | "campaign_completed"
  | "campaign_archived";
export type CampaignChannel = "email" | "paid_social" | "events";
export type CampaignAudience = "small_business" | "mid_market" | "enterprise";
export type CampaignStatus = "active" | "paused" | "completed" | "archived";
export type UnlockId = "marketing" | "pipeline" | "customer_success";

export interface GameClock {
  gameMinute: GameMinute;
  status: SimulationStatus;
  crisisReason?: string;
  bankruptAt?: GameMinute;
}

export interface CompanyState {
  name: string;
  cashCents: number;
  mrrCents: number;
  baselineMonthlyExpensesCents: number;
  bankruptcyThresholdCents: number;
  founderCapacityMinutes: number;
  founderCapacityRemaining: number;
  customerCount: number;
  peakMrrCents: number;
}

export interface CrmCompany {
  id: EntityId;
  name: string;
  industry: string;
  employeeCount: number;
  region: string;
  createdAt: GameMinute;
}

export interface Lead {
  id: EntityId;
  companyId: EntityId;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  source: "organic" | "referral" | "campaign";
  campaignId?: EntityId;
  ownerId?: EntityId;
  fit: number;
  engagement: number;
  status: LeadStatus;
  createdAt: GameMinute;
  lastActivityAt: GameMinute;
}

export interface Campaign {
  id: EntityId;
  name: string;
  channel: CampaignChannel;
  audience: CampaignAudience;
  status: CampaignStatus;
  message: string;
  dailyBudgetCents: number;
  createdAt: GameMinute;
  endsAt: GameMinute;
  totalSpentCents: number;
  leadsGenerated: number;
}

export interface Deal {
  id: EntityId;
  leadId: EntityId;
  companyId: EntityId;
  stage: DealStage;
  product: DealProduct;
  lossReason?: DealLossReason;
  ownerId?: EntityId;
  monthlyValueCents: number;
  probability: number;
  expectedCloseAt: GameMinute;
  createdAt: GameMinute;
  updatedAt: GameMinute;
}

export interface SalesRep {
  id: EntityId;
  name: string;
  level: SalesRepLevel;
  territory: SalesTerritory;
  monthlySalaryCents: number;
  monthlyTargetCents: number;
  skill: number;
  dealCapacity: number;
  burnout: number;
  hiredAt: GameMinute;
}

export interface Quote {
  id: EntityId;
  dealId: EntityId;
  product: DealProduct;
  billingCycle: BillingCycle;
  seats: number;
  discountPercent: number;
  monthlyValueCents: number;
  status: QuoteStatus;
  validUntil: GameMinute;
  createdAt: GameMinute;
  updatedAt: GameMinute;
}

export interface Customer {
  id: EntityId;
  companyId: EntityId;
  primaryLeadId: EntityId;
  monthlyValueCents: number;
  health: number;
  startedAt: GameMinute;
  nextBillingAt: GameMinute;
}

export interface Task {
  id: EntityId;
  kind: TaskKind;
  status: TaskStatus;
  relatedId: EntityId;
  title: string;
  dueAt: GameMinute;
  createdAt: GameMinute;
  completedAt?: GameMinute;
}

export interface Activity {
  id: EntityId;
  kind: ActivityKind;
  summary: string;
  relatedId?: EntityId;
  gameMinute: GameMinute;
}

export interface AggregateHistory {
  leadsCreated: number;
  leadsQualified: number;
  dealsWon: number;
  dealsLost: number;
  customersLost: number;
  revenueAccruedCents: number;
  expensesAccruedCents: number;
  activitiesArchived: number;
  campaignsArchived: number;
  campaignSpendArchivedCents: number;
  campaignLeadsArchived: number;
}

export interface SequenceState {
  company: number;
  lead: number;
  deal: number;
  customer: number;
  task: number;
  activity: number;
  campaign: number;
  salesRep: number;
  quote: number;
}

export interface RecordState {
  companies: Record<EntityId, CrmCompany>;
  leads: Record<EntityId, Lead>;
  deals: Record<EntityId, Deal>;
  customers: Record<EntityId, Customer>;
  tasks: Record<EntityId, Task>;
  campaigns: Record<EntityId, Campaign>;
  salesReps: Record<EntityId, SalesRep>;
  quotes: Record<EntityId, Quote>;
}

export interface OnboardingState {
  step:
    | "inspect_lead"
    | "contact_lead"
    | "qualify_lead"
    | "close_deal"
    | "complete";
  dismissed: boolean;
}

export interface PreferenceState {
  reducedMotion: boolean;
  soundEnabled: boolean;
  pipelineView: "list" | "board";
}

export interface GameState {
  schemaVersion: typeof SAVE_SCHEMA_VERSION;
  contentVersion: typeof CONTENT_VERSION;
  seed: number;
  rngCursor: number;
  revision: number;
  createdAt: number;
  savedAt: number;
  lastSimulatedAt: number;
  clock: GameClock;
  company: CompanyState;
  sequences: SequenceState;
  records: RecordState;
  recentActivities: Activity[];
  history: AggregateHistory;
  unlocks: UnlockId[];
  onboarding: OnboardingState;
  preferences: PreferenceState;
}

export type GameCommand =
  | { type: "contact_lead"; leadId: EntityId; channel: "call" | "email" }
  | { type: "qualify_lead"; leadId: EntityId }
  | { type: "disqualify_lead"; leadId: EntityId }
  | { type: "advance_deal"; dealId: EntityId }
  | {
    type: "update_deal";
    dealId: EntityId;
    product: DealProduct;
    monthlyValueCents: number;
    expectedCloseInDays: number;
  }
  | {
    type: "lose_deal";
    dealId: EntityId;
    reason: DealLossReason;
  }
  | {
    type: "hire_sales_rep";
    name: string;
    level: SalesRepLevel;
    territory: SalesTerritory;
    monthlyTargetCents: number;
  }
  | { type: "assign_deal"; dealId: EntityId; ownerId?: EntityId }
  | { type: "train_sales_rep"; salesRepId: EntityId }
  | { type: "route_leads" }
  | {
    type: "create_quote";
    dealId: EntityId;
    product: DealProduct;
    billingCycle: BillingCycle;
    seats: number;
    discountPercent: number;
    validDays: number;
  }
  | {
    type: "update_quote";
    quoteId: EntityId;
    product: DealProduct;
    billingCycle: BillingCycle;
    seats: number;
    discountPercent: number;
    validDays: number;
  }
  | { type: "set_quote_status"; quoteId: EntityId; status: "sent" | "expired" }
  | { type: "accept_quote"; quoteId: EntityId }
  | { type: "follow_up_lead"; leadId: EntityId }
  | { type: "request_referrals" }
  | {
    type: "create_campaign";
    name: string;
    channel: CampaignChannel;
    audience: CampaignAudience;
    dailyBudgetCents: number;
    durationDays: number;
    message: string;
  }
  | {
    type: "set_campaign_status";
    campaignId: EntityId;
    status: "active" | "paused";
  }
  | {
    type: "update_campaign";
    campaignId: EntityId;
    name: string;
    channel: CampaignChannel;
    audience: CampaignAudience;
    dailyBudgetCents: number;
    durationDays: number;
    message: string;
  }
  | { type: "duplicate_campaign"; campaignId: EntityId }
  | { type: "archive_campaign"; campaignId: EntityId }
  | { type: "rename_company"; name: string }
  | { type: "set_reduced_motion"; enabled: boolean }
  | { type: "set_pipeline_view"; view: "list" | "board" }
  | { type: "bulk_advance_deals"; dealIds: EntityId[] }
  | {
    type: "bulk_assign_deals";
    dealIds: EntityId[];
    ownerId?: EntityId;
  }
  | { type: "complete_task"; taskId: EntityId }
  | { type: "resume_crisis" }
  | { type: "new_company"; seed: number; now: number; companyName?: string };

export interface DomainEvent {
  kind: ActivityKind;
  summary: string;
  relatedId?: EntityId;
  gameMinute: GameMinute;
  amountCents?: number;
}

export interface CommandResult {
  accepted: boolean;
  state: GameState;
  events: DomainEvent[];
  reason?: string;
}

export interface AdvanceSummary {
  elapsedGameMinutes: number;
  leadsCreated: number;
  revenueAccruedCents: number;
  expensesAccruedCents: number;
  tasksOverdue: number;
  stoppedForCrisis: boolean;
  bankruptcyDeclared: boolean;
}

export interface AdvanceResult {
  state: GameState;
  events: DomainEvent[];
  summary: AdvanceSummary;
}

export interface GameRules {
  simulationStepMinutes: number;
  realMillisecondsPerGameMinute: number;
  maxOfflineRealMilliseconds: number;
  leadArrivalIntervalMinutes: number;
  leadCoolingMinutes: number;
  capacityResetIntervalMinutes: number;
  billingIntervalMinutes: number;
  maxRecentActivities: number;
  marketingUnlockCustomers: number;
  pipelineUnlockMrrCents: number;
  pipelineUnlockOpenDeals: number;
  maxActiveCampaigns: number;
  maxCampaignRecords: number;
  maxSalesReps: number;
  maxQuoteRecords: number;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; issues: ValidationIssue[] };
