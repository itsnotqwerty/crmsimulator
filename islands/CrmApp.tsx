import { useSignal } from "@preact/signals";
import {
  Activity,
  Archive,
  ArrowUpDown,
  BarChart3,
  Bell,
  Building2,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Columns3,
  Copy,
  Download,
  FileText,
  Gauge,
  GraduationCap,
  Inbox,
  LayoutDashboard,
  List,
  LockKeyhole,
  Mail,
  Menu,
  MoreHorizontal,
  Pencil,
  Phone,
  RefreshCw,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Target,
  Upload,
  Users,
  X,
} from "lucide-preact";
import type { JSX } from "preact";
import { useGameStore } from "../lib/client/gameStore.ts";
import { campaignSaturation } from "../lib/game/simulation.ts";
import type {
  AdvanceSummary,
  BillingCycle,
  CampaignAudience,
  CampaignChannel,
  Deal,
  DealLossReason,
  DealProduct,
  GameCommand,
  GameState,
  Lead,
  SalesRepLevel,
  SalesTerritory,
  Task,
} from "../lib/game/types.ts";
import { DEFAULT_RULES } from "../lib/game/state.ts";
import type { LoadStatus } from "../lib/server/root.ts";

type View =
  | "dashboard"
  | "leads"
  | "contacts"
  | "companies"
  | "tasks"
  | "marketing"
  | "pipeline"
  | "settings";

export interface CrmAppProps {
  initial: GameState;
  loadStatus: LoadStatus;
  offlineSummary?: AdvanceSummary;
  loadError?: string;
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function gameDate(gameMinute: number): string {
  const day = Math.floor(gameMinute / (24 * 60)) + 1;
  const minutes = gameMinute % (24 * 60);
  const hour = Math.floor(minutes / 60);
  return `Day ${day}, ${String(hour).padStart(2, "0")}:${
    String(minutes % 60).padStart(2, "0")
  }`;
}

function relativeGameTime(target: number, current: number): string {
  const difference = target - current;
  const absolute = Math.abs(difference);
  const unit = absolute >= 24 * 60
    ? `${Math.floor(absolute / (24 * 60))}d`
    : absolute >= 60
    ? `${Math.floor(absolute / 60)}h`
    : `${absolute}m`;
  return difference < 0 ? `${unit} overdue` : `in ${unit}`;
}

function statusLabel(value: string): string {
  return value.replaceAll("_", " ").replace(
    /^./,
    (letter) => letter.toUpperCase(),
  );
}

function initials(value: string): string {
  return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "")
    .join("").toUpperCase();
}

function Kpi(props: {
  label: string;
  value: string;
  detail: string;
  icon: JSX.Element;
  tone?: "positive" | "warning";
}) {
  return (
    <div class="kpi">
      <div class={`kpi-icon ${props.tone ?? ""}`}>{props.icon}</div>
      <div>
        <span>{props.label}</span>
        <strong>{props.value}</strong>
        <small>{props.detail}</small>
      </div>
    </div>
  );
}

function EmptyState(props: { title: string; detail: string }) {
  return (
    <div class="empty-state">
      <Target size={28} />
      <strong>{props.title}</strong>
      <span>{props.detail}</span>
    </div>
  );
}

const PIPELINE_STAGES = [
  "qualified",
  "discovery",
  "evaluation",
  "negotiation",
] as const;

