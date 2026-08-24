export const SAVE_SCHEMA_VERSION = 30 as const;
export const CONTENT_VERSION = 1 as const;

export type EntityId = string;
export type GameMinute = number;

export type SimulationStatus = "active" | "crisis" | "bankrupt";
export type TimeScale = 1 | 2 | 4;
export type ColorPalette =
  | "emerald"
  | "sapphire"
  | "ruby"
  | "pearl"
  | "moonstone"
  | "onyx"
  | "citrine"
  | "amethyst"
  | "obsidian";
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
export type DealNegotiationApproach = "discount" | "value_proof" | "pilot";
export type BillingCycle = "monthly" | "annual";
export type QuoteStatus = "draft" | "sent" | "accepted" | "expired";
export type CustomerLifecycle = "onboarding" | "active" | "at_risk";
export type CustomerAccountPlan =
  | "balanced"
  | "adoption"
  | "relationship"
  | "expansion"
  | "stabilization";
export type TicketChannel = "email" | "chat" | "phone";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketStatus = "open" | "acknowledged" | "resolved";
export type TicketResolutionApproach =
  | "fast_workaround"
  | "thorough_fix"
  | "specialist_escalation";
export type IncidentSeverity = "minor" | "major" | "critical";
export type IncidentStatus = "investigating" | "resolved";
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
  | "deal_negotiation_decided"
  | "deal_won"
  | "deal_lost"
  | "sales_rep_hired"
  | "sales_rep_fired"
  | "sales_rep_trained"
  | "deal_assigned"
  | "leads_routed"
  | "quote_created"
  | "quote_updated"
  | "quote_sent"
  | "quote_accepted"
  | "quote_expired"
  | "customer_onboarded"
  | "customer_check_in"
  | "customer_plan_set"
  | "customer_renewed"
  | "customer_expanded"
  | "customer_at_risk"
  | "customer_churned"
  | "success_rep_hired"
  | "success_rep_fired"
  | "customer_assigned"
  | "customers_routed"
  | "success_playbook_run"
  | "ticket_created"
  | "ticket_assigned"
  | "ticket_acknowledged"
  | "ticket_resolved"
  | "ticket_resolution_decided"
  | "ticket_sla_breached"
  | "support_rep_hired"
  | "support_rep_fired"
  | "ticket_escalated"
  | "incident_declared"
  | "incident_resolved"
  | "customer_feedback_received"
  | "task_created"
  | "task_completed"
  | "automation_ran"
  | "task_cancelled"
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
  | "campaign_archived"
  | "initiative_started"
  | "initiative_milestone_ready"
  | "initiative_milestone_decided"
  | "initiative_completed"
  | "quarter_completed"
  | "operating_goal_reached";
export type AutomationTrigger =
  | "lead_created"
  | "lead_contacted"
  | "lead_qualified"
  | "quote_sent"
  | "deal_won"
  | "customer_at_risk"
  | "ticket_created"
  | "ticket_sla_breached";
export type AutomationCondition =
  | "all"
  | "high_value"
  | "unassigned"
  | "high_intent"
  | "overdue";
export type AutomationAction =
  | "create_task"
  | "send_outreach"
  | "assign_owner"
  | "notify_team"
  | "qualify_lead"
  | "update_record"
  | "launch_playbook";

export interface SequenceAutomation {
  id: EntityId;
  name: string;
  audience: "leads" | "customers";
  enabled: boolean;
  enrolled: number;
  completed: number;
}

export interface WorkflowAutomation {
  id: EntityId;
  name: string;
  trigger: AutomationTrigger;
  condition: AutomationCondition;
  action: AutomationAction;
  enabled: boolean;
  runs: number;
  errors: number;
  lastRunAt?: GameMinute;
}

export interface Department {
  id: EntityId;
  name: string;
  manager: string;
  monthlyBudgetCents: number;
  headcountPlan: number;
  headcount: number;
  burnout: number;
}

export type ManagerDepartment =
  | "sales"
  | "marketing"
  | "customer_success"
  | "support";

export interface OperatingManager {
  id: EntityId;
  name: string;
  department: ManagerDepartment;
  monthlySalaryCents: number;
  hiredAt: GameMinute;
  lastReviewedAt: GameMinute;
  underCapacityReviews: number;
  lastDecision?: string;
}

export type InitiativeType =
  | "growth"
  | "efficiency"
  | "retention"
  | "resilience";
export type InitiativeApproach = "accelerate" | "stabilize";
export type InitiativeStatus = "active" | "completed";

export interface InitiativeDecision {
  milestone: number;
  approach: InitiativeApproach;
  decidedAt: GameMinute;
}

export interface CompanyInitiative {
  id: EntityId;
  type: InitiativeType;
  status: InitiativeStatus;
  startedAt: GameMinute;
  endsAt: GameMinute;
  startCostCents: number;
  milestoneAt: [GameMinute, GameMinute, GameMinute];
  promptedMilestone: number;
  decisions: InitiativeDecision[];
  completedAt?: GameMinute;
  rewardCents?: number;
  outcome?: string;
}

