import { type GameState, SAVE_SCHEMA_VERSION } from "../game/types.ts";
import { parseGameState, SaveValidationError } from "./schema.ts";

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

  return parseGameState(current);
}
