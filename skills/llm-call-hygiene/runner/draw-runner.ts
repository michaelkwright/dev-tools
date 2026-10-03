// Repeated draws: one request shape, N times, against a real model, under hard caps.
// Seeded from dev-tools @ {{DEV_TOOLS_SHA}}; this file is now the project's own.
//
//   node scripts/probes/draws.ts --dry                    no network call; prints the worst case
//   node --env-file=.env scripts/probes/draws.ts --live   spends, under the caps in CONFIG
//
// What it is for: any question whose answer is a distribution (a model swap, a
// prompt defect, how often a reply arrives as [thinking, text]). Fill CONFIG
// below, run --dry, read the worst case, then run --live. Node 22.18 or later
// runs this file directly. Scope: the Anthropic Messages API; other providers
// are out of scope. Replies are classified by the dev-tools response helpers,
// imported below, never by a second reader in this file.
//
// There are no default prices, and a missing price refuses to run.
// Why: a model priced at zero passes every dollar cap, and a remembered price
// is a guess with no date.
//
// Dry mode makes no network call at all.
// Why: the worst case is what someone approves before any spend; a dry mode
// that calls is a paid run nobody approved.
//
// Before every call: the request cap, then dollars spent so far (read from
// each response's usage fields) plus the next call's worst case against the
// dollar cap. The request is counted before it is sent.
// Why: a check after the call has already spent, an estimate of past calls is
// not what was billed, and a request counted after sending can be hidden by a
// throw.
//
// A call whose outcome is unknown (a transport failure, an unreadable body, a
// reply with no usage) is charged its worst case.
// Why: there is no usage to read, and the request may have been billed.
//
// No retries and no continuation: a failed or paused draw is a data point,
// recorded and counted.
// Why: a retry is a request the run did not price as a draw, and it removes
// the failure from the rate being measured.
//
// A rejected request (HTTP 400, 401, 403, 404, 413) stops the run.
// Why: every later draw sends the same request and gets the same answer.
//
// Each draw appends one JSONL record holding everything a later question could
// need: the raw content blocks, usage, stop reason, latency, model, a hash of
// the request body and the helpers' classification. Never the API key, never
// a request header; any string that would carry the key is redacted.
// Why: a field nobody recorded can only be recovered by paying again, and the
// record is kept and shared.
//
// The output file must not exist. A run writes a fresh one.
// Why: appending to an old run mixes two distributions, and a resume is a
// continuation.
//
// Optional request parity: given the shipping request body, the probe body
// must equal it in every field except the model id, or the run refuses.
// Why: a probe that re-models by spreading over a built body measures a
// request production never sends.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Point this at the project's copy of the dev-tools response helpers.
import { classifyStop, parseJsonReply, trailingText } from "../helpers/message-reading.ts";

// ── CONFIG: fill every field before the first run ────────────────────────────