export interface PlatformState {
  sequences: SequenceAutomation[];
  workflows: WorkflowAutomation[];
  dashboardWidgets: string[];
  automationRunsArchived: number;
  automationErrorsArchived: number;
  departments: Department[];
  managers: OperatingManager[];
  approvalThresholdCents: number;
  auditEntriesArchived: number;
  quarter: number;
  growthTargetCents: number;
  efficiencyTargetPercent: number;
  retentionTargetPercent: number;
  resilienceLevel: number;
  endlessGoal: number;
  initiativeSequence: number;
  initiatives: CompanyInitiative[];
  initiativesCompleted: number;
  quarterInitiativeCompleted: boolean;
}
export type CampaignChannel = "email" | "paid_social" | "events";
export type CampaignAudience = "small_business" | "mid_market" | "enterprise";
export type CampaignObjective = "balanced" | "reach" | "quality" | "efficiency";
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
  objective: CampaignObjective;
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
  adoption: number;
  lifecycle: CustomerLifecycle;
  accountPlan: CustomerAccountPlan;
  startedAt: GameMinute;
  nextBillingAt: GameMinute;
  renewalAt: GameMinute;
  lastSuccessAt: GameMinute;
  expansions: number;
  ownerId?: EntityId;
  lastNpsScore?: number;
  lastFeedback?: string;
  lastSurveyAt?: GameMinute;
}

export interface SuccessRep {
  id: EntityId;
  name: string;
  level: SalesRepLevel;
  monthlySalaryCents: number;
  skill: number;
  accountCapacity: number;
  burnout: number;
  hiredAt: GameMinute;
}

export interface Ticket {
  id: EntityId;
  customerId: EntityId;
  channel: TicketChannel;
  priority: TicketPriority;
  status: TicketStatus;
  title: string;
  createdAt: GameMinute;
  responseDueAt: GameMinute;
  resolutionDueAt: GameMinute;
  ownerId?: EntityId;
  acknowledgedAt?: GameMinute;
  resolvedAt?: GameMinute;
  responseBreachedAt?: GameMinute;
  resolutionBreachedAt?: GameMinute;
  escalated: boolean;
  resolutionQuality?: number;
}

export interface SupportRep {
  id: EntityId;
  name: string;
  level: SalesRepLevel;
  monthlySalaryCents: number;
  skill: number;
  ticketCapacity: number;
  burnout: number;
  hiredAt: GameMinute;
}

export interface Incident {
  id: EntityId;
  ticketId: EntityId;
  customerId: EntityId;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  createdAt: GameMinute;
  resolvedAt?: GameMinute;
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
  customersRenewed: number;
  renewalMrrCents: number;
  churnedMrrCents: number;
  expansionMrrCents: number;
  npsResponses: number;
  npsScoreTotal: number;
  ticketsResolved: number;
  ticketsBreached: number;
  ticketResolutionMinutes: number;
  ticketsArchived: number;
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
  successRep: number;
  ticket: number;
  supportRep: number;
  incident: number;
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
  successReps: Record<EntityId, SuccessRep>;
  tickets: Record<EntityId, Ticket>;
  supportReps: Record<EntityId, SupportRep>;
  incidents: Record<EntityId, Incident>;
}

export interface OnboardingState {
  step:
    | "inspect_lead"
    | "contact_lead"
    | "explain_spam"
    | "review_contacts"
    | "review_company"
    | "qualify_lead"
    | "review_tasks"
    | "work_deal"
    | "review_dashboard"
    | "onboard_customer"
    | "repeat_sales"
    | "complete";
  dismissed: boolean;
}

export type OnboardingStep = OnboardingState["step"];

export interface NarrativeState {
  chapter: number;
  pendingBriefing: boolean;
  completedAt?: GameMinute;
}

export interface PreferenceState {
  palette: ColorPalette;
  darkMode: boolean;
  reducedMotion: boolean;
  soundEnabled: boolean;
  musicEnabled: boolean;
  musicVolume: number;
  pipelineView: "list" | "board";
  timeScale: TimeScale;
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
  narrative: NarrativeState;
  preferences: PreferenceState;
  platform: PlatformState;
}

