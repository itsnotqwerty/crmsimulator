import type {
  DomainEvent,
  GameRules,
  GameState,
  ManagerDepartment,
  OperatingManager,
} from "./types.ts";

const REVIEW_INTERVAL_MINUTES = 24 * 60;
const REVIEWS_BEFORE_FIRING = 3;
const MARKETING_STAFF_COST_CENTS = 50_000;
const STAFF_NAMES = [
  "Amara Brooks",
  "Anika Patel",
  "Cameron Santos",
  "Darius Okafor",
  "Elena Rossi",
  "Elias Nguyen",
  "Fatima Haddad",
  "Gabriel Costa",
  "Hana Kim",
  "Imani Johnson",
  "Javier Alvarez",
  "Jordan Singh",
  "Kai Nakamura",
  "Leila Chen",
  "Lucia Garcia",
  "Mateo Diaz",
] as const;

const MID_SALES = {
  level: "mid" as const,
  monthlySalaryCents: 600_000,
  skill: 65,
  dealCapacity: 6,
};
const MID_SUCCESS = {
  level: "mid" as const,
  monthlySalaryCents: 650_000,
  skill: 65,
  accountCapacity: 12,
};
const MID_SUPPORT = {
  level: "mid" as const,
  monthlySalaryCents: 560_000,
  skill: 65,
  ticketCapacity: 10,
};

function staffName(state: GameState, sequence: number, offset: number): string {
  return STAFF_NAMES[(state.seed + sequence + offset) % STAFF_NAMES.length];
}

function updateManager(
  state: GameState,
  manager: OperatingManager,
  updates: Partial<OperatingManager>,
  audited = false,
): GameState {
  return {
    ...state,
    platform: {
      ...state.platform,
      managers: state.platform.managers.map((item) =>
        item.id === manager.id ? { ...item, ...updates } : item
      ),
      auditEntriesArchived: state.platform.auditEntriesArchived +
        (audited ? 1 : 0),
    },
  };
}

function demandAndCapacity(
  state: GameState,
  department: ManagerDepartment,
): { demand: number; capacity: number; headcount: number } {
  if (department === "sales") {
    const demand = Object.values(state.records.leads).filter((lead) =>
      ["new", "contacted", "cold"].includes(lead.status)
    ).length + Object.values(state.records.deals).filter((deal) =>
      deal.stage !== "won" && deal.stage !== "lost"
    ).length;
    const reps = Object.values(state.records.salesReps);
    return {
      demand,
      capacity: reps.reduce((total, rep) =>
        total + rep.dealCapacity, 0),
      headcount: reps.length,
    };
  }
  if (department === "customer_success") {
    const reps = Object.values(state.records.successReps);
    return {
      demand: Object.keys(state.records.customers).length,
      capacity: reps.reduce((total, rep) => total + rep.accountCapacity, 0),
      headcount: reps.length,
    };
  }
  if (department === "support") {
    const reps = Object.values(state.records.supportReps);
    return {
      demand: Object.values(state.records.tickets).filter((ticket) =>
        ticket.status !== "resolved"
      ).length,
      capacity: reps.reduce((total, rep) =>
        total + rep.ticketCapacity, 0),
      headcount: reps.length,
    };
  }
  const marketing = state.platform.departments.find((department) =>
    department.id === "department_marketing"
  );
  return {
    demand:
      Object.values(state.records.campaigns).filter((campaign) =>
        campaign.status === "active"
      ).length,
    capacity: (marketing?.headcount ?? 0) * 2,
    headcount: marketing?.headcount ?? 0,
  };
}