export const CONFIG: DrawConfig = {
  // The model id under test, exactly as the API takes it.
  model: "",
  // How many draws, and the hard caps. The request cap can be below the draw count.
  draws: 0,
  maxRequests: 0,
  maxUsd: 0,
  // From the provider's pricing page for this model, with the date you read it
  // and where: { inputPerMTok, outputPerMTok, searchFeeUsd, readOn: "YYYY-MM-DD", source }.
  // Add cacheWritePerMTok and cacheReadPerMTok if the request uses prompt caching.
  prices: null,
  // The environment variable holding the API key. The key is never printed or recorded.
  apiKeyEnv: "ANTHROPIC_API_KEY",
  // A path that does not exist yet. The summary is written beside it as <outFile>.summary.json.
  outFile: "",
  // Build each draw through the shipping request builder, passing the model
  // through the builder's own parameter; never spread a new model over a built body.
  buildRequest: () => {
    throw new Refusal("CONFIG.buildRequest is not filled: build each draw through the shipping request builder");
  },
  // Optional parity: the shipping builder's body for the same input.
  // shippingBody: (draw) => buildShippingRequest(input),
  // "json" parses strictly, "json-fence" adds the one-fence rescue, "text" only reads the trailing text.
  parse: "json",
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Prices {
  /** USD per million input tokens. */
  inputPerMTok: number;
  /** USD per million output tokens (thinking is billed as output). */
  outputPerMTok: number;
  /** USD per web search. */
  searchFeeUsd: number;
  /** USD per million cache-write and cache-read input tokens; required only when a request carries cache_control. */
  cacheWritePerMTok?: number;
  cacheReadPerMTok?: number;
  /** The date these prices were read, YYYY-MM-DD. */
  readOn: string;
  /** Where they were read. */
  source: string;
}

export type RequestBody = Record<string, unknown> & { model: string; max_tokens: number };

export interface DrawConfig {
  model: string;
  draws: number;
  maxRequests: number;
  maxUsd: number;
  prices: Prices | null;
  apiKeyEnv: string;
  outFile: string;
  buildRequest: (draw: number) => RequestBody;
  shippingBody?: (draw: number) => unknown;
  parse?: "json" | "json-fence" | "text";
  /** Characters per token for the input estimate. Default 2.5, chosen to over-count. */
  charsPerToken?: number;
  /** Input tokens allowed per permitted search, for the injected results. Default 10,000. */
  injectedTokensPerSearch?: number;
  /** Input tokens allowed for the tool-use system prompt on a request carrying any tool. Default 1,000. */
  toolOverheadTokens?: number;
  /** Per-request timeout for the default transport. Default 300,000 ms. */
  timeoutMs?: number;
}

export interface TransportRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}
export interface TransportResponse {
  status: number;
  body: string;
}
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export interface Deps {
  transport?: Transport;
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
  now?: () => number;
}

/** A refusal to run: a config, a request or the environment is not fit to spend on. */
export class Refusal extends Error {}

export interface WorstCase {
  /** The serialized body's length over charsPerToken: an estimate, never a measurement. */
  estimatedInputTokens: number;
  toolOverheadTokens: number;
  /** Searches the request permits (the search tool's max_uses), not searches expected. */
  searches: number;
  injectedInputTokens: number;
  maxOutputTokens: number;
  usd: number;
}

export interface Classification {
  stop: string;
  parse: string;
  text_chars: number | null;
}

export interface DrawRecord {
  draw: number;
  started_at: string;
  latency_ms: number;
  model_requested: string;
  request_sha256: string;
  http_status: number | null;
  /** The error body or transport message, verbatim except that the key is redacted. */
  error: string | null;
  response_id: string | null;
  response_model: string | null;
  stop_reason: string | null;
  block_types: string[];
  /** Every content block exactly as returned, thinking included. */
  content: unknown;
  usage: unknown;
  classification: Classification | null;
  cost_usd: number;
  cost_basis: "usage" | "not_billed" | "worst_case_unknown_outcome";
  /** Usage fields that had no price; the run stops after a draw that has any. */
  unpriced: string[];
}

export interface RunSummary {
  model: string;
  draws_planned: number;
  draws_recorded: number;
  stopped_by: string | null;
  by_stop_reason: Record<string, number>;
  by_block_shape: Record<string, number>;
  by_parse_outcome: Record<string, number>;
  tokens: { input: number; output: number; cache_write: number; cache_read: number };
  searches: number;
  requests_sent: number;
  request_cap: number;
  usd_spent: number;
  usd_charged_at_worst_case: number;
  usd_cap: number;
  dry_worst_case_usd: number;
  prices: Prices;
}

export const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const REJECTED = new Set([400, 401, 403, 404, 413]);
const NO_RESPONSE = "(no response)";

// ── Config and request checks ─────────────────────────────────────────────────

const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const positiveInt = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;