function PipelineWorkspace(props: {
  game: GameState;
  currentMinute: number;
  mode: "list" | "board";
  onModeChange: (mode: "list" | "board") => void;
  dispatch: (command: GameCommand) => void;
}) {
  const editingDealId = useSignal<string | undefined>(undefined);
  const editProduct = useSignal<DealProduct>("growth");
  const editValue = useSignal("500");
  const editCloseDays = useSignal("14");
  const lossReason = useSignal<DealLossReason>("budget");
  const repName = useSignal("");
  const repLevel = useSignal<SalesRepLevel>("junior");
  const repTerritory = useSignal<SalesTerritory>("all");
  const repTarget = useSignal("15000");
  const quoteDealId = useSignal("");
  const quoteProduct = useSignal<DealProduct>("growth");
  const quoteBilling = useSignal<BillingCycle>("monthly");
  const quoteSeats = useSignal("10");
  const quoteDiscount = useSignal("0");
  const quoteValidDays = useSignal("14");
  const selectedDeals = useSignal<Set<string>>(new Set());
  const bulkOwner = useSignal("");
  const deals = Object.values(props.game.records.deals).sort((a, b) =>
    b.updatedAt - a.updatedAt
  );
  const openDeals = deals.filter((deal) =>
    deal.stage !== "won" && deal.stage !== "lost"
  );
  const salesReps = Object.values(props.game.records.salesReps).sort((a, b) =>
    a.hiredAt - b.hiredAt
  );
  const quotes = Object.values(props.game.records.quotes).sort((a, b) =>
    b.updatedAt - a.updatedAt
  );
  const monthlyPayrollCents = salesReps.reduce(
    (total, rep) => total + rep.monthlySalaryCents,
    0,
  );
  const pipelineCents = openDeals.reduce(
    (total, deal) => total + deal.monthlyValueCents,
    0,
  );
  const weightedCents = openDeals.reduce(
    (total, deal) => total + deal.monthlyValueCents * deal.probability / 100,
    0,
  );
  const closingSoon =
    openDeals.filter((deal) =>
      deal.expectedCloseAt <= props.currentMinute + 7 * 24 * 60
    ).length;
  const averageAge = openDeals.length > 0
    ? Math.floor(
      openDeals.reduce(
        (total, deal) => total + props.currentMinute - deal.updatedAt,
        0,
      ) / openDeals.length / (24 * 60),
    )
    : 0;
  const detail = (deal: Deal) => {
    const lead = props.game.records.leads[deal.leadId];
    const company = props.game.records.companies[deal.companyId];
    return { lead, company };
  };
  const editingDeal = editingDealId.value
    ? props.game.records.deals[editingDealId.value]
    : undefined;
  const beginEdit = (deal: Deal) => {
    editingDealId.value = deal.id;
    editProduct.value = deal.product;
    editValue.value = String(deal.monthlyValueCents / 100);
    editCloseDays.value = String(
      Math.max(
        1,
        Math.ceil((deal.expectedCloseAt - props.currentMinute) / (24 * 60)),
      ),
    );
    lossReason.value = "budget";
  };
  const submitDeal = (event: SubmitEvent) => {
    event.preventDefault();
    if (!editingDeal) return;
    props.dispatch({
      type: "update_deal",
      dealId: editingDeal.id,
      product: editProduct.value,
      monthlyValueCents: Math.round(Number(editValue.value) * 100),
      expectedCloseInDays: Number(editCloseDays.value),
    });
    editingDealId.value = undefined;
  };
  const closeLost = () => {
    if (!editingDeal) return;
    props.dispatch({
      type: "lose_deal",
      dealId: editingDeal.id,
      reason: lossReason.value,
    });
    editingDealId.value = undefined;
  };
  const hireRep = (event: SubmitEvent) => {
    event.preventDefault();
    props.dispatch({
      type: "hire_sales_rep",
      name: repName.value,
      level: repLevel.value,
      territory: repTerritory.value,
      monthlyTargetCents: Math.round(Number(repTarget.value) * 100),
    });
    repName.value = "";
  };
  const createQuote = (event: SubmitEvent) => {
    event.preventDefault();
    if (!quoteDealId.value) return;
    props.dispatch({
      type: "create_quote",
      dealId: quoteDealId.value,
      product: quoteProduct.value,
      billingCycle: quoteBilling.value,
      seats: Number(quoteSeats.value),
      discountPercent: Number(quoteDiscount.value),
      validDays: Number(quoteValidDays.value),
    });
  };
  const toggleDeal = (dealId: string) => {
    const next = new Set(selectedDeals.value);
    if (next.has(dealId)) next.delete(dealId);
    else next.add(dealId);
    selectedDeals.value = next;
  };
  const clearSelection = () => selectedDeals.value = new Set();

  return (
    <>
      <div class="page-heading">
        <div>
          <span>Sales operations</span>
          <h1>Pipeline</h1>
          <p>Manage deal progression and forecast recurring revenue.</p>
        </div>
        <div class="segmented-control" aria-label="Pipeline view">
          <button
            type="button"
            class={props.mode === "list" ? "active" : ""}
            aria-pressed={props.mode === "list"}
            onClick={() => props.onModeChange("list")}
          >
            <List size={16} />List
          </button>
          <button
            type="button"
            class={props.mode === "board" ? "active" : ""}
            aria-pressed={props.mode === "board"}
            onClick={() => props.onModeChange("board")}
          >
            <Columns3 size={16} />Board
          </button>
        </div>
      </div>
      <div class="pipeline-summary" aria-label="Pipeline forecast">
        <div>
          <span>Open pipeline</span>
          <strong>{money.format(pipelineCents / 100)}</strong>
        </div>
        <div>
          <span>Weighted pipeline</span>
          <strong>{money.format(weightedCents / 100)}</strong>
        </div>
        <div>
          <span>Forecast MRR</span>
          <strong>
            {money.format((props.game.company.mrrCents + weightedCents) / 100)}
          </strong>
        </div>
        <div>
          <span>Closing in 7 days</span>
          <strong>{closingSoon}</strong>
        </div>
        <div>
          <span>Average stage age</span>
          <strong>{averageAge}d</strong>
        </div>
      </div>
      <section class="panel sales-team-panel">
        <div class="panel-heading">
          <div>
            <h2>Sales team</h2>
            <span>
              {salesReps.length} representatives ·{" "}
              {money.format(monthlyPayrollCents / 100)} monthly payroll
            </span>
          </div>
          <button
            type="button"
            class="secondary"
            disabled={salesReps.length === 0}
            onClick={() => props.dispatch({ type: "route_leads" })}
          >
            <ArrowUpDown size={16} />Route leads
          </button>
        </div>
        <form class="hire-rep-form" onSubmit={hireRep}>
          <label>
            <span>Representative name</span>
            <input
              value={repName.value}
              minLength={2}
              maxLength={60}
              required
              placeholder="e.g. Avery Chen"
              onInput={(event) => repName.value = event.currentTarget.value}
            />
          </label>
          <label>
            <span>Experience</span>
            <select
              value={repLevel.value}
              onChange={(event) =>
                repLevel.value = event.currentTarget.value as SalesRepLevel}
            >
              <option value="junior">Junior · $3,000/mo</option>
              <option value="mid">Mid-level · $6,000/mo</option>
              <option value="senior">Senior · $10,000/mo</option>
            </select>
          </label>
          <label>
            <span>Territory</span>
            <select
              value={repTerritory.value}
              onChange={(event) =>
                repTerritory.value = event.currentTarget
                  .value as SalesTerritory}
            >
              <option value="all">All regions</option>
              <option value="North America">North America</option>
              <option value="Europe">Europe</option>
              <option value="Asia Pacific">Asia Pacific</option>
            </select>
          </label>
          <label>
            <span>Monthly target</span>
            <input
              type="number"
              min="1000"
              max="50000"
              step="500"
              required
              value={repTarget.value}
              onInput={(event) => repTarget.value = event.currentTarget.value}
            />
          </label>
          <button
            type="submit"
            class="primary"
            disabled={salesReps.length >= DEFAULT_RULES.maxSalesReps}
          >
            <Users size={16} />Hire rep
          </button>
        </form>
        {salesReps.length > 0 && (
          <div class="sales-team-list">
            {salesReps.map((rep) => {
              const ownedDeals = openDeals.filter((deal) =>
                deal.ownerId === rep.id
              );
              const ownedLeads = Object.values(props.game.records.leads).filter(
                (lead) =>
                  lead.ownerId === rep.id &&
                  ["new", "contacted", "cold"].includes(lead.status),
              );
              const workload = ownedDeals.length + ownedLeads.length;
              const weightedOwnedCents = ownedDeals.reduce(
                (total, deal) =>
                  total + deal.monthlyValueCents * deal.probability / 100,
                0,
              );
              return (
                <div>
                  <span class="rep-avatar">{initials(rep.name)}</span>
                  <span>
                    <strong>{rep.name}</strong>
                    <small>{statusLabel(rep.level)} representative</small>
                    <small>
                      {rep.territory === "all" ? "All regions" : rep.territory}
                    </small>
                  </span>
                  <dl>
                    <div>
                      <dt>Skill</dt>
                      <dd>{rep.skill}</dd>
                    </div>
                    <div>
                      <dt>Workload</dt>
                      <dd
                        class={workload > rep.dealCapacity ? "overloaded" : ""}
                      >
                        {workload}/{rep.dealCapacity}
                      </dd>
                    </div>
                    <div>
                      <dt>Target coverage</dt>
                      <dd>
                        {Math.round(
                          weightedOwnedCents / rep.monthlyTargetCents * 100,
                        )}%
                      </dd>
                    </div>
                    <div>
                      <dt>Burnout</dt>
                      <dd class={rep.burnout >= 60 ? "overloaded" : ""}>
                        {rep.burnout}%
                      </dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    class="secondary rep-training"
                    onClick={() =>
                      props.dispatch({
                        type: "train_sales_rep",
                        salesRepId: rep.id,
                      })}
                  >
                    <GraduationCap size={15} />Train · $1,000
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
      <section class="panel quotes-panel">
        <div class="panel-heading">
          <div>
            <h2>Quotes</h2>
            <span>Build subscription terms and close negotiated deals</span>
          </div>
          <span class="record-count">{quotes.length} records</span>
        </div>
        <form class="quote-form" onSubmit={createQuote}>
          <label>
            <span>Deal</span>
            <select
              required
              value={quoteDealId.value}
              onChange={(event) =>
                quoteDealId.value = event.currentTarget.value}
            >
              <option value="">Select a deal</option>
              {openDeals.map((deal) => (
                <option value={deal.id}>
                  {detail(deal).company?.name ?? "Unknown company"} ·{" "}
                  {statusLabel(deal.stage)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Plan</span>
            <select
              value={quoteProduct.value}
              onChange={(event) =>
                quoteProduct.value = event.currentTarget.value as DealProduct}
            >
              <option value="starter">Starter · $200 + $10/seat</option>
              <option value="growth">Growth · $450 + $15/seat</option>
              <option value="scale">Scale · $800 + $25/seat</option>
            </select>
          </label>
          <label>
            <span>Billing</span>
            <select
              value={quoteBilling.value}
              onChange={(event) =>
                quoteBilling.value = event.currentTarget.value as BillingCycle}
            >
              <option value="monthly">Monthly</option>
              <option value="annual">Annual · 10% savings</option>
            </select>
          </label>
          <label>
            <span>Seats</span>
            <input
              type="number"
              min="1"
              max="500"
              required
              value={quoteSeats.value}
              onInput={(event) => quoteSeats.value = event.currentTarget.value}
            />
          </label>
          <label>
            <span>Discount</span>
            <input
              type="number"
              min="0"
              max="30"
              required
              value={quoteDiscount.value}
              onInput={(event) =>
                quoteDiscount.value = event.currentTarget.value}
            />
          </label>
          <label>
            <span>Valid days</span>
            <input
              type="number"
              min="1"
              max="30"
              required
              value={quoteValidDays.value}
              onInput={(event) =>
                quoteValidDays.value = event.currentTarget.value}
            />
          </label>
          <button type="submit" class="primary">
            <FileText size={16} />Create quote
          </button>
        </form>
        {quotes.length > 0 && (
          <div class="quote-list">
            {quotes.map((quote) => {
              const deal = props.game.records.deals[quote.dealId];
              const company = deal
                ? props.game.records.companies[deal.companyId]
                : undefined;
              return (
                <div class="quote-row">
                  <span>
                    <strong>{company?.name ?? "Unknown company"}</strong>
                    <small>
                      {statusLabel(quote.product)} · {quote.seats} seats ·{" "}
                      {statusLabel(quote.billingCycle)}
                    </small>
                  </span>
                  <strong>
                    {money.format(quote.monthlyValueCents / 100)} MRR
                  </strong>
                  <span class={`status ${quote.status}`}>
                    {statusLabel(quote.status)}
                  </span>
                  <div class="quote-actions">
                    {quote.status === "draft" && (
                      <button
                        type="button"
                        class="secondary"
                        onClick={() =>
                          props.dispatch({
                            type: "set_quote_status",
                            quoteId: quote.id,
                            status: "sent",
                          })}
                      >
                        <Send size={15} />Send
                      </button>
                    )}
                    {quote.status === "sent" && (
                      <button
                        type="button"
                        class="primary"
                        disabled={deal?.stage !== "negotiation"}
                        title={deal?.stage === "negotiation"
                          ? "Accept quote"
                          : "Advance deal to negotiation first"}
                        onClick={() =>
                          props.dispatch({
                            type: "accept_quote",
                            quoteId: quote.id,
                          })}
                      >
                        <Check size={15} />Accept
                      </button>
                    )}
                    {(quote.status === "draft" || quote.status === "sent") && (
                      <button
                        type="button"
                        class="secondary"
                        onClick={() =>
                          props.dispatch({
                            type: "set_quote_status",
                            quoteId: quote.id,
                            status: "expired",
                          })}
                      >
                        Expire
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      {editingDeal && (
        <section class="panel deal-editor">
          <div class="panel-heading">
            <div>
              <h2>Edit {detail(editingDeal).company?.name ?? "deal"}</h2>
              <span>Update terms or record a closed-lost outcome</span>
            </div>
            <button
              type="button"
              class="icon-button"
              aria-label="Close deal editor"
              onClick={() => editingDealId.value = undefined}
            >
              <X size={17} />
            </button>
          </div>
          <form onSubmit={submitDeal}>
            <label>
              <span>Owner</span>
              <select
                value={editingDeal.ownerId ?? ""}
                onChange={(event) =>
                  props.dispatch({
                    type: "assign_deal",
                    dealId: editingDeal.id,
                    ownerId: event.currentTarget.value || undefined,
                  })}
              >
                <option value="">Founder</option>
                {salesReps.map((rep) => (
                  <option value={rep.id}>{rep.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Product</span>
              <select
                value={editProduct.value}
                onChange={(event) =>
                  editProduct.value = event.currentTarget.value as DealProduct}
              >
                <option value="starter">Starter</option>
                <option value="growth">Growth</option>
                <option value="scale">Scale</option>
              </select>
            </label>
            <label>
              <span>Monthly value</span>
              <input
                type="number"
                min="100"
                max="5000"
                step="25"
                required
                value={editValue.value}
                onInput={(event) => editValue.value = event.currentTarget.value}
              />
            </label>
            <label>
              <span>Expected close (days)</span>
              <input
                type="number"
                min="1"
                max="90"
                required
                value={editCloseDays.value}
                onInput={(event) =>
                  editCloseDays.value = event.currentTarget.value}
              />
            </label>
            <button type="submit" class="primary">
              <Check size={16} />Save deal
            </button>
          </form>
          <div class="deal-loss-controls">
            <label>
              <span>Loss reason</span>
              <select
                value={lossReason.value}
                onChange={(event) =>
                  lossReason.value = event.currentTarget
                    .value as DealLossReason}
              >
                <option value="budget">Budget</option>
                <option value="timing">Timing</option>
                <option value="competition">Competition</option>
                <option value="no_decision">No decision</option>
                <option value="poor_fit">Poor fit</option>
              </select>
            </label>
            <button type="button" class="danger-button" onClick={closeLost}>
              <X size={16} />Close as lost
            </button>
          </div>
        </section>
      )}
      {openDeals.length === 0
        ? (
          <div class="panel">
            <EmptyState
              title="No open deals"
              detail="Qualify contacted leads to create pipeline records."
            />
          </div>
        )
        : props.mode === "list"
        ? (
          <div class="panel table-panel">
            <div class="table-toolbar">
              <strong>
                {selectedDeals.value.size || openDeals.length}{" "}
                {selectedDeals.value.size ? "selected" : "open deals"}
              </strong>
              {selectedDeals.value.size > 0
                ? (
                  <div class="bulk-actions">
                    <select
                      aria-label="Bulk deal owner"
                      value={bulkOwner.value}
                      onChange={(event) =>
                        bulkOwner.value = event.currentTarget.value}
                    >
                      <option value="">Founder</option>
                      {salesReps.map((rep) => (
                        <option value={rep.id}>{rep.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      class="secondary"
                      onClick={() => {
                        props.dispatch({
                          type: "bulk_assign_deals",
                          dealIds: [...selectedDeals.value],
                          ownerId: bulkOwner.value || undefined,
                        });
                        clearSelection();
                      }}
                    >
                      <Users size={15} />Assign
                    </button>
                    <button
                      type="button"
                      class="primary"
                      onClick={() => {
                        props.dispatch({
                          type: "bulk_advance_deals",
                          dealIds: [...selectedDeals.value],
                        });
                        clearSelection();
                      }}
                    >
                      Advance <ChevronRight size={15} />
                    </button>
                  </div>
                )
                : <span>Forecast derived from current probabilities</span>}
            </div>
            <div class="table-scroll">
              <table class="pipeline-table">
                <thead>
                  <tr>
                    <th aria-label="Select deals"></th>
                    <th>Deal</th>
                    <th>Stage</th>
                    <th>Product</th>
                    <th>Owner</th>
                    <th>Value</th>
                    <th>Probability</th>
                    <th>Stage age</th>
                    <th>Expected close</th>
                    <th aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {openDeals.map((deal) => {
                    const { lead, company } = detail(deal);
                    return (
                      <tr>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${company?.name ?? "deal"}`}
                            checked={selectedDeals.value.has(deal.id)}
                            onChange={() => toggleDeal(deal.id)}
                          />
                        </td>
                        <td>
                          <strong>{company?.name ?? "Unknown company"}</strong>
                          <small>
                            {lead
                              ? `${lead.firstName} ${lead.lastName}`
                              : "Unknown contact"}
                          </small>
                        </td>
                        <td>
                          <span class={`status ${deal.stage}`}>
                            {statusLabel(deal.stage)}
                          </span>
                        </td>
                        <td>{statusLabel(deal.product)}</td>
                        <td>
                          {deal.ownerId
                            ? props.game.records.salesReps[deal.ownerId]
                              ?.name ?? "Unknown"
                            : "Founder"}
                        </td>
                        <td>
                          {money.format(deal.monthlyValueCents / 100)} MRR
                        </td>
                        <td>{deal.probability}%</td>
                        <td>
                          {relativeGameTime(deal.updatedAt, props.currentMinute)
                            .replace(" overdue", "")}
                        </td>
                        <td>
                          {relativeGameTime(
                            deal.expectedCloseAt,
                            props.currentMinute,
                          )}
                        </td>
                        <td>
                          <div class="pipeline-row-actions">
                            <button
                              type="button"
                              class="icon-button"
                              aria-label={`Edit ${company?.name ?? "deal"}`}
                              onClick={() => beginEdit(deal)}
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              type="button"
                              class="secondary pipeline-advance"
                              onClick={() =>
                                props.dispatch({
                                  type: "advance_deal",
                                  dealId: deal.id,
                                })}
                            >
                              Advance <ChevronRight size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
        : (
          <div class="pipeline-board" aria-label="Deal stage board">
            {PIPELINE_STAGES.map((stage) => {
              const stageDeals = openDeals.filter((deal) =>
                deal.stage === stage
              );
              const stageValue = stageDeals.reduce(
                (total, deal) => total + deal.monthlyValueCents,
                0,
              );
              return (
                <section
                  class="pipeline-column"
                  aria-label={statusLabel(stage)}
                >
                  <header>
                    <div>
                      <strong>{statusLabel(stage)}</strong>
                      <span>{stageDeals.length}</span>
                    </div>
                    <small>{money.format(stageValue / 100)} MRR</small>
                  </header>
                  <div>
                    {stageDeals.map((deal) => {
                      const { lead, company } = detail(deal);
                      return (
                        <article class="pipeline-card">
                          <div>
                            <strong>
                              {company?.name ?? "Unknown company"}
                            </strong>
                            <span>{deal.probability}%</span>
                          </div>
                          <p>
                            {lead
                              ? `${lead.firstName} ${lead.lastName}`
                              : "Unknown contact"}
                          </p>
                          <span class="product-label">
                            {statusLabel(deal.product)}
                          </span>
                          <span class="deal-owner">
                            {deal.ownerId
                              ? props.game.records.salesReps[deal.ownerId]
                                ?.name ?? "Unknown"
                              : "Founder owned"}
                          </span>
                          <b>
                            {money.format(deal.monthlyValueCents / 100)} MRR
                          </b>
                          <dl>
                            <div>
                              <dt>Stage age</dt>
                              <dd>
                                {relativeGameTime(
                                  deal.updatedAt,
                                  props.currentMinute,
                                ).replace(" overdue", "")}
                              </dd>
                            </div>
                            <div>
                              <dt>Close</dt>
                              <dd>
                                {relativeGameTime(
                                  deal.expectedCloseAt,
                                  props.currentMinute,
                                )}
                              </dd>
                            </div>
                          </dl>
                          <div class="pipeline-card-actions">
                            <button
                              type="button"
                              class="icon-button"
                              aria-label={`Edit ${company?.name ?? "deal"}`}
                              onClick={() => beginEdit(deal)}
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              type="button"
                              class="secondary"
                              onClick={() =>
                                props.dispatch({
                                  type: "advance_deal",
                                  dealId: deal.id,
                                })}
                            >
                              Advance <ChevronRight size={15} />
                            </button>
                          </div>
                        </article>
                      );
                    })}
                    {stageDeals.length === 0 && (
                      <span class="column-empty">No deals</span>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
    </>
  );
}

export default function CrmApp(props: CrmAppProps) {
  const store = useGameStore(props.initial);
  const view = useSignal<View>(
    props.loadStatus === "new" ? "leads" : "dashboard",
  );
  const selectedLeadId = useSignal<string | undefined>(
    Object.keys(props.initial.records.leads)[0],
  );
  const selectedCompanyId = useSignal<string | undefined>(
    Object.keys(props.initial.records.companies)[0],
  );
  const companyName = useSignal(props.initial.company.name);
  const campaignName = useSignal("");
  const campaignChannel = useSignal<CampaignChannel>("email");
  const campaignAudience = useSignal<CampaignAudience>("mid_market");
  const campaignBudget = useSignal("50");
  const campaignDuration = useSignal("7");
  const campaignMessage = useSignal("");
  const editingCampaignId = useSignal<string | undefined>(undefined);
  const searchQuery = useSignal("");
  const leadFilter = useSignal("all");
  const leadSort = useSignal("newest");
  const showLeadFilters = useSignal(false);
  const showNotifications = useSignal(false);
  const showCompanyMenu = useSignal(false);
  const mobileNav = useSignal(false);
  const showOffline = useSignal(
    props.loadStatus === "offline" || props.loadStatus === "crisis",
  );
  const showCorrupt = useSignal(props.loadStatus === "corrupt");
  const confirmReset = useSignal(false);
  const game = store.game.value;
  const leads = Object.values(game.records.leads).sort((a, b) =>
    b.createdAt - a.createdAt
  );
  const companies = Object.values(game.records.companies).sort((a, b) =>
    b.createdAt - a.createdAt
  );
  const openTasks = Object.values(game.records.tasks).filter((task) =>
    task.status === "open"
  );
  const selectedLead = selectedLeadId.value
    ? game.records.leads[selectedLeadId.value]
    : undefined;
  const selectedCompany = selectedCompanyId.value
    ? game.records.companies[selectedCompanyId.value]
    : undefined;
  const normalizedQuery = searchQuery.value.trim().toLowerCase();
  const searchResults = normalizedQuery
    ? leads.filter((lead) => {
      const company = game.records.companies[lead.companyId];
      return [
        lead.firstName,
        lead.lastName,
        lead.email,
        lead.role,
        company?.name,
        company?.industry,
      ].some((value) => value?.toLowerCase().includes(normalizedQuery));
    }).slice(0, 6)
    : [];
  const filteredLeads = leads.filter((lead) =>
    leadFilter.value === "all" || lead.status === leadFilter.value
  ).sort((a, b) => {
    if (leadSort.value === "fit") return b.fit - a.fit;
    if (leadSort.value === "intent") return b.engagement - a.engagement;
    return b.createdAt - a.createdAt;
  });
  const marketingUnlocked = game.unlocks.includes("marketing");
  const pipelineUnlocked = game.unlocks.includes("pipeline");
  const referralLeads = leads.filter((lead) => lead.source === "referral");
  const allCampaigns = Object.values(game.records.campaigns).sort((a, b) =>
    b.createdAt - a.createdAt
  );
  const campaigns = allCampaigns.filter((campaign) =>
    campaign.status !== "archived"
  );
  const campaignLeads = leads.filter((lead) => lead.source === "campaign");
  const campaignSpendCents = game.history.campaignSpendArchivedCents +
    allCampaigns.reduce(
      (total, campaign) => total + campaign.totalSpentCents,
      0,
    );
  const campaignLeadIds = new Set(campaignLeads.map((lead) => lead.id));
  const campaignDeals = Object.values(game.records.deals).filter((deal) =>
    campaignLeadIds.has(deal.leadId)
  );
  const campaignCustomers = Object.values(game.records.customers).filter(
    (customer) => campaignLeadIds.has(customer.primaryLeadId),
  );
  const attributedMrrCents = campaignCustomers.reduce(
    (total, customer) => total + customer.monthlyValueCents,
    0,
  );
  const openPipelineCents = campaignDeals.filter((deal) =>
    !["won", "lost"].includes(deal.stage)
  ).reduce((total, deal) => total + deal.monthlyValueCents, 0);
  const channelReports = (["email", "paid_social", "events"] as const).map(
    (channel) => {
      const channelCampaigns = allCampaigns.filter((campaign) =>
        campaign.channel === channel
      );
      const campaignIds = new Set(
        channelCampaigns.map((campaign) => campaign.id),
      );
      const channelLeads = campaignLeads.filter((lead) =>
        lead.campaignId && campaignIds.has(lead.campaignId)
      );
      const leadIds = new Set(channelLeads.map((lead) => lead.id));
      const customers = Object.values(game.records.customers).filter((
        customer,
      ) => leadIds.has(customer.primaryLeadId));
      return {
        channel,
        spendCents: channelCampaigns.reduce(
          (total, campaign) => total + campaign.totalSpentCents,
          0,
        ),
        leads: channelLeads.length,
        customers: customers.length,
        mrrCents: customers.reduce(
          (total, customer) => total + customer.monthlyValueCents,
          0,
        ),
      };
    },
  );
  const normalizedCompanyName = companyName.value.trim().replaceAll(
    /\s+/g,
    " ",
  );
  const companyNameError = normalizedCompanyName.length < 2
    ? "Enter at least 2 characters."
    : normalizedCompanyName.length > 60
    ? "Use 60 characters or fewer."
    : undefined;
  const referralBlockedReason = game.clock.status !== "active"
    ? "Company time must be active before requesting introductions."
    : game.company.founderCapacityRemaining < 60
    ? "Requires 60 minutes of available founder capacity."
    : undefined;
  const effectiveMinute = game.clock.gameMinute + Math.max(
    0,
    Math.floor(
      (store.now.value - game.lastSimulatedAt) /
        DEFAULT_RULES.realMillisecondsPerGameMinute,
    ),
  );

  const navigate = (next: View) => {
    view.value = next;
    mobileNav.value = false;
    showNotifications.value = false;
    showCompanyMenu.value = false;
  };

  const openSearchResult = (leadId: string) => {
    selectedLeadId.value = leadId;
    searchQuery.value = "";
    navigate("leads");
  };

  const dispatch = (command: GameCommand) => {
    return store.dispatch(command);
  };

  const renameCompany = (event: SubmitEvent) => {
    event.preventDefault();
    if (dispatch({ type: "rename_company", name: companyName.value })) {
      companyName.value = store.game.value.company.name;
    }
  };

  const resetCampaignForm = () => {
    editingCampaignId.value = undefined;
    campaignName.value = "";
    campaignChannel.value = "email";
    campaignAudience.value = "mid_market";
    campaignBudget.value = "50";
    campaignDuration.value = "7";
    campaignMessage.value = "";
  };

  const editCampaign = (campaignId: string) => {
    const campaign = game.records.campaigns[campaignId];
    editingCampaignId.value = campaign.id;
    campaignName.value = campaign.name;
    campaignChannel.value = campaign.channel;
    campaignAudience.value = campaign.audience;
    campaignBudget.value = String(campaign.dailyBudgetCents / 100);
    campaignDuration.value = String(
      Math.max(
        1,
        Math.min(30, Math.ceil((campaign.endsAt - effectiveMinute) / 1_440)),
      ),
    );
    campaignMessage.value = campaign.message;
  };

  const submitCampaign = (event: SubmitEvent) => {
    event.preventDefault();
    const values = {
      name: campaignName.value,
      channel: campaignChannel.value,
      audience: campaignAudience.value,
      dailyBudgetCents: Math.round(Number(campaignBudget.value) * 100),
      durationDays: Number(campaignDuration.value),
      message: campaignMessage.value,
    };
    const accepted = editingCampaignId.value
      ? dispatch({
        type: "update_campaign",
        campaignId: editingCampaignId.value,
        ...values,
      })
      : dispatch({ type: "create_campaign", ...values });
    if (accepted) resetCampaignForm();
  };

  const importFile = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      await store.importSave(JSON.parse(await file.text()));
      companyName.value = store.game.value.company.name;
      store.notice.value = "Company imported";
      view.value = "dashboard";
    } catch (error) {
      store.notice.value = error instanceof Error
        ? error.message
        : "Import failed";
    } finally {
      input.value = "";
    }
  };

  const navItems: Array<
    { id: View; label: string; icon: JSX.Element; count?: number }
  > = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: <LayoutDashboard size={17} />,
    },
    {
      id: "leads",
      label: "Lead inbox",
      icon: <Inbox size={17} />,
      count: leads.length,
    },
    {
      id: "contacts",
      label: "Contacts",
      icon: <Users size={17} />,
      count: leads.length,
    },
    {
      id: "companies",
      label: "Companies",
      icon: <Building2 size={17} />,
      count: companies.length,
    },
    {
      id: "tasks",
      label: "Tasks",
      icon: <Check size={17} />,
      count: openTasks.length,
    },
  ];

  return (
    <div
      class={`crm-app ${game.preferences.reducedMotion ? "reduce-motion" : ""}`}
    >
      <aside class={`sidebar ${mobileNav.value ? "open" : ""}`}>
        <div class="brand">
          <div class="brand-mark">{initials(game.company.name)}</div>
          <div>
            <strong>{game.company.name}</strong>
            <span>Revenue workspace</span>
          </div>
          <button
            type="button"
            class="icon-button mobile-only"
            onClick={() => mobileNav.value = false}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <nav aria-label="Primary">
          <span class="nav-heading">Workspace</span>
          {navItems.map((item) => (
            <button
              type="button"
              class={view.value === item.id ? "active" : ""}
              onClick={() => navigate(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.count !== undefined && <b>{item.count}</b>}
            </button>
          ))}
          <span class="nav-heading">Growth</span>
          <button
            type="button"
            class={`${marketingUnlocked ? "" : "locked"} ${
              view.value === "marketing" ? "active" : ""
            }`}
            disabled={!marketingUnlocked}
            onClick={() => navigate("marketing")}
          >
            <BarChart3 size={17} />
            <span>Marketing</span>
            {marketingUnlocked
              ? <ChevronRight size={14} />
              : <LockKeyhole size={13} />}
          </button>
          <button
            type="button"
            class={`${pipelineUnlocked ? "" : "locked"} ${
              view.value === "pipeline" ? "active" : ""
            }`}
            disabled={!pipelineUnlocked}
            onClick={() => navigate("pipeline")}
          >
            <Target size={17} />
            <span>Pipeline</span>
            {pipelineUnlocked
              ? <ChevronRight size={14} />
              : <LockKeyhole size={13} />}
          </button>
          <button type="button" class="locked" disabled>
            <Activity size={17} />
            <span>Customer success</span>
            <LockKeyhole size={13} />
          </button>
        </nav>
        <div class={`unlock-note ${pipelineUnlocked ? "unlocked" : ""}`}>
          {pipelineUnlocked ? <Target size={15} /> : <LockKeyhole size={15} />}
          <div>
            <strong>
              {pipelineUnlocked ? "Sales operations active" : "Pipeline locked"}
            </strong>
            <span>
              {pipelineUnlocked
                ? "Forecast and manage every open deal."
                : `${
                  money.format(DEFAULT_RULES.pipelineUnlockMrrCents / 100)
                } MRR and ${DEFAULT_RULES.pipelineUnlockOpenDeals} open deals required.`}
            </span>
          </div>
        </div>
        <button
          type="button"
          class={`settings-link ${view.value === "settings" ? "active" : ""}`}
          onClick={() => navigate("settings")}
        >
          <Settings size={17} />Settings
        </button>
      </aside>

      <main>
        <header class="topbar">
          <button
            type="button"
            class="icon-button mobile-only"
            onClick={() => mobileNav.value = true}
            aria-label="Open navigation"
          >
            <Menu size={19} />
          </button>
          <div class="search-shell">
            <div class="search">
              <Search size={16} />
              <input
                aria-label="Search CRM"
                placeholder="Search contacts and companies"
                value={searchQuery.value}
                onInput={(event) =>
                  searchQuery.value = event.currentTarget.value}
              />
              {searchQuery.value && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => searchQuery.value = ""}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            {normalizedQuery && (
              <div class="search-results">
                {searchResults.map((lead) => (
                  <button
                    type="button"
                    onClick={() => openSearchResult(lead.id)}
                  >
                    <Users size={17} />
                    <span>
                      <strong>{lead.firstName} {lead.lastName}</strong>
                      <small>
                        {lead.role} ·{" "}
                        {game.records.companies[lead.companyId].name}
                      </small>
                    </span>
                  </button>
                ))}
                {searchResults.length === 0 && (
                  <div class="search-empty">No matching CRM records</div>
                )}
              </div>
            )}
          </div>
          <div class="topbar-meta">
            <span class={`save-state ${store.saveStatus.value}`}>
              {store.saveStatus.value === "saving" && <RefreshCw size={13} />}
              {" "}
              {statusLabel(store.saveStatus.value)}
            </span>
            <span class="game-clock">
              <Clock3 size={14} />
              {gameDate(effectiveMinute)}
            </span>
            <div class="topbar-popover">
              <button
                type="button"
                class="icon-button"
                aria-label="Notifications"
                aria-expanded={showNotifications.value}
                onClick={() => {
                  showNotifications.value = !showNotifications.value;
                  showCompanyMenu.value = false;
                }}
              >
                <Bell size={18} />
                {openTasks.length > 0 && <i />}
              </button>
              {showNotifications.value && (
                <div class="popover notification-popover">
                  <strong>Work requiring attention</strong>
                  {openTasks.length === 0
                    ? <span>Your queue is clear.</span>
                    : openTasks.slice(0, 4).map((task) => (
                      <button
                        type="button"
                        onClick={() => navigate("tasks")}
                      >
                        <span>{task.title}</span>
                        <small>
                          {relativeGameTime(task.dueAt, effectiveMinute)}
                        </small>
                      </button>
                    ))}
                  {openTasks.length > 4 && (
                    <button
                      type="button"
                      onClick={() => navigate("tasks")}
                    >
                      View all {openTasks.length} tasks
                    </button>
                  )}
                </div>
              )}
            </div>
            <div class="topbar-popover">
              <button
                type="button"
                class="avatar"
                aria-label="Company menu"
                aria-expanded={showCompanyMenu.value}
                onClick={() => {
                  showCompanyMenu.value = !showCompanyMenu.value;
                  showNotifications.value = false;
                }}
              >
                {initials(game.company.name)}
              </button>
              {showCompanyMenu.value && (
                <div class="popover company-menu">
                  <strong>{game.company.name}</strong>
                  <span>{money.format(game.company.mrrCents / 100)} MRR</span>
                  <button type="button" onClick={() => navigate("settings")}>
                    <Settings size={16} />Workspace settings
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {store.saveStatus.value === "error" && (
          <div class="inline-alert error" role="alert">
            <span>
              <strong>Changes are not saved.</strong>
              Your browser could not update the company cookie.
            </span>
            <button
              type="button"
              class="secondary"
              onClick={() =>
                void store.saveNow()}
            >
              <RefreshCw size={16} />Retry save
            </button>
          </div>
        )}

        <section class="workspace">
          {view.value === "dashboard" && (
            <>
              <div class="page-heading">
                <div>
                  <span>Revenue operations</span>
                  <h1>Company pulse</h1>
                  <p>Your live acquisition and delivery workload.</p>
                </div>
                <button
                  type="button"
                  class="primary"
                  onClick={() => navigate("leads")}
                >
                  <Inbox size={16} />Work leads
                </button>
              </div>
              <div class="kpi-grid">
                <Kpi
                  label="Cash"
                  value={money.format(game.company.cashCents / 100)}
                  detail={`${
                    Math.max(
                      0,
                      Math.floor(
                        game.company.cashCents /
                          Math.max(
                            1,
                            game.company.baselineMonthlyExpensesCents,
                          ),
                      ),
                    )
                  } months runway`}
                  icon={<CircleDollarSign size={19} />}
                  tone={game.company.cashCents <
                      game.company.baselineMonthlyExpensesCents
                    ? "warning"
                    : "positive"}
                />
                <Kpi
                  label="Monthly revenue"
                  value={money.format(game.company.mrrCents / 100)}
                  detail={`${game.company.customerCount} active customers`}
                  icon={<Gauge size={19} />}
                  tone="positive"
                />
                <Kpi
                  label="Open leads"
                  value={String(
                    leads.filter((lead) =>
                      !["converted", "disqualified"].includes(lead.status)
                    ).length,
                  )}
                  detail={`${game.history.leadsQualified} qualified all time`}
                  icon={<Users size={19} />}
                />
                <Kpi
                  label="Founder capacity"
                  value={`${game.company.founderCapacityRemaining}m`}
                  detail={`of ${game.company.founderCapacityMinutes}m today`}
                  icon={<Clock3 size={19} />}
                />
              </div>
              <div class="dashboard-grid">
                <div class="panel">
                  <div class="panel-heading">
                    <div>
                      <h2>Priority work</h2>
                      <span>Tasks requiring attention</span>
                    </div>
                    <button
                      type="button"
                      class="text-button"
                      onClick={() => navigate("tasks")}
                    >
                      View all <ChevronRight size={14} />
                    </button>
                  </div>
                  {openTasks.length === 0
                    ? (
                      <EmptyState
                        title="Queue cleared"
                        detail="New work appears as leads and customers progress."
                      />
                    )
                    : (
                      <div class="task-list">
                        {openTasks.slice(0, 5).map((task) => (
                          <TaskRow
                            task={task}
                            currentMinute={effectiveMinute}
                            onComplete={() =>
                              dispatch({
                                type: "complete_task",
                                taskId: task.id,
                              })}
                          />
                        ))}
                      </div>
                    )}
                </div>
                <div class="panel">
                  <div class="panel-heading">
                    <div>
                      <h2>Recent activity</h2>
                      <span>Company timeline</span>
                    </div>
                  </div>
                  <div class="activity-list">
                    {game.recentActivities.length === 0
                      ? (
                        <EmptyState
                          title="No activity yet"
                          detail="CRM events appear here as work is completed."
                        />
                      )
                      : game.recentActivities.slice(-7).reverse().map((
                        activity,
                      ) => (
                        <div>
                          <i />
                          <span>
                            <strong>{activity.summary}</strong>
                            <small>{gameDate(activity.gameMinute)}</small>
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {view.value === "leads" && (
            <>
              <div class="page-heading">
                <div>
                  <span>Acquisition</span>
                  <h1>Lead inbox</h1>
                  <p>Qualify fit, build intent, and convert demand.</p>
                </div>
                <div class="view-actions">
                  <button
                    type="button"
                    class={`secondary ${showLeadFilters.value ? "active" : ""}`}
                    aria-expanded={showLeadFilters.value}
                    onClick={() =>
                      showLeadFilters.value = !showLeadFilters.value}
                  >
                    <SlidersHorizontal size={16} />Filter
                  </button>
                  <button
                    type="button"
                    class="primary"
                    onClick={() => selectedLeadId.value = leads[0]?.id}
                  >
                    <Target size={16} />Next lead
                  </button>
                </div>
              </div>
              {showLeadFilters.value && (
                <div class="filter-bar">
                  <label>
                    <span>Status</span>
                    <select
                      value={leadFilter.value}
                      onChange={(event) =>
                        leadFilter.value = event.currentTarget.value}
                    >
                      <option value="all">All statuses</option>
                      <option value="new">New</option>
                      <option value="contacted">Contacted</option>
                      <option value="qualified">Qualified</option>
                      <option value="converted">Converted</option>
                      <option value="disqualified">Disqualified</option>
                    </select>
                  </label>
                  <label>
                    <span>
                      <ArrowUpDown size={15} />Sort
                    </span>
                    <select
                      value={leadSort.value}
                      onChange={(event) =>
                        leadSort.value = event.currentTarget.value}
                    >
                      <option value="newest">Newest first</option>
                      <option value="fit">Highest fit</option>
                      <option value="intent">Highest intent</option>
                    </select>
                  </label>
                  {leadFilter.value !== "all" && (
                    <button
                      type="button"
                      class="text-button"
                      onClick={() => leadFilter.value = "all"}
                    >
                      Clear filter
                    </button>
                  )}
                </div>
              )}
              <div class="record-layout">
                <div class="panel table-panel">
                  <div class="table-toolbar">
                    <strong>{filteredLeads.length} leads</strong>
                    <span>
                      {leads.filter((lead) => lead.status === "new").length} new
                    </span>
                  </div>
                  <div class="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Contact</th>
                          <th>Company</th>
                          <th>Status</th>
                          <th>Fit</th>
                          <th>Intent</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLeads.map((lead) => {
                          const company =
                            game.records.companies[lead.companyId];
                          return (
                            <tr
                              class={selectedLead?.id === lead.id
                                ? "selected"
                                : ""}
                              onClick={() => selectedLeadId.value = lead.id}
                            >
                              <td>
                                <strong>
                                  {lead.firstName} {lead.lastName}
                                </strong>
                                <small>{lead.role}</small>
                              </td>
                              <td>
                                {company.name}
                                <small>{company.industry}</small>
                              </td>
                              <td>
                                <span class={`status ${lead.status}`}>
                                  {statusLabel(lead.status)}
                                </span>
                              </td>
                              <td>
                                <b class="score">{lead.fit}</b>
                              </td>
                              <td>
                                <div class="meter">
                                  <i style={{ width: `${lead.engagement}%` }} />
                                </div>
                                <small>{lead.engagement}%</small>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {filteredLeads.length === 0 && (
                      <EmptyState
                        title="No leads match"
                        detail="Choose another status to restore the inbox."
                      />
                    )}
                  </div>
                </div>
                {selectedLead
                  ? (
                    <LeadPanel
                      lead={selectedLead}
                      game={game}
                      dispatch={dispatch}
                      onClose={() => selectedLeadId.value = undefined}
                    />
                  )
                  : (
                    <div class="panel detail-placeholder">
                      <Users size={28} />
                      <strong>Select a lead</strong>
                      <span>Open a record to review fit and take action.</span>
                    </div>
                  )}
              </div>
            </>
          )}

          {view.value === "contacts" && (
            <>
              <div class="page-heading">
                <div>
                  <span>Relationships</span>
                  <h1>Contacts</h1>
                  <p>Every person connected to your pipeline and customers.</p>
                </div>
              </div>
              <div class="panel table-panel">
                <div class="table-toolbar">
                  <strong>{leads.length} contacts</strong>
                  <span>All lifecycle stages</span>
                </div>
                <div class="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Company</th>
                        <th>Email</th>
                        <th>Lifecycle</th>
                        <th>Last activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leads.map((lead) => (
                        <tr
                          onClick={() => {
                            selectedLeadId.value = lead.id;
                            view.value = "leads";
                          }}
                        >
                          <td>
                            <strong>{lead.firstName} {lead.lastName}</strong>
                            <small>{lead.role}</small>
                          </td>
                          <td>{game.records.companies[lead.companyId].name}</td>
                          <td>{lead.email}</td>
                          <td>
                            <span class={`status ${lead.status}`}>
                              {statusLabel(lead.status)}
                            </span>
                          </td>
                          <td>{gameDate(lead.lastActivityAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {view.value === "companies" && (
            <>
              <div class="page-heading">
                <div>
                  <span>Accounts</span>
                  <h1>Companies</h1>
                  <p>Organizations connected to leads, deals, and customers.</p>
                </div>
              </div>
              <div class="record-layout">
                <div class="panel table-panel">
                  <div class="table-toolbar">
                    <strong>{companies.length} companies</strong>
                    <span>{game.company.customerCount} customers</span>
                  </div>
                  <div class="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Company</th>
                          <th>Industry</th>
                          <th>Region</th>
                          <th>Employees</th>
                          <th>Relationship</th>
                        </tr>
                      </thead>
                      <tbody>
                        {companies.map((company) => {
                          const customer = Object.values(
                            game.records.customers,
                          ).find((entry) => entry.companyId === company.id);
                          return (
                            <tr
                              class={selectedCompany?.id === company.id
                                ? "selected"
                                : ""}
                              onClick={() =>
                                selectedCompanyId.value = company.id}
                            >
                              <td>
                                <strong>{company.name}</strong>
                              </td>
                              <td>{company.industry}</td>
                              <td>{company.region}</td>
                              <td>{company.employeeCount}</td>
                              <td>
                                <span
                                  class={`status ${customer ? "won" : "new"}`}
                                >
                                  {customer ? "Customer" : "Prospect"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                {selectedCompany
                  ? (
                    <CompanyPanel
                      companyId={selectedCompany.id}
                      game={game}
                    />
                  )
                  : (
                    <div class="panel detail-placeholder">
                      <Building2 size={30} />
                      <strong>Select a company</strong>
                      <span>
                        Open an account to review its commercial history.
                      </span>
                    </div>
                  )}
              </div>
            </>
          )}

          {view.value === "tasks" && (
            <>
              <div class="page-heading">
                <div>
                  <span>Execution</span>
                  <h1>Tasks</h1>
                  <p>Keep every promise and follow-up on schedule.</p>
                </div>
              </div>
              <div class="panel">
                <div class="table-toolbar">
                  <strong>{openTasks.length} open tasks</strong>
                  <span>Sorted by due time</span>
                </div>
                {openTasks.length === 0
                  ? (
                    <EmptyState
                      title="Nothing due"
                      detail="Your task queue is clear."
                    />
                  )
                  : (
                    <div class="task-list roomy">
                      {openTasks.sort((a, b) => a.dueAt - b.dueAt).map((
                        task,
                      ) => (
                        <TaskRow
                          task={task}
                          currentMinute={effectiveMinute}
                          onComplete={() =>
                            dispatch({
                              type: "complete_task",
                              taskId: task.id,
                            })}
                        />
                      ))}
                    </div>
                  )}
              </div>
            </>
          )}

          {view.value === "marketing" && marketingUnlocked && (
            <>
              <div class="page-heading">
                <div>
                  <span>Demand generation</span>
                  <h1>Marketing</h1>
                  <p>Turn customer trust into qualified introductions.</p>
                </div>
              </div>
              <div class="campaign-summary" aria-label="Campaign performance">
                <div>
                  <span>Total spend</span>
                  <strong>{money.format(campaignSpendCents / 100)}</strong>
                </div>
                <div>
                  <span>Campaign leads</span>
                  <strong>{campaignLeads.length}</strong>
                </div>
                <div>
                  <span>Cost per lead</span>
                  <strong>
                    {campaignLeads.length > 0
                      ? money.format(
                        campaignSpendCents / campaignLeads.length / 100,
                      )
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>Conversion</span>
                  <strong>
                    {campaignLeads.length > 0
                      ? `${
                        Math.round(
                          campaignCustomers.length / campaignLeads.length * 100,
                        )
                      }%`
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>Open pipeline</span>
                  <strong>{money.format(openPipelineCents / 100)}</strong>
                </div>
                <div>
                  <span>Attributed MRR</span>
                  <strong>{money.format(attributedMrrCents / 100)}</strong>
                </div>
              </div>
              <div class="marketing-layout">
                <section class="panel campaign-builder">
                  <div class="panel-heading">
                    <div>
                      <h2>
                        {editingCampaignId.value
                          ? "Edit campaign"
                          : "New campaign"}
                      </h2>
                      <span>
                        {editingCampaignId.value
                          ? "Update a paused campaign before resuming delivery"
                          : "Configure a bounded acquisition program"}
                      </span>
                    </div>
                  </div>
                  <form onSubmit={submitCampaign}>
                    <label>
                      <span>Campaign name</span>
                      <input
                        value={campaignName.value}
                        minLength={2}
                        maxLength={60}
                        required
                        onInput={(event) =>
                          campaignName.value = event.currentTarget.value}
                      />
                    </label>
                    <div class="form-row">
                      <label>
                        <span>Channel</span>
                        <select
                          value={campaignChannel.value}
                          onChange={(event) =>
                            campaignChannel.value = event.currentTarget
                              .value as CampaignChannel}
                        >
                          <option value="email">Email</option>
                          <option value="paid_social">Paid social</option>
                          <option value="events">Events</option>
                        </select>
                      </label>
                      <label>
                        <span>Audience</span>
                        <select
                          value={campaignAudience.value}
                          onChange={(event) =>
                            campaignAudience.value = event.currentTarget
                              .value as CampaignAudience}
                        >
                          <option value="small_business">Small business</option>
                          <option value="mid_market">Mid-market</option>
                          <option value="enterprise">Enterprise</option>
                        </select>
                      </label>
                    </div>
                    <div class="form-row">
                      <label>
                        <span>Daily budget</span>
                        <input
                          type="number"
                          min="10"
                          max="1000"
                          step="10"
                          value={campaignBudget.value}
                          required
                          onInput={(event) =>
                            campaignBudget.value = event.currentTarget.value}
                        />
                      </label>
                      <label>
                        <span>Duration</span>
                        <select
                          value={campaignDuration.value}
                          onChange={(event) =>
                            campaignDuration.value = event.currentTarget.value}
                        >
                          <option value="3">3 days</option>
                          <option value="7">7 days</option>
                          <option value="14">14 days</option>
                          <option value="30">30 days</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      <span>Message</span>
                      <textarea
                        value={campaignMessage.value}
                        minLength={10}
                        maxLength={200}
                        required
                        onInput={(event) =>
                          campaignMessage.value = event.currentTarget.value}
                      />
                    </label>
                    <button
                      type="submit"
                      class="primary"
                      disabled={game.clock.status !== "active" ||
                        campaigns.filter((campaign) =>
                            campaign.status === "active"
                          ).length >= DEFAULT_RULES.maxActiveCampaigns}
                    >
                      {editingCampaignId.value
                        ? <Pencil size={17} />
                        : <BarChart3 size={17} />}
                      {editingCampaignId.value
                        ? "Save campaign"
                        : "Launch campaign"}
                    </button>
                    {editingCampaignId.value && (
                      <button
                        type="button"
                        class="text-button"
                        onClick={resetCampaignForm}
                      >
                        Cancel editing
                      </button>
                    )}
                  </form>
                </section>
                <section class="panel acquisition-tool">
                  <div class="acquisition-icon">
                    <Users size={24} />
                  </div>
                  <div>
                    <span>Available channel</span>
                    <h2>Customer referral motion</h2>
                    <p>
                      Spend 60 minutes asking current customers for a warm
                      introduction. Referral leads arrive with stronger fit and
                      intent than typical inbound demand.
                    </p>
                  </div>
                  <dl>
                    <div>
                      <dt>Capacity cost</dt>
                      <dd>60m</dd>
                    </div>
                    <div>
                      <dt>Referrals sourced</dt>
                      <dd>{referralLeads.length}</dd>
                    </div>
                    <div>
                      <dt>Capacity available</dt>
                      <dd>{game.company.founderCapacityRemaining}m</dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    class="primary"
                    disabled={referralBlockedReason !== undefined}
                    onClick={() => dispatch({ type: "request_referrals" })}
                  >
                    <Users size={17} />Request introductions
                  </button>
                  {referralBlockedReason && (
                    <p class="blocked-reason">
                      <LockKeyhole size={15} />
                      {referralBlockedReason}
                    </p>
                  )}
                </section>
                <section class="panel campaign-list-panel">
                  <div class="panel-heading">
                    <div>
                      <h2>Campaigns</h2>
                      <span>Spend, attributed demand, and delivery status</span>
                    </div>
                  </div>
                  {campaigns.length === 0
                    ? (
                      <EmptyState
                        title="No campaigns yet"
                        detail="Launch a campaign to create a repeatable source of demand."
                      />
                    )
                    : (
                      <div class="campaign-list">
                        {campaigns.map((campaign) => (
                          <div>
                            <span>
                              <strong>{campaign.name}</strong>
                              <small>
                                {statusLabel(campaign.channel)} ·{" "}
                                {statusLabel(campaign.audience)}
                              </small>
                            </span>
                            <dl>
                              <div>
                                <dt>Spend</dt>
                                <dd>
                                  {money.format(campaign.totalSpentCents / 100)}
                                </dd>
                              </div>
                              <div>
                                <dt>Leads</dt>
                                <dd>{campaign.leadsGenerated}</dd>
                              </div>
                              <div>
                                <dt>Saturation</dt>
                                <dd>
                                  {campaignSaturation(campaign.leadsGenerated)}%
                                </dd>
                              </div>
                            </dl>
                            <span class={`status ${campaign.status}`}>
                              {statusLabel(campaign.status)}
                            </span>
                            <div class="campaign-actions">
                              {campaign.status !== "completed" && (
                                <button
                                  type="button"
                                  class="secondary"
                                  onClick={() =>
                                    dispatch({
                                      type: "set_campaign_status",
                                      campaignId: campaign.id,
                                      status: campaign.status === "active"
                                        ? "paused"
                                        : "active",
                                    })}
                                >
                                  {campaign.status === "active"
                                    ? "Pause"
                                    : "Resume"}
                                </button>
                              )}
                              {campaign.status === "paused" && (
                                <button
                                  type="button"
                                  class="icon-button"
                                  aria-label={`Edit ${campaign.name}`}
                                  title="Edit campaign"
                                  onClick={() => editCampaign(campaign.id)}
                                >
                                  <Pencil size={16} />
                                </button>
                              )}
                              <button
                                type="button"
                                class="icon-button"
                                aria-label={`Duplicate ${campaign.name}`}
                                title="Duplicate campaign"
                                onClick={() =>
                                  dispatch({
                                    type: "duplicate_campaign",
                                    campaignId: campaign.id,
                                  })}
                              >
                                <Copy size={16} />
                              </button>
                              {campaign.status !== "active" && (
                                <button
                                  type="button"
                                  class="icon-button"
                                  aria-label={`Archive ${campaign.name}`}
                                  title="Archive campaign"
                                  onClick={() =>
                                    dispatch({
                                      type: "archive_campaign",
                                      campaignId: campaign.id,
                                    })}
                                >
                                  <Archive size={16} />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                </section>
                <section class="panel campaign-report-panel">
                  <div class="panel-heading">
                    <div>
                      <h2>Channel performance</h2>
                      <span>Single-touch revenue attribution</span>
                    </div>
                  </div>
                  <div class="table-scroll">
                    <table class="channel-report">
                      <thead>
                        <tr>
                          <th>Channel</th>
                          <th>Spend</th>
                          <th>Leads</th>
                          <th>Customers</th>
                          <th>CAC</th>
                          <th>MRR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {channelReports.map((report) => (
                          <tr>
                            <td>
                              <strong>{statusLabel(report.channel)}</strong>
                            </td>
                            <td>{money.format(report.spendCents / 100)}</td>
                            <td>{report.leads}</td>
                            <td>{report.customers}</td>
                            <td>
                              {report.customers > 0
                                ? money.format(
                                  report.spendCents / report.customers / 100,
                                )
                                : "—"}
                            </td>
                            <td>{money.format(report.mrrCents / 100)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section class="panel">
                  <div class="panel-heading">
                    <div>
                      <h2>Referral leads</h2>
                      <span>Warm introductions generated by customers</span>
                    </div>
                  </div>
                  {referralLeads.length === 0
                    ? (
                      <EmptyState
                        title="No referrals yet"
                        detail="Request introductions to add the first warm lead."
                      />
                    )
                    : (
                      <div class="referral-list">
                        {referralLeads.slice(0, 6).map((lead) => (
                          <button
                            type="button"
                            onClick={() => openSearchResult(lead.id)}
                          >
                            <span>
                              <strong>{lead.firstName} {lead.lastName}</strong>
                              <small>
                                {game.records.companies[lead.companyId].name}
                              </small>
                            </span>
                            <b>{lead.fit} fit</b>
                            <ChevronRight size={16} />
                          </button>
                        ))}
                      </div>
                    )}
                </section>
              </div>
            </>
          )}

          {view.value === "pipeline" && pipelineUnlocked && (
            <PipelineWorkspace
              game={game}
              currentMinute={effectiveMinute}
              mode={game.preferences.pipelineView}
              onModeChange={(view) =>
                dispatch({ type: "set_pipeline_view", view })}
              dispatch={dispatch}
            />
          )}

          {view.value === "settings" && (
            <>
              <div class="page-heading">
                <div>
                  <span>Workspace</span>
                  <h1>Settings</h1>
                  <p>Manage this browser's company save.</p>
                </div>
              </div>
              <div class="settings-grid">
                <div class="panel settings-panel identity-panel">
                  <h2>Workspace identity</h2>
                  <p>
                    Choose the company name shown throughout your CRM and
                    reports.
                  </p>
                  <form class="identity-form" onSubmit={renameCompany}>
                    <label for="company-name">Company name</label>
                    <div>
                      <input
                        id="company-name"
                        name="companyName"
                        value={companyName.value}
                        minLength={2}
                        maxLength={60}
                        required
                        aria-invalid={companyNameError !== undefined}
                        aria-describedby={companyNameError
                          ? "company-name-error"
                          : undefined}
                        onInput={(event) =>
                          companyName.value = event.currentTarget.value}
                      />
                      <button
                        type="submit"
                        class="primary"
                        disabled={companyNameError !== undefined ||
                          normalizedCompanyName === game.company.name}
                      >
                        Save name
                      </button>
                    </div>
                    {companyNameError && (
                      <small id="company-name-error" class="field-error">
                        {companyNameError}
                      </small>
                    )}
                  </form>
                </div>
                <div class="panel settings-panel preference-panel">
                  <h2>Accessibility</h2>
                  <p>
                    Tune workspace behavior for a more comfortable operating
                    experience.
                  </p>
                  <label class="toggle-row">
                    <span>
                      <strong>Reduce motion</strong>
                      <small>
                        Disable transitions and animated status indicators.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={game.preferences.reducedMotion}
                      onChange={(event) =>
                        dispatch({
                          type: "set_reduced_motion",
                          enabled: event.currentTarget.checked,
                        })}
                    />
                  </label>
                </div>
                <div class="panel settings-panel">
                  <h2>Data portability</h2>
                  <p>
                    Live progress is stored only in signed browser cookies.
                    Export a backup before clearing browser data.
                  </p>
                  <div class="settings-actions">
                    <button
                      type="button"
                      class="secondary"
                      disabled={store.operationStatus.value !== "idle"}
                      onClick={() =>
                        void store.exportSave().catch((error) =>
                          store.notice.value = error.message
                        )}
                    >
                      {store.operationStatus.value === "exporting"
                        ? <RefreshCw class="spin" size={16} />
                        : <Download size={16} />}
                      {store.operationStatus.value === "exporting"
                        ? "Exporting..."
                        : "Export company"}
                    </button>
                    <label
                      class={`secondary file-button ${
                        store.operationStatus.value !== "idle" ? "disabled" : ""
                      }`}
                    >
                      {store.operationStatus.value === "importing"
                        ? <RefreshCw class="spin" size={16} />
                        : <Upload size={16} />}
                      {store.operationStatus.value === "importing"
                        ? "Importing..."
                        : "Import company"}
                      <input
                        type="file"
                        accept="application/json"
                        disabled={store.operationStatus.value !== "idle"}
                        onChange={(event) => void importFile(event)}
                      />
                    </label>
                  </div>
                </div>
                <div class="panel settings-panel danger">
                  <h2>Start over</h2>
                  <p>
                    Delete this company's cookie save and return to a new
                    founder inbox.
                  </p>
                  <button
                    type="button"
                    class="danger-button"
                    onClick={() => confirmReset.value = true}
                  >
                    Reset company
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      {store.notice.value && (
        <div class="toast">
          <span>{store.notice.value}</span>
          <button
            type="button"
            onClick={() => store.notice.value = undefined}
            aria-label="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {showOffline.value && (
        <Modal
          title={props.loadStatus === "crisis"
            ? "Company needs attention"
            : "While you were away"}
          onClose={() => showOffline.value = false}
        >
          <div class="summary-grid">
            <div>
              <span>Time processed</span>
              <strong>{props.offlineSummary?.elapsedGameMinutes ?? 0}m</strong>
            </div>
            <div>
              <span>New leads</span>
              <strong>{props.offlineSummary?.leadsCreated ?? 0}</strong>
            </div>
            <div>
              <span>Revenue</span>
              <strong>
                {money.format(
                  (props.offlineSummary?.revenueAccruedCents ?? 0) / 100,
                )}
              </strong>
            </div>
            <div>
              <span>Costs</span>
              <strong>
                {money.format(
                  (props.offlineSummary?.expensesAccruedCents ?? 0) / 100,
                )}
              </strong>
            </div>
          </div>
          {props.loadStatus === "crisis" && (
            <div class="crisis-note">
              Offline progress stopped before operating costs could bankrupt the
              company. Review cash and resume only when ready.
            </div>
          )}
          <button
            type="button"
            class="primary full"
            onClick={() => {
              if (game.clock.status === "crisis") {
                dispatch({ type: "resume_crisis" });
              }
              showOffline.value = false;
            }}
          >
            {game.clock.status === "crisis"
              ? "Resume company"
              : "Review dashboard"}
          </button>
        </Modal>
      )}

      {showCorrupt.value && (
        <Modal title="Save could not be loaded" onClose={() => {}}>
          <p class="modal-copy">
            The signed cookie save is incomplete or invalid. It has not been
            overwritten.
          </p>
          <code class="error-code">{props.loadError}</code>
          <div class="modal-actions">
            <label class="secondary file-button">
              <Upload size={16} />Import backup<input
                type="file"
                accept="application/json"
                onChange={(event) =>
                  void importFile(event).then(() =>
                    showCorrupt.value = false
                  )}
              />
            </label>
            <button
              type="button"
              class="danger-button"
              onClick={() => confirmReset.value = true}
            >
              Reset save
            </button>
          </div>
        </Modal>
      )}

      {game.clock.status === "bankrupt" && (
        <Modal title="Company closed" onClose={() => {}}>
          <p class="modal-copy">
            {game.company.name} exhausted its operating cash on{" "}
            {gameDate(game.clock.bankruptAt ?? game.clock.gameMinute)}.
          </p>
          <div class="summary-grid">
            <div>
              <span>Peak MRR</span>
              <strong>{money.format(game.company.peakMrrCents / 100)}</strong>
            </div>
            <div>
              <span>Customers won</span>
              <strong>{game.history.dealsWon}</strong>
            </div>
            <div>
              <span>Leads created</span>
              <strong>{game.history.leadsCreated}</strong>
            </div>
            <div>
              <span>Company age</span>
              <strong>{Math.floor(game.clock.gameMinute / (24 * 60))}d</strong>
            </div>
          </div>
          <button
            type="button"
            class="primary full"
            onClick={() =>
              confirmReset.value = true}
          >
            Start a new company
          </button>
        </Modal>
      )}

      {confirmReset.value && (
        <Modal
          title="Reset this company?"
          onClose={() => confirmReset.value = false}
        >
          <p class="modal-copy">
            This permanently clears the current cookie save. Export first if you
            want a backup.
          </p>
          <div class="modal-actions">
            <button
              type="button"
              class="secondary"
              onClick={() => confirmReset.value = false}
            >
              Cancel
            </button>
            <button
              type="button"
              class="danger-button"
              disabled={store.operationStatus.value === "resetting"}
              onClick={() =>
                void store.reset().then(() => {
                  companyName.value = store.game.value.company.name;
                  confirmReset.value = false;
                  showCorrupt.value = false;
                  view.value = "leads";
                })}
            >
              {store.operationStatus.value === "resetting"
                ? "Resetting..."
                : "Reset company"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TaskRow(
  props: { task: Task; currentMinute: number; onComplete: () => void },
) {
  const overdue = props.task.dueAt < props.currentMinute;
  return (
    <div class="task-row">
      <button
        type="button"
        class="task-check"
        onClick={props.onComplete}
        aria-label={`Complete ${props.task.title}`}
      >
        <Check size={14} />
      </button>
      <div>
        <strong>{props.task.title}</strong>
        <span>{statusLabel(props.task.kind)}</span>
      </div>
      <time class={overdue ? "overdue" : ""}>
        {relativeGameTime(props.task.dueAt, props.currentMinute)}
      </time>
      <button type="button" class="icon-button" aria-label="Task options">
        <MoreHorizontal size={16} />
      </button>
    </div>
  );
}

function LeadPanel(
  props: {
    lead: Lead;
    game: GameState;
    dispatch: (command: GameCommand) => void;
    onClose: () => void;
  },
) {
  const company = props.game.records.companies[props.lead.companyId];
  const deal = Object.values(props.game.records.deals).find((entry) =>
    entry.leadId === props.lead.id
  );
  return (
    <aside class="panel record-detail">
      <div class="detail-heading">
        <div class="contact-avatar">
          {props.lead.firstName[0]}
          {props.lead.lastName[0]}
        </div>
        <div>
          <span>{statusLabel(props.lead.status)}</span>
          <h2>{props.lead.firstName} {props.lead.lastName}</h2>
          <p>{props.lead.role} at {company.name}</p>
        </div>
        <button
          type="button"
          class="icon-button"
          onClick={props.onClose}
          aria-label="Close record"
        >
          <X size={17} />
        </button>
      </div>
      <div class="quick-actions">
        <button
          type="button"
          onClick={() =>
            props.dispatch({
              type: "contact_lead",
              leadId: props.lead.id,
              channel: "email",
            })}
        >
          <Mail size={16} />
          <span>Email</span>
        </button>
        <button
          type="button"
          onClick={() =>
            props.dispatch({
              type: "contact_lead",
              leadId: props.lead.id,
              channel: "call",
            })}
        >
          <Phone size={16} />
          <span>Call</span>
        </button>
        <button
          type="button"
          onClick={() =>
            props.dispatch({ type: "follow_up_lead", leadId: props.lead.id })}
        >
          <RefreshCw size={16} />
          <span>Follow up</span>
        </button>
      </div>
      <div class="record-section">
        <h3>Qualification</h3>
        <dl>
          <div>
            <dt>Fit score</dt>
            <dd>{props.lead.fit}/100</dd>
          </div>
          <div>
            <dt>Intent</dt>
            <dd>{props.lead.engagement}%</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{statusLabel(props.lead.source)}</dd>
          </div>
          <div>
            <dt>Company size</dt>
            <dd>{company.employeeCount} people</dd>
          </div>
          <div>
            <dt>Region</dt>
            <dd>{company.region}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{props.lead.email}</dd>
          </div>
        </dl>
      </div>
      {deal
        ? <DealCard deal={deal} dispatch={props.dispatch} />
        : (
          <div class="record-footer">
            <button
              type="button"
              class="secondary"
              onClick={() =>
                props.dispatch({
                  type: "disqualify_lead",
                  leadId: props.lead.id,
                })}
            >
              Disqualify
            </button>
            <button
              type="button"
              class="primary"
              disabled={props.lead.status !== "contacted"}
              onClick={() =>
                props.dispatch({ type: "qualify_lead", leadId: props.lead.id })}
            >
              Qualify lead
            </button>
          </div>
        )}
    </aside>
  );
}

function DealCard(
  props: { deal: Deal; dispatch: (command: GameCommand) => void },
) {
  const closed = props.deal.stage === "won" || props.deal.stage === "lost";
  return (
    <div class="deal-card">
      <div>
        <span>Open deal</span>
        <strong>{money.format(props.deal.monthlyValueCents / 100)} MRR</strong>
      </div>
      <div class="deal-progress">
        <i style={{ width: `${props.deal.probability}%` }} />
      </div>
      <div class="deal-meta">
        <span>{statusLabel(props.deal.stage)}</span>
        <b>{props.deal.probability}%</b>
      </div>
      {!closed && (
        <button
          type="button"
          class="primary full"
          onClick={() =>
            props.dispatch({ type: "advance_deal", dealId: props.deal.id })}
        >
          Advance deal <ChevronRight size={15} />
        </button>
      )}
    </div>
  );
}

function CompanyPanel(
  props: { companyId: string; game: GameState },
) {
  const company = props.game.records.companies[props.companyId];
  const leads = Object.values(props.game.records.leads).filter((lead) =>
    lead.companyId === company.id
  );
  const deals = Object.values(props.game.records.deals).filter((deal) =>
    deal.companyId === company.id
  );
  const customer = Object.values(props.game.records.customers).find((entry) =>
    entry.companyId === company.id
  );
  const pipelineCents = deals.filter((deal) => deal.stage !== "lost").reduce(
    (total, deal) => total + deal.monthlyValueCents,
    0,
  );

  return (
    <aside class="panel record-detail">
      <div class="detail-heading company-heading">
        <div class="contact-avatar">
          <Building2 size={21} />
        </div>
        <div>
          <span>{customer ? "Customer account" : "Prospect account"}</span>
          <h2>{company.name}</h2>
          <p>{company.industry} · {company.region}</p>
        </div>
      </div>
      <div class="record-section">
        <h3>Account overview</h3>
        <dl>
          <div>
            <dt>Employees</dt>
            <dd>{company.employeeCount}</dd>
          </div>
          <div>
            <dt>Contacts</dt>
            <dd>{leads.length}</dd>
          </div>
          <div>
            <dt>Deals</dt>
            <dd>{deals.length}</dd>
          </div>
          <div>
            <dt>Pipeline MRR</dt>
            <dd>{money.format(pipelineCents / 100)}</dd>
          </div>
          <div>
            <dt>Customer MRR</dt>
            <dd>{money.format((customer?.monthlyValueCents ?? 0) / 100)}</dd>
          </div>
          <div>
            <dt>Added</dt>
            <dd>{gameDate(company.createdAt)}</dd>
          </div>
        </dl>
      </div>
      <div class="related-records">
        <h3>People</h3>
        {leads.map((lead) => (
          <div>
            <span>{lead.firstName} {lead.lastName}</span>
            <small>{lead.role}</small>
          </div>
        ))}
      </div>
    </aside>
  );
}

function Modal(
  props: {
    title: string;
    children: preact.ComponentChildren;
    onClose: () => void;
  },
) {
  return (
    <div class="modal-backdrop" role="presentation">
      <section
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
      >
        <div class="modal-heading">
          <h2>{props.title}</h2>
          <button
            type="button"
            class="icon-button"
            onClick={props.onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        {props.children}
      </section>
    </div>
  );
}
