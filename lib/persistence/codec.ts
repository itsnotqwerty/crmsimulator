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
  health: "he",
  startedAt: "ss",
  nextBillingAt: "nb",
  kind: "ki",
  relatedId: "ri",
  title: "ti",
  dueAt: "du",
  completedAt: "cm",
  channel: "ch",
  audience: "au",
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
  hiredAt: "hi",
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
  unlocks: "u",
  onboarding: "o",
  step: "os",
  dismissed: "od",
  preferences: "p",
  reducedMotion: "rm",
  soundEnabled: "se",
};

const REVERSE_KEY_MAP = Object.fromEntries(
  Object.entries(KEY_MAP).map(([key, compact]) => [compact, key]),
);

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
  return migrateGameState(transformKeys(compact, REVERSE_KEY_MAP));
}
