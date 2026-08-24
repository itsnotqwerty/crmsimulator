import { decodeBase64Url, encodeBase64Url } from "$std/encoding/base64url.ts";
import type { GameState } from "../game/types.ts";
import { migrateGameState } from "./migrations.ts";
import { parseGameState } from "./schema.ts";

const KEY_MAP: Readonly<Record<string, string>> = {
  schemaVersion: "v",
  contentVersion: "w",
  seed: "s",
  rngCursor: "r",
  revision: "q",
  createdAt: "ca",
  savedAt: "sa",
  lastSimulatedAt: "ls",
  clock: "k",
  gameMinute: "gm",
  status: "st",
  crisisReason: "cr",
  bankruptAt: "ba",
  company: "c",
  cashCents: "cc",
  mrrCents: "mr",
  baselineMonthlyExpensesCents: "be",
  bankruptcyThresholdCents: "bt",
  founderCapacityMinutes: "fc",
  founderCapacityRemaining: "fr",
  customerCount: "cn",
  peakMrrCents: "pm",
  sequences: "x",
  activity: "ac",
  records: "d",
  companies: "co",
  leads: "le",
  deals: "de",
  customers: "cu",
  tasks: "ta",
  campaigns: "cp",
  salesReps: "sr",
  quotes: "qt",
  successReps: "csr",
  tickets: "tk",
  supportReps: "spr",
  incidents: "in",
  companyId: "ci",
  employeeCount: "ec",
  firstName: "fn",
  lastName: "ln",
  source: "so",
  fit: "fi",
  engagement: "en",
  lastActivityAt: "la",
  campaignId: "cpi",
  leadId: "li",
  stage: "sg",
  product: "pd",
  lossReason: "lr",
  ownerId: "oi",
  monthlyValueCents: "mv",
  probability: "pr",
  expectedCloseAt: "ex",
  updatedAt: "ua",
  primaryLeadId: "pl",
  customerId: "cui",
  health: "he",
  adoption: "ad",
  lifecycle: "lc",
  accountPlan: "apl",
  startedAt: "ss",
  nextBillingAt: "nb",
  renewalAt: "rn",
  lastSuccessAt: "lsa",
  expansions: "xp",
  lastNpsScore: "ns",
  lastFeedback: "nf",
  lastSurveyAt: "nt",
  priority: "py",
  responseDueAt: "rd",
  resolutionDueAt: "rr",
  acknowledgedAt: "aka",
  resolvedAt: "rsa",
  responseBreachedAt: "rba",
  resolutionBreachedAt: "rzb",
  escalated: "es",
  resolutionQuality: "rq",
  ticketCapacity: "tc",
  ticketId: "tki",
  severity: "sv",
  kind: "ki",
  relatedId: "ri",
  title: "ti",
  dueAt: "du",
  completedAt: "cm",
  channel: "ch",
  audience: "au",
  objective: "ob",
  message: "me",
  dailyBudgetCents: "db",
  endsAt: "ea",
  totalSpentCents: "ts",
  leadsGenerated: "lg",
  level: "lv",
  monthlySalaryCents: "ms",
  monthlyTargetCents: "mt",
  territory: "tr",
  skill: "sk",
  dealCapacity: "dc",
  accountCapacity: "ap",
  hiredAt: "hi",
  burnout: "bo",
  billingCycle: "bc",
  seats: "sz",
  discountPercent: "dp",
  validUntil: "vu",
  recentActivities: "a",
  summary: "su",
  history: "h",
  leadsCreated: "hc",
  leadsQualified: "hq",
  dealsWon: "hw",
  dealsLost: "hl",
  customersLost: "hu",
  revenueAccruedCents: "hr",
  expensesAccruedCents: "hec",
  activitiesArchived: "ha",
  campaignsArchived: "hca",
  campaignSpendArchivedCents: "hcs",
  campaignLeadsArchived: "hcl",
  customersRenewed: "hrr",
  renewalMrrCents: "hrm",
  churnedMrrCents: "hcm",
  expansionMrrCents: "hem",
  npsResponses: "hnr",
  npsScoreTotal: "hnt",
  ticketsResolved: "htr",
  ticketsBreached: "htb",
  ticketResolutionMinutes: "htm",
  ticketsArchived: "hta",
  unlocks: "u",
  onboarding: "o",
  step: "os",
  dismissed: "od",
  narrative: "nr",
  chapter: "nc",
  pendingBriefing: "np",
  preferences: "p",
  palette: "pa",
  darkMode: "dk",
  reducedMotion: "rm",
  soundEnabled: "se",
  musicEnabled: "mu",
  musicVolume: "ml",
  timeScale: "tm",
  platform: "pf",
  workflows: "wf",
  integrations: "ig",
  customFields: "cf",
  savedViews: "vw",
  dashboardWidgets: "dw",
  duplicateReviews: "dr",
  duplicatesMerged: "dm",
  automationRunsArchived: "ar",
  automationErrorsArchived: "ae",
  departments: "ds",
  managers: "mgs",
  approvalThresholdCents: "at",
  auditEntriesArchived: "aa",
  quarter: "qu",
  growthTargetCents: "gt",
  efficiencyTargetPercent: "et",
  retentionTargetPercent: "rt",
  resilienceLevel: "rl",
  endlessGoal: "eg",
  initiativeSequence: "isq",
  initiatives: "ini",
  initiativesCompleted: "inc",
  quarterInitiativeCompleted: "qic",
  startCostCents: "isc",
  milestoneAt: "ima",
  promptedMilestone: "ipm",
  decisions: "ide",
  milestone: "im",
  approach: "iap",
  decidedAt: "ida",
  rewardCents: "irc",
  outcome: "io",
  trigger: "tg",
  condition: "cd",
  action: "ax",
  enabled: "eb",
  runs: "ru",
  errors: "er",
  lastRunAt: "lra",
  mapping: "mp",
  recordsSynced: "rs",
  failures: "fl",
  manager: "mg",
  department: "dpt",
  lastReviewedAt: "lrv",
  underCapacityReviews: "ucr",
  lastDecision: "ld",
  monthlyBudgetCents: "mb",
  headcountPlan: "hp",
  headcount: "hd",
  enrolled: "eo",
  completed: "cpd",
};