function checkPrices(p: Prices | null | undefined): Prices {
  if (!p) {
    throw new Refusal(
      "no prices: set CONFIG.prices from the provider's pricing page, with the date you read them; this runner has no default prices",
    );
  }
  for (const field of ["inputPerMTok", "outputPerMTok", "searchFeeUsd"] as const) {
    if (!positive(p[field])) throw new Refusal(`prices.${field} is missing or not a positive number; there are no default prices`);
  }
  for (const field of ["cacheWritePerMTok", "cacheReadPerMTok"] as const) {
    if (p[field] !== undefined && !positive(p[field])) throw new Refusal(`prices.${field} is not a positive number`);
  }
  if (typeof p.readOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.readOn) || Number.isNaN(Date.parse(p.readOn))) {
    throw new Refusal("prices.readOn is missing: give the date the prices were read, as YYYY-MM-DD");
  }
  if (typeof p.source !== "string" || p.source.trim() === "") throw new Refusal("prices.source is missing: say where the prices were read");
  return p;
}

function checkConfig(c: DrawConfig): Prices {
  const prices = checkPrices(c.prices);
  if (typeof c.model !== "string" || c.model.trim() === "") throw new Refusal("CONFIG.model is empty");
  if (!positiveInt(c.draws)) throw new Refusal("CONFIG.draws must be a positive integer");
  if (!positiveInt(c.maxRequests)) throw new Refusal("CONFIG.maxRequests must be a positive integer");
  if (!positive(c.maxUsd)) throw new Refusal("CONFIG.maxUsd must be a positive number");
  if (typeof c.apiKeyEnv !== "string" || c.apiKeyEnv.trim() === "") throw new Refusal("CONFIG.apiKeyEnv is empty");
  if (typeof c.outFile !== "string" || c.outFile.trim() === "") throw new Refusal("CONFIG.outFile is empty");
  for (const field of ["charsPerToken", "injectedTokensPerSearch", "toolOverheadTokens", "timeoutMs"] as const) {
    if (c[field] !== undefined && !positive(c[field])) throw new Refusal(`CONFIG.${field} must be a positive number`);
  }
  return prices;
}

function toolsOf(body: RequestBody): Array<Record<string, unknown>> {
  return Array.isArray(body.tools) ? (body.tools as Array<Record<string, unknown>>) : [];
}

/** Searches the request permits. A search tool with no max_uses, or a server tool this runner cannot price, refuses. */
function permittedSearches(body: RequestBody): number {
  let searches = 0;
  for (const tool of toolsOf(body)) {
    const type = tool?.type;
    if (type === undefined || type === "custom") continue;
    if (typeof type === "string" && type.startsWith("web_search")) {
      if (!positiveInt(tool.max_uses)) throw new Refusal(`a ${type} tool with no max_uses has no worst case; set max_uses`);
      searches += tool.max_uses as number;
      continue;
    }
    throw new Refusal(`tool type ${JSON.stringify(type)}: this runner prices only web search; extend the worst case before drawing with it`);
  }
  return searches;
}

/** The input-token estimate: the serialized body's length over a characters-per-token figure chosen to over-count. */
export function estimateInputTokens(body: unknown, charsPerToken = 2.5): number {
  return Math.ceil(JSON.stringify(body).length / charsPerToken);
}

/** One call's worst case: the estimated input, the tool allowance and every permitted search's injected results at the input price, plus max_tokens at the output price, plus every permitted search's fee. */
export function worstCaseOf(body: RequestBody, config: DrawConfig): WorstCase {
  const p = checkPrices(config.prices);
  const estimatedInputTokens = estimateInputTokens(body, config.charsPerToken);
  const toolOverheadTokens = toolsOf(body).length > 0 ? (config.toolOverheadTokens ?? 1_000) : 0;
  const searches = permittedSearches(body);
  const injectedInputTokens = searches * (config.injectedTokensPerSearch ?? 10_000);
  const maxOutputTokens = body.max_tokens;
  // A cached request's input can be billed at the cache-write price, which is the higher one.
  const inputPrice = Math.max(p.inputPerMTok, p.cacheWritePerMTok ?? 0);
  const usd =
    ((estimatedInputTokens + toolOverheadTokens + injectedInputTokens) * inputPrice + maxOutputTokens * p.outputPerMTok) / 1e6 +
    searches * p.searchFeeUsd;
  return { estimatedInputTokens, toolOverheadTokens, searches, injectedInputTokens, maxOutputTokens, usd };
}

