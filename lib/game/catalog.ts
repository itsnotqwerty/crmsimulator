import type { CrmCompany, GameMinute, Lead } from "./types.ts";
import { pick, randomInteger } from "./rng.ts";

const FIRST_NAMES = [
  "Avery",
  "Cameron",
  "Devon",
  "Jordan",
  "Morgan",
  "Riley",
  "Robin",
  "Taylor",
] as const;
const LAST_NAMES = [
  "Bennett",
  "Chen",
  "Diaz",
  "Ibrahim",
  "Keller",
  "Nakamura",
  "Okafor",
  "Singh",
] as const;
const COMPANY_PREFIXES = [
  "Beacon",
  "Clearwater",
  "Fieldstone",
  "Juniper",
  "Northstar",
  "Redwood",
  "Summit",
  "Westbridge",
] as const;
const COMPANY_SUFFIXES = [
  "Analytics",
  "Logistics",
  "Manufacturing",
  "Partners",
  "Systems",
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
  let currentCursor = cursor;
  const firstNameResult = pick(FIRST_NAMES, seed, currentCursor);
  currentCursor = firstNameResult.cursor;
  const lastNameResult = pick(LAST_NAMES, seed, currentCursor);
  currentCursor = lastNameResult.cursor;
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
      firstName: firstNameResult.value,
      lastName: lastNameResult.value,
      email: `${slug(firstNameResult.value)}.${
        slug(lastNameResult.value)
      }@${emailDomain}`,
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