function createReverseKeyMap(
  mapping: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const reverse: Record<string, string> = {};
  for (const [key, compact] of Object.entries(mapping)) {
    if (reverse[compact] !== undefined) {
      throw new Error(
        `Compact save key "${compact}" is assigned to both "${
          reverse[compact]
        }" and "${key}"`,
      );
    }
    reverse[compact] = key;
  }
  return reverse;
}

const REVERSE_KEY_MAP = createReverseKeyMap(KEY_MAP);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function moveCompactKey(
  record: Record<string, unknown>,
  legacyKey: string,
  currentKey: string,
): Record<string, unknown> {
  if (!Object.hasOwn(record, legacyKey)) return record;
  const updated = { ...record };
  if (!Object.hasOwn(updated, currentKey)) {
    updated[currentKey] = updated[legacyKey];
  }
  delete updated[legacyKey];
  return updated;
}

function normalizeLegacyCompactKeys(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const normalized = { ...value };

  const preferencesKey = KEY_MAP.preferences;
  const preferences = normalized[preferencesKey];
  if (isRecord(preferences)) {
    normalized[preferencesKey] = moveCompactKey(
      preferences,
      "pl",
      KEY_MAP.palette,
    );
  }

  const platformKey = KEY_MAP.platform;
  const platform = normalized[platformKey];
  const managers = isRecord(platform) ? platform[KEY_MAP.managers] : undefined;
  if (isRecord(platform) && Array.isArray(managers)) {
    normalized[platformKey] = {
      ...platform,
      [KEY_MAP.managers]: managers.map((manager) =>
        isRecord(manager)
          ? moveCompactKey(manager, "lr", KEY_MAP.lastReviewedAt)
          : manager
      ),
    };
  }

  return normalized;
}

function transformKeys(
  value: unknown,
  mapping: Readonly<Record<string, string>>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => transformKeys(entry, mapping));
  }
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      mapping[key] ?? key,
      transformKeys(entry, mapping),
    ]),
  );
}

async function compress(bytes: Uint8Array): Promise<Uint8Array> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const stream = new Blob([buffer]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decompress(bytes: Uint8Array): Promise<Uint8Array> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const stream = new Blob([buffer]).stream().pipeThrough(
    new DecompressionStream("gzip"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeGameState(state: GameState): Promise<string> {
  const validState = parseGameState(state);
  const compact = transformKeys(validState, KEY_MAP);
  const json = JSON.stringify(compact);
  const compressed = await compress(new TextEncoder().encode(json));
  return encodeBase64Url(compressed);
}

export async function decodeGameState(encoded: string): Promise<GameState> {
  if (encoded.length === 0) throw new TypeError("Encoded save is empty");
  const compressed = decodeBase64Url(encoded);
  const json = new TextDecoder().decode(await decompress(compressed));
  const compact: unknown = JSON.parse(json);
  return migrateGameState(
    transformKeys(normalizeLegacyCompactKeys(compact), REVERSE_KEY_MAP),
  );
}