/** Paths where the probe body differs from the shipping body as sent, ignoring only the top-level model id. */
export function parityDiff(probe: unknown, shipping: unknown): string[] {
  const out: string[] = [];
  const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (path === "model") return;
    if (isObject(a) && isObject(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], path ? `${path}.${k}` : k);
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) out.push(`${path}.length`);
      for (let i = 0; i < Math.min(a.length, b.length); i++) walk(a[i], b[i], `${path}[${i}]`);
      return;
    }
    if (!Object.is(a, b)) out.push(path || "(root)");
  };
  // Compared as sent: JSON drops undefined fields, so they are not differences.
  const sent = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  walk(sent(probe), sent(shipping), "");
  return out;
}

interface Prepared {
  prices: Prices;
  bodies: RequestBody[];
  worst: WorstCase[];
}

function prepare(config: DrawConfig): Prepared {
  const prices = checkConfig(config);
  const bodies: RequestBody[] = [];
  const worst: WorstCase[] = [];
  for (let draw = 0; draw < config.draws; draw++) {
    const body = config.buildRequest(draw);
    if (body?.model !== config.model) {
      throw new Refusal(`draw ${draw}: the request's model is ${JSON.stringify(body?.model)}, not CONFIG.model ${JSON.stringify(config.model)}`);
    }
    if (!positiveInt(body.max_tokens)) throw new Refusal(`draw ${draw}: max_tokens must be a positive integer; it bounds the worst case`);
    if (JSON.stringify(body).includes('"cache_control"') && (prices.cacheWritePerMTok === undefined || prices.cacheReadPerMTok === undefined)) {
      throw new Refusal(`draw ${draw}: the request carries cache_control; set prices.cacheWritePerMTok and prices.cacheReadPerMTok`);
    }
    if (config.shippingBody) {
      const diff = parityDiff(body, config.shippingBody(draw));
      if (diff.length > 0) {
        throw new Refusal(`draw ${draw}: the probe body differs from the shipping body outside the model id, at ${diff.join(", ")}`);
      }
    }
    bodies.push(body);
    worst.push(worstCaseOf(body, config));
  }
  return { prices, bodies, worst };
}

// ── Dry mode ──────────────────────────────────────────────────────────────────

const usd = (n: number) => `$${n.toFixed(6)}`;

export interface DryReport {
  lines: string[];
  worst: WorstCase[];
  totalUsd: number;
}

function worstCaseLines(config: DrawConfig, p: Prepared): DryReport {
  const lines: string[] = [];
  const cpt = config.charsPerToken ?? 2.5;
  const totalUsd = p.worst.reduce((s, w) => s + w.usd, 0);
  lines.push(`Model ${config.model}; ${config.draws} draws; caps ${config.maxRequests} requests and ${usd(config.maxUsd)}.`);
  lines.push(
    `Prices read ${p.prices.readOn} from ${p.prices.source}: $${p.prices.inputPerMTok} input and $${p.prices.outputPerMTok} output per million tokens, $${p.prices.searchFeeUsd} per search.`,
  );
  lines.push(
    `Input tokens are an ESTIMATE: each request body serialized as JSON, its length divided by ${cpt} characters per token, a figure chosen to over-count. Only live usage fields measure input.`,
  );
  const seen = new Set<string>();
  p.worst.forEach((w, draw) => {
    const shape = JSON.stringify(w);
    if (seen.has(shape)) return;
    seen.add(shape);
    const search =
      w.searches > 0
        ? ` + ${w.searches} permitted searches x ${w.injectedInputTokens / w.searches} injected input tokens (search allowance) and x $${p.prices.searchFeeUsd} fee`
        : "";
    lines.push(
      `Draw ${draw} worst case: ${w.estimatedInputTokens} estimated input tokens + ${w.toolOverheadTokens} tool allowance${search}; max_tokens ${w.maxOutputTokens} as output = ${usd(w.usd)}.`,
    );
  });
  const admitted = (() => {
    let spent = 0;
    let n = 0;
    for (const w of p.worst) {
      if (n >= config.maxRequests || spent + w.usd > config.maxUsd) break;
      spent += w.usd;
      n++;
    }
    return n;
  })();
  lines.push(`WORST CASE for ${config.draws} draws: ${usd(totalUsd)} against a cap of ${usd(config.maxUsd)}.`);
  lines.push(
    admitted === config.draws
      ? "Every draw fits under both caps at its worst case."
      : `At worst case the caps admit ${admitted} of ${config.draws} draws; actual usage will usually admit more.`,
  );
  return { lines, worst: p.worst, totalUsd };
}

