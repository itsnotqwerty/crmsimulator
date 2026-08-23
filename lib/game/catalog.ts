import type {
  CrmCompany,
  CustomerLifecycle,
  GameMinute,
  Lead,
  TicketChannel,
  TicketPriority,
} from "./types.ts";
import { pick, randomInteger } from "./rng.ts";

const FIRST_NAMES = [
  "Adrian",
  "Amara",
  "Andrei",
  "Anika",
  "Avery",
  "Beatriz",
  "Cameron",
  "Chidi",
  "Clara",
  "Darius",
  "Devon",
  "Diego",
  "Elena",
  "Elias",
  "Esme",
  "Fatima",
  "Felix",
  "Gabriel",
  "Hana",
  "Haruto",
  "Helena",
  "Imani",
  "Ines",
  "Isaac",
  "Javier",
  "Jin",
  "Jordan",
  "Kai",
  "Kwame",
  "Leila",
  "Lena",
  "Liam",
  "Lucia",
  "Malik",
  "Mateo",
  "Mei",
  "Mina",
  "Morgan",
  "Nadia",
  "Nikhil",
  "Noah",
  "Omar",
  "Petra",
  "Priya",
  "Rafael",
  "Ren",
  "Riley",
  "Robin",
  "Salma",
  "Samira",
  "Santiago",
  "Sofia",
  "Sora",
  "Taylor",
  "Theo",
  "Valentina",
  "Viktor",
  "Wei",
  "Yara",
  "Yuki",
  "Zane",
  "Zoe",
] as const;
const LAST_NAMES = [
  "Adeyemi",
  "Alvarez",
  "Andersson",
  "Bennett",
  "Bianchi",
  "Brooks",
  "Brown",
  "Campbell",
  "Chen",
  "Chukwu",
  "Costa",
  "Diaz",
  "Dubois",
  "Eriksen",
  "Fischer",
  "Garcia",
  "Gomez",
  "Gupta",
  "Haddad",
  "Hernandez",
  "Ibrahim",
  "Ito",
  "Ivanov",
  "Jensen",
  "Johnson",
  "Keller",
  "Kim",
  "Kowalski",
  "Kumar",
  "Laurent",
  "Lopez",
  "Martinez",
  "Mensah",
  "Meyer",
  "Moreno",
  "Muller",
  "Nakamura",
  "Nguyen",
  "Novak",
  "Okafor",
  "Oliveira",
  "Park",
  "Patel",
  "Petrov",
  "Reyes",
  "Rossi",
  "Santos",
  "Schmidt",
  "Singh",
  "Smith",
  "Suzuki",
  "Thompson",
  "Torres",
  "Vega",
  "Walker",
  "Wang",
  "Williams",
  "Wilson",
  "Young",
  "Zhang",
] as const;
const COMPANY_PREFIXES = [
  "Alder",
  "Beacon",
  "Bluebird",
  "Brightline",
  "Cedar",
  "Clearwater",
  "Copper",
  "Evergreen",
  "Fieldstone",
  "Granite",
  "Harbor",
  "Ironwood",
  "Juniper",
  "Keystone",
  "Lakeshore",
  "Meridian",
  "Northstar",
  "Oakwell",
  "Pioneer",
  "Redwood",
  "Stonebridge",
  "Summit",
  "Waypoint",
  "Westbridge",
] as const;
const COMPANY_SUFFIXES = [
  "Analytics",
  "Collective",
  "Group",
  "Labs",
  "Logistics",
  "Manufacturing",
  "Partners",
  "Solutions",
  "Systems",
  "Technologies",
  "Ventures",
  "Works",
] as const;
const INDUSTRIES = [
  "Business services",
  "Healthcare technology",
  "Logistics",
  "Manufacturing",
  "Professional services",
  "Retail technology",
] as const;
const REGIONS = ["North America", "Europe", "Asia Pacific"] as const;
const ROLES = [
  "Director of Operations",
  "Head of Revenue",
  "Marketing Manager",
  "Operations Manager",
  "VP of Sales",
] as const;
const TICKET_TITLES = [
  "Cannot export the monthly report",
  "SSO login loops on sign-in",
  "Seat count did not update after expansion",
  "Dashboard widgets render blank",
  "Invoice PDF will not download",
  "API requests are hitting rate limits",
  "Need a two-factor reset for the billing owner",
  "Overnight data sync stalled",
  "Permission denied on the billing page",
  "Scheduled digest never arrived",
] as const;
const TICKET_CHANNELS: readonly TicketChannel[] = [
  "email",
  "chat",
  "phone",
];