function hire(
  state: GameState,
  manager: OperatingManager,
  rules: GameRules,
): { state: GameState; event?: DomainEvent } {
  const gameMinute = state.clock.gameMinute;
  if (manager.department === "sales") {
    if (
      Object.keys(state.records.salesReps).length >= rules.maxSalesReps ||
      state.company.cashCents < MID_SALES.monthlySalaryCents
    ) return { state };
    const sequence = state.sequences.salesRep + 1;
    const id = `sales_rep_${sequence}`;
    const name = staffName(state, sequence, 0);
    return {
      state: {
        ...state,
        sequences: { ...state.sequences, salesRep: sequence },
        records: {
          ...state.records,
          salesReps: {
            ...state.records.salesReps,
            [id]: {
              id,
              name,
              ...MID_SALES,
              territory: "all",
              monthlyTargetCents: 1_500_000,
              burnout: 0,
              hiredAt: gameMinute,
            },
          },
        },
      },
      event: {
        kind: "sales_rep_hired",
        summary: `${manager.name} hired ${name} for Sales`,
        relatedId: id,
        gameMinute,
      },
    };
  }
  if (manager.department === "customer_success") {
    if (
      Object.keys(state.records.successReps).length >= rules.maxSuccessReps ||
      state.company.cashCents < MID_SUCCESS.monthlySalaryCents
    ) return { state };
    const sequence = state.sequences.successRep + 1;
    const id = `success_rep_${sequence}`;
    const name = staffName(state, sequence, 5);
    return {
      state: {
        ...state,
        sequences: { ...state.sequences, successRep: sequence },
        records: {
          ...state.records,
          successReps: {
            ...state.records.successReps,
            [id]: {
              id,
              name,
              ...MID_SUCCESS,
              burnout: 0,
              hiredAt: gameMinute,
            },
          },
        },
      },
      event: {
        kind: "success_rep_hired",
        summary: `${manager.name} hired ${name} for Customer Success`,
        relatedId: id,
        gameMinute,
      },
    };
  }
  if (manager.department === "support") {
    if (
      Object.keys(state.records.supportReps).length >= rules.maxSupportReps ||
      state.company.cashCents < MID_SUPPORT.monthlySalaryCents
    ) return { state };
    const sequence = state.sequences.supportRep + 1;
    const id = `support_rep_${sequence}`;
    const name = staffName(state, sequence, 10);
    return {
      state: {
        ...state,
        sequences: { ...state.sequences, supportRep: sequence },
        records: {
          ...state.records,
          supportReps: {
            ...state.records.supportReps,
            [id]: {
              id,
              name,
              ...MID_SUPPORT,
              burnout: 0,
              hiredAt: gameMinute,
            },
          },
        },
      },
      event: {
        kind: "support_rep_hired",
        summary: `${manager.name} hired ${name} for Support`,
        relatedId: id,
        gameMinute,
      },
    };
  }
  const department = state.platform.departments.find((item) =>
    item.id === "department_marketing"
  );
  if (
    !department || department.headcount >= department.headcountPlan ||
    state.company.cashCents < MARKETING_STAFF_COST_CENTS
  ) return { state };
  return {
    state: {
      ...state,
      company: {
        ...state.company,
        cashCents: state.company.cashCents - MARKETING_STAFF_COST_CENTS,
      },
      platform: {
        ...state.platform,
        departments: state.platform.departments.map((item) =>
          item.id === department.id
            ? { ...item, headcount: item.headcount + 1 }
            : item
        ),
      },
    },
    event: {
      kind: "task_completed",
      summary: `${manager.name} added a Marketing specialist`,
      relatedId: department.id,
      gameMinute,
    },
  };
}