/** Build every request, check it, print the worst case. Makes no network call and reads no key. */
export function runDry(config: DrawConfig, deps: Deps = {}): DryReport {
  const log = deps.log ?? console.log;
  const report = worstCaseLines(config, prepare(config));
  log("DRY RUN: no network call.");
  for (const line of report.lines) log(line);
  return report;
}

// ── Live mode ─────────────────────────────────────────────────────────────────

export function fetchTransport(timeoutMs: number): Transport {
  return async ({ url, headers, body }) => {
    const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, body: await res.text() };
  };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function classify(message: unknown, parse: DrawConfig["parse"]): Classification {
  const stop = classifyStop((message as { stop_reason?: unknown } | null)?.stop_reason).kind;
  if (parse === "text") {
    const text = trailingText(message);
    return { stop, parse: text === null ? "no_text" : "text", text_chars: text?.length ?? null };
  }
  const r = parseJsonReply(message, { stripOneFence: parse === "json-fence" });
  if (r.ok) return { stop, parse: r.rescue === "fence" ? "ok_fence" : "ok", text_chars: null };
  return { stop, parse: r.kind, text_chars: r.textChars };
}

interface Tally {
  requests: number;
  usd: number;
  usdAtWorst: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  searches: number;
}

function costUsage(usage: Record<string, unknown>, p: Prices, rec: DrawRecord, tally: Tally): number {
  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  const cacheWrite = num(usage.cache_creation_input_tokens);
  const cacheRead = num(usage.cache_read_input_tokens);
  const searches = num((usage.server_tool_use as Record<string, unknown> | undefined)?.web_search_requests);
  // An unpriced cache field is charged at the input price and stops the run.
  if (cacheWrite > 0 && p.cacheWritePerMTok === undefined) rec.unpriced.push("cache_creation_input_tokens");
  if (cacheRead > 0 && p.cacheReadPerMTok === undefined) rec.unpriced.push("cache_read_input_tokens");
  tally.input += input;
  tally.output += output;
  tally.cacheWrite += cacheWrite;
  tally.cacheRead += cacheRead;
  tally.searches += searches;
  return (
    (input * p.inputPerMTok +
      output * p.outputPerMTok +
      cacheWrite * (p.cacheWritePerMTok ?? p.inputPerMTok) +
      cacheRead * (p.cacheReadPerMTok ?? p.inputPerMTok)) /
      1e6 +
    searches * p.searchFeeUsd
  );
}

