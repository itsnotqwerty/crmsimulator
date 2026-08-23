import { type GameState, SAVE_SCHEMA_VERSION } from "../game/types.ts";
import { parseGameState, SaveValidationError } from "./schema.ts";
import { syncNarrative } from "../game/narrative.ts";

type Migration = (save: Record<string, unknown>) => Record<string, unknown>;

const MIGRATIONS: Readonly<Record<number, Migration>> = {
  2: (save) => ({
    ...save,
    sequences: {
      ...(save.sequences as Record<string, unknown>),
      campaign: 0,
    },
    records: {
      ...(save.records as Record<string, unknown>),
      campaigns: {},
    },
  }),
  3: (save) => ({
    ...save,
    history: {
      ...(save.history as Record<string, unknown>),
      campaignsArchived: 0,
      campaignSpendArchivedCents: 0,
      campaignLeadsArchived: 0,
    },
  }),
  4: (save) => {
    const records = save.records as Record<string, unknown>;
    const deals = records.deals as Record<string, Record<string, unknown>>;
    return {
      ...save,
      records: {
        ...records,
        deals: Object.fromEntries(
          Object.entries(deals).map(([id, deal]) => [
            id,
            {
              ...deal,
              product: Number(deal.monthlyValueCents) >= 52_500
                ? "scale"
                : Number(deal.monthlyValueCents) >= 35_000
                ? "growth"
                : "starter",
            },
          ]),
        ),
      },
    };
  },
  5: (save) => ({
    ...save,
    sequences: {
      ...(save.sequences as Record<string, unknown>),
      salesRep: 0,
    },
    records: {
      ...(save.records as Record<string, unknown>),
      salesReps: {},
    },
  }),
  6: (save) => ({
    ...save,
    sequences: {
      ...(save.sequences as Record<string, unknown>),
      quote: 0,
    },
    records: {
      ...(save.records as Record<string, unknown>),
      quotes: {},
    },
  }),
  7: (save) => {
    const records = save.records as Record<string, unknown>;
    const salesReps = records.salesReps as Record<
      string,
      Record<string, unknown>
    >;
    return {
      ...save,
      records: {
        ...records,
        salesReps: Object.fromEntries(
          Object.entries(salesReps).map(([id, rep]) => [
            id,
            { ...rep, burnout: 0 },
          ]),
        ),
      },
    };
  },
  8: (save) => ({
    ...save,
    preferences: {
      ...(save.preferences as Record<string, unknown>),
      pipelineView: "list",
    },
  }),
  9: (save) => {
    const records = save.records as Record<string, unknown>;
    const customers = records.customers as Record<
      string,
      Record<string, unknown>
    >;
    return {
      ...save,
      records: {
        ...records,
        customers: Object.fromEntries(
          Object.entries(customers).map(([id, customer]) => [
            id,
            {
              ...customer,
              adoption: 65,
              lifecycle: Number(customer.health) < 45 ? "at_risk" : "active",
              renewalAt: customer.nextBillingAt,
              lastSuccessAt: customer.startedAt,
              expansions: 0,
            },
          ]),
        ),
      },
    };
  },
  10: (save) => ({
    ...save,
    sequences: {
      ...(save.sequences as Record<string, unknown>),
      successRep: 0,
    },
    records: {
      ...(save.records as Record<string, unknown>),
      successReps: {},
    },
  }),
  11: (save) => ({
    ...save,
    sequences: {
      ...(save.sequences as Record<string, unknown>),
      ticket: 0,
    },
    records: {
      ...(save.records as Record<string, unknown>),
      tickets: {},
    },
  }),
  12: (save) => {
    const records = save.records as Record<string, unknown>;
    const tickets = records.tickets as Record<
      string,
      Record<string, unknown>
    >;
    return {
      ...save,
      sequences: {
        ...(save.sequences as Record<string, unknown>),
        supportRep: 0,
        incident: 0,
      },
      records: {
        ...records,
        tickets: Object.fromEntries(
          Object.entries(tickets).map(([id, ticket]) => {
            const { ownerId: _ownerId, ...unassigned } = ticket;
            return [id, { ...unassigned, escalated: false }];
          }),
        ),
        supportReps: {},
        incidents: {},
      },
    };
  },
  13: (save) => ({
    ...save,
    history: {
      ...(save.history as Record<string, unknown>),
      customersRenewed: 0,
      renewalMrrCents: 0,
      churnedMrrCents: 0,
      expansionMrrCents: 0,
      npsResponses: 0,
      npsScoreTotal: 0,
      ticketsResolved: 0,
      ticketsBreached: 0,
      ticketResolutionMinutes: 0,
      ticketsArchived: 0,
    },
  }),
  14: (save) => ({
    ...save,
    platform: {
      sequences: [],
      workflows: [],
      integrations: [],
      customFields: [],
      savedViews: [],
      dashboardWidgets: ["cash", "mrr", "pipeline", "retention"],
      duplicateReviews: 0,
      duplicatesMerged: 0,
      automationRunsArchived: 0,
      automationErrorsArchived: 0,
      departments: [],
      approvalThresholdCents: 100_000,
      auditEntriesArchived: 0,
      quarter: 1,
      growthTargetCents: 500_000,
      efficiencyTargetPercent: 70,
      retentionTargetPercent: 90,
      resilienceLevel: 0,
      endlessGoal: 1,
    },
  }),
  15: (save) => ({
    ...save,
    preferences: {
      ...(save.preferences as Record<string, unknown>),
      soundEnabled: false,
      musicEnabled: false,
    },
  }),
  16: (save) => ({
    ...save,
    preferences: {
      ...(save.preferences as Record<string, unknown>),
      musicVolume: 35,
    },
  }),
  17: (save) => {
    const records = save.records as Record<string, unknown>;
    const tickets = records.tickets as Record<
      string,
      Record<string, unknown>
    >;
    const history = save.history as Record<string, unknown>;
    const resolvedTickets =
      Object.values(tickets).filter((ticket) => ticket.status === "resolved")
        .length + Number(history.ticketsArchived ?? 0);
    return {
      ...save,
      history: {
        ...history,
        ticketsResolved: resolvedTickets,
        ...(resolvedTickets === 0 ? { ticketResolutionMinutes: 0 } : {}),
      },
      preferences: {
        ...(save.preferences as Record<string, unknown>),
        timeScale: 2,
      },
    };
  },
  18: (save) => ({
    ...save,
    narrative: {
      chapter: 0,
      pendingBriefing: true,
    },
  }),
  19: (save) => {
    const platform = { ...(save.platform as Record<string, unknown>) };
    delete platform.integrations;
    delete platform.customFields;
    delete platform.savedViews;
    delete platform.duplicateReviews;
    delete platform.duplicatesMerged;
    return { ...save, platform };
  },
  20: (save) => ({
    ...save,
    platform: {
      ...(save.platform as Record<string, unknown>),
      managers: [],
    },
  }),
};

export function migrateGameState(value: unknown): GameState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return parseGameState(value);
  }

  let current = { ...(value as Record<string, unknown>) };
  const startingVersion = current.schemaVersion;
  if (!Number.isInteger(startingVersion) || Number(startingVersion) < 1) {
    throw new SaveValidationError([{
      path: "schemaVersion",
      message: "Save schema version is missing or invalid",
    }]);
  }
  if (Number(startingVersion) > SAVE_SCHEMA_VERSION) {
    throw new SaveValidationError([{
      path: "schemaVersion",
      message: "Save was created by a newer version of the game",
    }]);
  }

  for (
    let version = Number(startingVersion);
    version < SAVE_SCHEMA_VERSION;
    version += 1
  ) {
    const migration = MIGRATIONS[version + 1];
    if (!migration) {
      throw new SaveValidationError([{
        path: "schemaVersion",
        message: `No migration exists from version ${version}`,
      }]);
    }
    current = migration(current);
    current.schemaVersion = version + 1;
  }

  return syncNarrative(parseGameState(current));
}