function fire(
  state: GameState,
  manager: OperatingManager,
): { state: GameState; event?: DomainEvent } {
  const gameMinute = state.clock.gameMinute;
  if (manager.department === "sales") {
    const rep = Object.values(state.records.salesReps).sort((a, b) =>
      b.hiredAt - a.hiredAt || b.id.localeCompare(a.id)
    )[0];
    if (!rep) {
      return { state };
    }
    const salesReps = { ...state.records.salesReps };
    delete salesReps[rep.id];
    const leads = Object.fromEntries(
      Object.entries(state.records.leads).map(
        ([id, lead]) => {
          if (lead.ownerId !== rep.id) {
            return [id, lead];
          }
          const updated = { ...lead };
          delete updated.ownerId;
          return [id, updated];
        },
      ),
    );
    const deals = Object.fromEntries(
      Object.entries(state.records.deals).map(
        ([id, deal]) => {
          if (deal.ownerId !== rep.id) {
            return [id, deal];
          }
          const updated = { ...deal, updatedAt: gameMinute };
          delete updated.ownerId;
          return [id, updated];
        },
      ),
    );
    return {
      state: {
        ...state,
        records: { ...state.records, salesReps, leads, deals },
      },
      event: {
        kind: "sales_rep_fired",
        summary: `${manager.name} reduced Sales headcount; ${rep.name} left`,
        relatedId: rep.id,
        gameMinute,
      },
    };
  }
  if (manager.department === "customer_success") {
    const rep = Object.values(state.records.successReps).sort((a, b) =>
      b.hiredAt - a.hiredAt || b.id.localeCompare(a.id)
    )[0];
    if (!rep) {
      return { state };
    }
    const successReps = { ...state.records.successReps };
    delete successReps[rep.id];
    const customers = Object.fromEntries(
      Object.entries(state.records.customers).map(([id, customer]) => {
        if (customer.ownerId !== rep.id) {
          return [id, customer];
        }
        const updated = { ...customer };
        delete updated.ownerId;
        return [id, updated];
      }),
    );
    return {
      state: {
        ...state,
        records: { ...state.records, successReps, customers },
      },
      event: {
        kind: "success_rep_fired",
        summary:
          `${manager.name} reduced Customer Success headcount; ${rep.name} left`,
        relatedId: rep.id,
        gameMinute,
      },
    };
  }
  if (manager.department === "support") {
    const rep = Object.values(state.records.supportReps).sort((a, b) =>
      b.hiredAt - a.hiredAt || b.id.localeCompare(a.id)
    )[0];
    if (!rep) {
      return { state };
    }
    const supportReps = { ...state.records.supportReps };
    delete supportReps[rep.id];
    const tickets = Object.fromEntries(
      Object.entries(state.records.tickets).map(([id, ticket]) => {
        if (ticket.ownerId !== rep.id) {
          return [id, ticket];
        }
        const updated = { ...ticket };
        delete updated.ownerId;
        return [id, updated];
      }),
    );
    return {
      state: {
        ...state,
        records: { ...state.records, supportReps, tickets },
      },
      event: {
        kind: "support_rep_fired",
        summary: `${manager.name} reduced Support headcount; ${rep.name} left`,
        relatedId: rep.id,
        gameMinute,
      },
    };
  }
  const department = state.platform.departments.find((item) =>
    item.id === "department_marketing"
  );
  if (!department || department.headcount === 0) return { state };
  return {
    state: {
      ...state,
      platform: {
        ...state.platform,
        departments: state.platform.departments.map((item) =>
          item.id === department.id
            ? { ...item, headcount: item.headcount - 1 }
            : item
        ),
      },
    },
    event: {
      kind: "task_completed",
      summary: `${manager.name} reduced Marketing headcount`,
      relatedId: department.id,
      gameMinute,
    },
  };
}

export function applyManagerDecisions(
  state: GameState,
  rules: GameRules,
): { state: GameState; events: DomainEvent[] } {
  let current = state;
  const events: DomainEvent[] = [];
  const managers = [...state.platform.managers].sort((a, b) =>
    a.department.localeCompare(b.department)
  );
  for (const original of managers) {
    const manager = current.platform.managers.find((item) =>
      item.id === original.id
    );
    if (
      !manager ||
      current.clock.gameMinute - manager.lastReviewedAt <
        REVIEW_INTERVAL_MINUTES
    ) continue;
    const workload = demandAndCapacity(current, manager.department);
    if (workload.demand > workload.capacity) {
      const result = hire(current, manager, rules);
      if (result.event) {
        current = updateManager(result.state, manager, {
          lastReviewedAt: current.clock.gameMinute,
          underCapacityReviews: 0,
          lastDecision: result.event.summary,
        }, true);
        events.push(result.event);
        continue;
      }
    }
    const underCapacity = workload.headcount > 1 &&
      workload.demand * 2 < workload.capacity;
    const underCapacityReviews = underCapacity
      ? manager.underCapacityReviews + 1
      : 0;
    if (underCapacityReviews >= REVIEWS_BEFORE_FIRING) {
      const result = fire(current, manager);
      if (result.event) {
        current = updateManager(result.state, manager, {
          lastReviewedAt: current.clock.gameMinute,
          underCapacityReviews: 0,
          lastDecision: result.event.summary,
        }, true);
        events.push(result.event);
        continue;
      }
    }
    current = updateManager(current, manager, {
      lastReviewedAt: current.clock.gameMinute,
      underCapacityReviews,
      lastDecision: underCapacity
        ? "Monitoring excess capacity"
        : "Staffing held steady",
    });
  }
  return { state: current, events };
}