export type GameCommand =
  | { type: "prospect_lead" }
  | { type: "contact_lead"; leadId: EntityId; channel: "call" | "email" }
  | { type: "qualify_lead"; leadId: EntityId }
  | { type: "disqualify_lead"; leadId: EntityId }
  | { type: "advance_deal"; dealId: EntityId }
  | {
    type: "negotiate_deal";
    dealId: EntityId;
    approach: DealNegotiationApproach;
  }
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
  | { type: "fire_sales_rep"; salesRepId: EntityId }
  | { type: "assign_lead"; leadId: EntityId; ownerId?: EntityId }
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
    objective: CampaignObjective;
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
    objective: CampaignObjective;
    dailyBudgetCents: number;
    durationDays: number;
    message: string;
  }
  | { type: "duplicate_campaign"; campaignId: EntityId }
  | { type: "archive_campaign"; campaignId: EntityId }
  | { type: "rename_company"; name: string }
  | { type: "set_palette"; palette: ColorPalette }
  | { type: "set_dark_mode"; enabled: boolean }
  | { type: "set_reduced_motion"; enabled: boolean }
  | { type: "set_sound_enabled"; enabled: boolean }
  | { type: "set_music_enabled"; enabled: boolean }
  | { type: "set_music_volume"; volume: number }
  | { type: "set_time_scale"; timeScale: TimeScale }
  | { type: "set_pipeline_view"; view: "list" | "board" }
  | { type: "bulk_advance_deals"; dealIds: EntityId[] }
  | {
    type: "bulk_assign_deals";
    dealIds: EntityId[];
    ownerId?: EntityId;
  }
  | { type: "complete_task"; taskId: EntityId }
  | { type: "cancel_task"; taskId: EntityId }
  | { type: "complete_customer_onboarding"; customerId: EntityId }
  | { type: "customer_check_in"; customerId: EntityId }
  | {
    type: "set_customer_plan";
    customerId: EntityId;
    accountPlan: CustomerAccountPlan;
  }
  | { type: "renew_customer"; customerId: EntityId }
  | { type: "expand_customer"; customerId: EntityId }
  | { type: "hire_success_rep"; name: string; level: SalesRepLevel }
  | { type: "fire_success_rep"; successRepId: EntityId }
  | { type: "route_customers" }
  | {
    type: "assign_customer";
    customerId: EntityId;
    ownerId?: EntityId;
  }
  | {
    type: "run_success_playbook";
    customerId: EntityId;
    playbook: "onboarding" | "adoption" | "recovery";
  }
  | { type: "assign_ticket"; ticketId: EntityId; ownerId?: EntityId }
  | { type: "acknowledge_ticket"; ticketId: EntityId }
  | { type: "resolve_ticket"; ticketId: EntityId }
  | {
    type: "resolve_ticket_with_approach";
    ticketId: EntityId;
    approach: TicketResolutionApproach;
  }
  | { type: "hire_support_rep"; name: string; level: SalesRepLevel }
  | { type: "fire_support_rep"; supportRepId: EntityId }
  | { type: "escalate_ticket"; ticketId: EntityId }
  | {
    type: "declare_incident";
    ticketId: EntityId;
    severity: IncidentSeverity;
  }
  | { type: "resolve_incident"; incidentId: EntityId }
  | { type: "send_nps_survey"; customerId: EntityId }
  | { type: "create_sequence"; name: string; audience: "leads" | "customers" }
  | { type: "toggle_sequence"; sequenceId: EntityId }
  | {
    type: "create_workflow";
    name: string;
    trigger: AutomationTrigger;
    condition: AutomationCondition;
    action: AutomationAction;
  }
  | { type: "toggle_workflow"; workflowId: EntityId }
  | { type: "delete_workflow"; workflowId: EntityId }
  | {
    type: "create_department";
    name: string;
    manager: string;
    monthlyBudgetCents: number;
    headcountPlan: number;
  }
  | { type: "hire_department_staff"; departmentId: EntityId }
  | {
    type: "hire_manager";
    name: string;
    department: ManagerDepartment;
  }
  | { type: "fire_manager"; department: ManagerDepartment }
  | { type: "set_approval_threshold"; amountCents: number }
  | { type: "invest_resilience" }
  | { type: "start_initiative"; initiativeType: InitiativeType }
  | {
    type: "decide_initiative_milestone";
    initiativeId: EntityId;
    approach: InitiativeApproach;
  }
  | { type: "acknowledge_onboarding"; step: OnboardingStep }
  | { type: "skip_onboarding" }
  | { type: "acknowledge_narrative" }
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
  maxInactiveGameMinutes: number;
  leadArrivalIntervalMinutes: number;
  prospectingCapacityMinutes: number;
  leadCoolingMinutes: number;
  safeCloseIntent: number;
  maximumCloseLossChancePercent: number;
  capacityResetIntervalMinutes: number;
  billingIntervalMinutes: number;
  maxRecentActivities: number;
  marketingUnlockCustomers: number;
  pipelineUnlockMrrCents: number;
  pipelineUnlockCustomers: number;
  maxActiveCampaigns: number;
  maxCampaignRecords: number;
  maxLeadRecords: number;
  maxDealRecords: number;
  maxTaskRecords: number;
  maxSalesReps: number;
  maxQuoteRecords: number;
  customerSuccessUnlockCustomers: number;
  customerRenewalIntervalMinutes: number;
  customerNeglectGraceMinutes: number;
  maxSuccessReps: number;
  maxTicketRecords: number;
  maxSupportReps: number;
  maxIncidentRecords: number;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; issues: ValidationIssue[] };