async function drawOnce(
  draw: number,
  body: RequestBody,
  worst: WorstCase,
  ctx: { key: string; transport: Transport; config: DrawConfig; prices: Prices; now: () => number; tally: Tally },
): Promise<DrawRecord> {
  const payload = JSON.stringify(body);
  const redact = (s: string) => s.split(ctx.key).join("[redacted]");
  const rec: DrawRecord = {
    draw,
    started_at: new Date(ctx.now()).toISOString(),
    latency_ms: 0,
    model_requested: body.model,
    request_sha256: sha256(payload),
    http_status: null,
    error: null,
    response_id: null,
    response_model: null,
    stop_reason: null,
    block_types: [],
    content: null,
    usage: null,
    classification: null,
    cost_usd: 0,
    cost_basis: "not_billed",
    unpriced: [],
  };
  const atWorst = (error: string) => {
    rec.error = redact(error);
    rec.cost_usd = worst.usd;
    rec.cost_basis = "worst_case_unknown_outcome";
    ctx.tally.usdAtWorst += worst.usd;
    return rec;
  };
  const t0 = ctx.now();
  let res: TransportResponse;
  try {
    res = await ctx.transport({
      url: MESSAGES_URL,
      headers: { "x-api-key": ctx.key, "anthropic-version": API_VERSION, "content-type": "application/json" },
      body: payload,
    });
  } catch (e) {
    rec.latency_ms = ctx.now() - t0;
    return atWorst(`transport: ${e instanceof Error ? e.message : String(e)}`);
  }
  rec.latency_ms = ctx.now() - t0;
  rec.http_status = res.status;
  if (res.status < 200 || res.status > 299) {
    // An error response is not billed; its body is kept as the finding.
    rec.error = redact(res.body);
    return rec;
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    return atWorst(`unreadable body (${res.body.length} chars)`);
  }
  rec.response_id = typeof data.id === "string" ? data.id : null;
  rec.response_model = typeof data.model === "string" ? data.model : null;
  rec.stop_reason = classifyStop(data.stop_reason).stopReason;
  rec.content = data.content ?? null;
  rec.block_types = Array.isArray(data.content)
    ? (data.content as Array<{ type?: unknown }>).map((b) => (typeof b?.type === "string" ? b.type : JSON.stringify(b?.type ?? null)))
    : [];
  rec.usage = data.usage ?? null;
  rec.classification = classify(data, ctx.config.parse);
  if (data.usage === null || typeof data.usage !== "object") return atWorst("reply carried no usage");
  rec.cost_usd = costUsage(data.usage as Record<string, unknown>, ctx.prices, rec, ctx.tally);
  rec.cost_basis = "usage";
  return rec;
}

const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1;
};

function summarize(config: DrawConfig, p: Prepared, records: DrawRecord[], tally: Tally, stoppedBy: string | null): RunSummary {
  const s: RunSummary = {
    model: config.model,
    draws_planned: config.draws,
    draws_recorded: records.length,
    stopped_by: stoppedBy,
    by_stop_reason: {},
    by_block_shape: {},
    by_parse_outcome: {},
    tokens: { input: tally.input, output: tally.output, cache_write: tally.cacheWrite, cache_read: tally.cacheRead },
    searches: tally.searches,
    requests_sent: tally.requests,
    request_cap: config.maxRequests,
    usd_spent: tally.usd,
    usd_charged_at_worst_case: tally.usdAtWorst,
    usd_cap: config.maxUsd,
    dry_worst_case_usd: p.worst.reduce((sum, w) => sum + w.usd, 0),
    prices: p.prices,
  };
  for (const r of records) {
    const answered = r.classification !== null;
    // A draw with no reply to classify: an HTTP error, a transport failure or an unreadable body.
    const failure = r.http_status !== null && (r.http_status < 200 || r.http_status > 299) ? `http_${r.http_status}` : "no_usable_reply";
    bump(s.by_stop_reason, answered ? (r.stop_reason ?? "null") : failure);
    bump(s.by_block_shape, answered ? `[${r.block_types.join(", ")}]` : NO_RESPONSE);
    bump(s.by_parse_outcome, answered ? (r.classification as Classification).parse : NO_RESPONSE);
  }
  return s;
}