export interface GeneratedLead {
  company: CrmCompany;
  lead: Lead;
  nextCursor: number;
}

function slug(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "").slice(0, 20);
}

export function generateLead(
  seed: number,
  cursor: number,
  sequence: number,
  gameMinute: GameMinute,
): GeneratedLead {
  const contactIndex = Math.max(0, sequence - 1);
  const firstName = FIRST_NAMES[(seed + contactIndex) % FIRST_NAMES.length];
  const lastName = LAST_NAMES[
    ((seed >>> 8) + Math.floor(contactIndex / FIRST_NAMES.length) +
      contactIndex % FIRST_NAMES.length * 17) % LAST_NAMES.length
  ];
  let currentCursor = cursor + 2;
  const prefixResult = pick(COMPANY_PREFIXES, seed, currentCursor);
  currentCursor = prefixResult.cursor;
  const suffixResult = pick(COMPANY_SUFFIXES, seed, currentCursor);
  currentCursor = suffixResult.cursor;
  const industryResult = pick(INDUSTRIES, seed, currentCursor);
  currentCursor = industryResult.cursor;
  const regionResult = pick(REGIONS, seed, currentCursor);
  currentCursor = regionResult.cursor;
  const roleResult = pick(ROLES, seed, currentCursor);
  currentCursor = roleResult.cursor;
  const employeeResult = randomInteger(seed, currentCursor, 12, 480);
  currentCursor = employeeResult.cursor;
  const fitResult = randomInteger(seed, currentCursor, 35, 95);
  currentCursor = fitResult.cursor;
  const engagementResult = randomInteger(seed, currentCursor, 25, 80);
  currentCursor = engagementResult.cursor;

  const companyId = `company_${sequence}`;
  const leadId = `lead_${sequence}`;
  const companyName = `${prefixResult.value} ${suffixResult.value}`;
  const emailDomain = `${slug(prefixResult.value)}${sequence}.example`;

  return {
    company: {
      id: companyId,
      name: companyName,
      industry: industryResult.value,
      employeeCount: employeeResult.value,
      region: regionResult.value,
      createdAt: gameMinute,
    },
    lead: {
      id: leadId,
      companyId,
      firstName,
      lastName,
      email: `${slug(firstName)}.${slug(lastName)}@${emailDomain}`,
      role: roleResult.value,
      source: "organic",
      fit: fitResult.value,
      engagement: engagementResult.value,
      status: "new",
      createdAt: gameMinute,
      lastActivityAt: gameMinute,
    },
    nextCursor: currentCursor,
  };
}

export function generateSupportIssue(
  seed: number,
  cursor: number,
  health: number,
  lifecycle: CustomerLifecycle,
): {
  title: string;
  channel: TicketChannel;
  priority: TicketPriority;
  nextCursor: number;
} {
  const title = pick(TICKET_TITLES, seed, cursor);
  const channel = pick(TICKET_CHANNELS, seed, title.cursor);
  const priorities: readonly TicketPriority[] =
    lifecycle === "at_risk" || health < 40
      ? ["high", "urgent"]
      : health < 65
      ? ["normal", "high"]
      : ["low", "normal"];
  const priority = pick(priorities, seed, channel.cursor);
  return {
    title: title.value,
    channel: channel.value,
    priority: priority.value,
    nextCursor: priority.cursor,
  };
}