function summaryLines(s: RunSummary): string[] {
  const n = s.draws_recorded || 1;
  const table = (title: string, m: Record<string, number>) => [
    `${title}:`,
    ...Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  ${k}  ${v} (${((100 * v) / n).toFixed(1)}%)`),
  ];
  return [
    `SUMMARY: ${s.draws_recorded} of ${s.draws_planned} draws recorded on ${s.model}.${s.stopped_by ? ` STOPPED by ${s.stopped_by}` : ""}`,
    ...table("By stop reason", s.by_stop_reason),
    ...table("By block shape", s.by_block_shape),
    ...table("By parse outcome", s.by_parse_outcome),
    `Tokens: ${s.tokens.input} input, ${s.tokens.output} output, ${s.tokens.cache_write} cache write, ${s.tokens.cache_read} cache read; ${s.searches} searches.`,
    `Requests: ${s.requests_sent} of a cap of ${s.request_cap}.`,
    `Spent: ${usd(s.usd_spent)} of a cap of ${usd(s.usd_cap)} (${usd(s.usd_charged_at_worst_case)} of it charged at worst case for unknown outcomes); dry-run worst case ${usd(s.dry_worst_case_usd)}.`,
  ];
}

/** Draw for real, under both caps, recording every draw. Refuses before any call if anything is unfit. */
export async function runLive(config: DrawConfig, deps: Deps = {}): Promise<RunSummary> {
  const p = prepare(config);
  const env = deps.env ?? process.env;
  const key = env[config.apiKeyEnv];
  if (typeof key !== "string" || key.trim() === "") {
    throw new Refusal(`live mode needs the API key in the environment variable ${config.apiKeyEnv}, and it is not set`);
  }
  if (existsSync(config.outFile)) throw new Refusal(`${config.outFile} already exists: a run writes a fresh file and never continues an old one`);
  const redact = (s: string) => s.split(key).join("[redacted]");
  const log = (line: string) => (deps.log ?? console.log)(redact(line));
  const now = deps.now ?? Date.now;
  const transport = deps.transport ?? fetchTransport(config.timeoutMs ?? 300_000);
  const tally: Tally = { requests: 0, usd: 0, usdAtWorst: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, searches: 0 };
  const records: DrawRecord[] = [];
  let stoppedBy: string | null = null;

  log("LIVE RUN: spends under the caps below.");
  for (const line of worstCaseLines(config, p).lines) log(line);
  writeFileSync(config.outFile, "");

  for (let draw = 0; draw < p.bodies.length; draw++) {
    const worst = p.worst[draw];
    // The gate, before the call.
    if (tally.requests >= config.maxRequests) {
      stoppedBy = `the request cap: ${tally.requests} of ${config.maxRequests} requests sent; draw ${draw} not sent`;
      break;
    }
    if (tally.usd + worst.usd > config.maxUsd) {
      stoppedBy = `the dollar cap: ${usd(tally.usd)} spent + ${usd(worst.usd)} worst case for draw ${draw} would exceed ${usd(config.maxUsd)}; draw ${draw} not sent`;
      break;
    }
    tally.requests++;
    const rec = await drawOnce(draw, p.bodies[draw], worst, { key, transport, config, prices: p.prices, now, tally });
    tally.usd += rec.cost_usd;
    records.push(rec);
    appendFileSync(config.outFile, `${redact(JSON.stringify(rec))}\n`);
    log(
      `draw ${draw}: ${rec.http_status ?? "no response"} ${rec.stop_reason ?? ""} [${rec.block_types.join(", ")}] ${rec.classification?.parse ?? rec.error ?? ""}; ${rec.latency_ms} ms; ${usd(tally.usd)} so far`,
    );
    if (rec.unpriced.length > 0) {
      stoppedBy = `unpriced usage on draw ${draw}: ${rec.unpriced.join(", ")} has no price in CONFIG.prices (charged at the input price)`;
      break;
    }
    if (rec.http_status !== null && REJECTED.has(rec.http_status)) {
      stoppedBy = `a rejected request: HTTP ${rec.http_status} on draw ${draw}; every later draw sends the same request`;
      break;
    }
  }

  const summary = summarize(config, p, records, tally, stoppedBy);
  writeFileSync(`${config.outFile}.summary.json`, `${redact(JSON.stringify(summary, null, 2))}\n`);
  for (const line of summaryLines(summary)) log(line);
  return summary;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<number> {
  const mode = argv.includes("--live") ? "live" : argv.includes("--dry") ? "dry" : null;
  if (!mode) {
    console.error("usage: --dry (no network call) or --live (spends under the caps in CONFIG)");
    return 2;
  }
  try {
    if (mode === "dry") {
      runDry(CONFIG);
      return 0;
    }
    const summary = await runLive(CONFIG);
    return summary.stopped_by ? 3 : 0;
  } catch (e) {
    if (e instanceof Refusal) {
      console.error(`REFUSED: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
