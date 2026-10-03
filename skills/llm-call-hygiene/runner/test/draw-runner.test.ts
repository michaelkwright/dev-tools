// The draw runner, proven against an injected transport. No request is made to
// any model API: every reply here is written by hand, and the default fetch
// transport is never constructed.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CONFIG,
  estimateInputTokens,
  MESSAGES_URL,
  parityDiff,
  Refusal,
  runDry,
  runLive,
  worstCaseOf,
  type DrawConfig,
  type DrawRecord,
  type RequestBody,
  type TransportRequest,
  type TransportResponse,
} from "../draw-runner.ts";

// Planted as the API key; asserted absent from every log line, record and summary.
const PLANTED = "PLANTED-SENTINEL-ORDER-7Q";
const KEY_ENV = "DRAW_RUNNER_TEST_KEY";
const MODEL = "model-under-test";

const DIR = mkdtempSync(join(tmpdir(), "draw-runner-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
let fileSeq = 0;
const freshOut = () => join(DIR, `draws-${++fileSeq}.jsonl`);

const PRICES = { inputPerMTok: 1, outputPerMTok: 5, searchFeeUsd: 0.01, readOn: "2000-01-01", source: "https://example.com/pricing" };

const orderBody = (model = MODEL, extra: Record<string, unknown> = {}): RequestBody => ({
  model,
  max_tokens: 1000,
  system: "Classify each item in the order. Reply with JSON only.",
  messages: [{ role: "user", content: [{ type: "text", text: "Order o-1: 2 x A1, 1 x B2" }] }],
  ...extra,
});
const SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 3 };

const cfg = (over: Partial<DrawConfig> = {}): DrawConfig => ({
  model: MODEL,
  draws: 3,
  maxRequests: 10,
  maxUsd: 100,
  prices: PRICES,
  apiKeyEnv: KEY_ENV,
  outFile: freshOut(),
  buildRequest: () => orderBody(),
  parse: "json",
  ...over,
});

const ORDER_JSON = JSON.stringify({ order_id: "o-1", items: [{ sku: "A1", category: "hardware" }] });
const text = (t: string) => ({ type: "text", text: t });
const thinking = (t = "the order has two lines") => ({ type: "thinking", thinking: t, signature: "sig-1" });
const ok = (content: unknown[], stop_reason = "end_turn", usage: unknown = { input_tokens: 100, output_tokens: 50 }): TransportResponse => ({
  status: 200,
  body: JSON.stringify({ id: "msg_synthetic", type: "message", role: "assistant", model: MODEL, content, stop_reason, usage }),
});
const httpError = (status: number, message = "overloaded"): TransportResponse => ({
  status,
  body: JSON.stringify({ type: "error", error: { type: "api_error", message } }),
});

type Step = TransportResponse | Error;
/** A transport that answers from a script, records every request, and fails the test if called past its script. */
function scripted(steps: Step[]) {
  const calls: TransportRequest[] = [];
  const transport = async (req: TransportRequest): Promise<TransportResponse> => {
    calls.push(req);
    const step = steps[calls.length - 1];
    if (step === undefined) throw new Error(`transport called ${calls.length} times; the script has ${steps.length}`);
    if (step instanceof Error) throw step;
    return step;
  };
  return { transport, calls };
}

function live(config: DrawConfig, steps: Step[], env: Record<string, string | undefined> = { [KEY_ENV]: PLANTED }) {
  const { transport, calls } = scripted(steps);
  const lines: string[] = [];
  const run = runLive(config, { transport, env, log: (l) => lines.push(l), now: () => 0 });
  return { run, calls, lines };
}

const records = (outFile: string): DrawRecord[] =>
  readFileSync(outFile, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as DrawRecord);

describe("dry mode", () => {
  it("never calls the transport, reads no key and writes no file", () => {
    let calls = 0;
    const transport = async () => {
      calls++;
      return ok([text(ORDER_JSON)]);
    };
    const config = cfg({ buildRequest: () => orderBody(MODEL, { tools: [SEARCH_TOOL] }) });
    const lines: string[] = [];
    const report = runDry(config, { transport, env: {}, log: (l) => lines.push(l) });
    expect(calls).toBe(0);
    expect(existsSync(config.outFile)).toBe(false);
    expect(report.totalUsd).toBeGreaterThan(0);
    expect(lines[0]).toBe("DRY RUN: no network call.");
  });

  it("says the input figure is an estimate and how it was made", () => {
    const lines: string[] = [];
    runDry(cfg(), { log: (l) => lines.push(l) });
    const estimate = lines.find((l) => l.startsWith("Input tokens are an ESTIMATE"));
    expect(estimate).toMatch(/serialized as JSON, its length divided by 2\.5 characters per token/);
    const body = orderBody();
    expect(lines.join("\n")).toContain(`${estimateInputTokens(body)} estimated input tokens`);
    expect(estimateInputTokens(body)).toBe(Math.ceil(JSON.stringify(body).length / 2.5));
  });

  it("prints the worst case as draws x (estimated input + max_tokens) at the given prices", () => {
    const body = orderBody();
    const report = runDry(cfg({ draws: 4 }), { log: () => {} });
    const one = (estimateInputTokens(body) * PRICES.inputPerMTok + body.max_tokens * PRICES.outputPerMTok) / 1e6;
    expect(report.totalUsd).toBeCloseTo(4 * one, 12);
  });
});

describe("prices are required, with the date they were read", () => {
  const strip = (field: string) => {
    const p: Record<string, unknown> = { ...PRICES };
    delete p[field];
    return p as unknown as DrawConfig["prices"];
  };

  it("no prices refuses, in dry mode and live, before any call", async () => {
    expect(() => runDry(cfg({ prices: null }), { log: () => {} })).toThrow(/no prices/);
    const { run, calls } = live(cfg({ prices: null }), [ok([text(ORDER_JSON)])]);
    await expect(run).rejects.toThrow(Refusal);
    expect(calls).toHaveLength(0);
  });

  for (const field of ["inputPerMTok", "outputPerMTok", "searchFeeUsd", "readOn", "source"]) {
    it(`a missing ${field} refuses`, () => {
      expect(() => runDry(cfg({ prices: strip(field) }), { log: () => {} })).toThrow(Refusal);
    });
  }

  it("a zero price and a malformed date refuse", () => {
    expect(() => runDry(cfg({ prices: { ...PRICES, inputPerMTok: 0 } }), { log: () => {} })).toThrow(/inputPerMTok/);
    expect(() => runDry(cfg({ prices: { ...PRICES, readOn: "last week" } }), { log: () => {} })).toThrow(/readOn/);
  });

  it("the template's own CONFIG refuses as shipped, on prices first", () => {
    expect(() => runDry(CONFIG, { log: () => {} })).toThrow(/no prices/);
  });

  it("a request carrying cache_control refuses without cache prices", () => {
    const config = cfg({ buildRequest: () => orderBody(MODEL, { system: [{ type: "text", text: "x", cache_control: { type: "ephemeral" } }] }) });
    expect(() => runDry(config, { log: () => {} })).toThrow(/cache_control/);
  });
});

describe("the dollar cap stops before a call that could exceed it", () => {
  it("stops before draw 1 when spend so far plus its worst case crosses the cap, though draw 0 fit", async () => {
    const body = orderBody();
    const config = cfg({ draws: 3 });
    const w = worstCaseOf(body, config);
    config.maxUsd = 1.5 * w.usd;
    // Each fixture reply bills exactly its worst case, so a check after the call
    // would let draw 1 through and leave 2 x worst > the cap.
    const atWorst = { input_tokens: w.estimatedInputTokens, output_tokens: body.max_tokens };
    const { run, calls } = live(config, [ok([text(ORDER_JSON)], "end_turn", atWorst), ok([text(ORDER_JSON)], "end_turn", atWorst)]);
    const s = await run;
    expect(calls).toHaveLength(1);
    expect(s.stopped_by).toMatch(/^the dollar cap: .* worst case for draw 1 would exceed/);
    expect(s.usd_spent).toBeCloseTo(w.usd, 12);
    expect(s.usd_spent).toBeLessThanOrEqual(config.maxUsd);
    expect(records(config.outFile)).toHaveLength(1);
  });

  it("counts spend from usage, not the estimate: cheap replies let every draw through", async () => {
    const config = cfg({ draws: 3 });
    config.maxUsd = 1.5 * worstCaseOf(orderBody(), config).usd;
    const cheap = { input_tokens: 10, output_tokens: 10 };
    const { run, calls } = live(config, [0, 1, 2].map(() => ok([text(ORDER_JSON)], "end_turn", cheap)));
    const s = await run;
    expect(calls).toHaveLength(3);
    expect(s.stopped_by).toBeNull();
    expect(s.usd_spent).toBeCloseTo(3 * (10 * 1 + 10 * 5) / 1e6, 12);
  });

  it("charges a call with an unknown outcome at its worst case", async () => {
    const config = cfg({ draws: 2 });
    const w = worstCaseOf(orderBody(), config);
    config.maxUsd = 1.5 * w.usd;
    const { run, calls } = live(config, [new Error("socket hang up"), ok([text(ORDER_JSON)])]);
    const s = await run;
    expect(calls).toHaveLength(1);
    expect(s.usd_charged_at_worst_case).toBeCloseTo(w.usd, 12);
    expect(s.stopped_by).toMatch(/^the dollar cap/);
    expect(records(config.outFile)[0].cost_basis).toBe("worst_case_unknown_outcome");
  });
});

describe("the request cap", () => {
  it("stops at the cap, below the draw count", async () => {
    const config = cfg({ draws: 5, maxRequests: 2 });
    const { run, calls } = live(config, [0, 1, 2, 3, 4].map(() => ok([text(ORDER_JSON)])));
    const s = await run;
    expect(calls).toHaveLength(2);
    expect(s.requests_sent).toBe(2);
    expect(s.stopped_by).toMatch(/^the request cap: 2 of 2 requests sent; draw 2 not sent/);
  });
});

describe("a search request's worst case carries the search allowance", () => {
  it("adds max_uses x (fee + injected input) and the tool allowance", () => {
    const body = orderBody(MODEL, { tools: [SEARCH_TOOL] });
    const w = worstCaseOf(body, cfg());
    expect(w.searches).toBe(3);
    expect(w.injectedInputTokens).toBe(30_000);
    expect(w.toolOverheadTokens).toBe(1_000);
    const expected = ((estimateInputTokens(body) + 1_000 + 30_000) * 1 + 1000 * 5) / 1e6 + 3 * 0.01;
    expect(w.usd).toBeCloseTo(expected, 12);
    const plain = worstCaseOf(orderBody(), cfg());
    expect(w.usd - plain.usd).toBeGreaterThan(3 * 0.01 + (30_000 * 1) / 1e6);
  });

  it("the allowance is configurable and printed", () => {
    const config = cfg({ injectedTokensPerSearch: 20_000, buildRequest: () => orderBody(MODEL, { tools: [SEARCH_TOOL] }) });
    expect(worstCaseOf(config.buildRequest(0), config).injectedInputTokens).toBe(60_000);
    const lines: string[] = [];
    runDry(config, { log: (l) => lines.push(l) });
    expect(lines.join("\n")).toContain("3 permitted searches x 20000 injected input tokens (search allowance)");
  });

  it("a search tool with no max_uses, or a server tool it cannot price, refuses", () => {
    const noMax = cfg({ buildRequest: () => orderBody(MODEL, { tools: [{ type: "web_search_20250305", name: "web_search" }] }) });
    expect(() => runDry(noMax, { log: () => {} })).toThrow(/no max_uses/);
    const other = cfg({ buildRequest: () => orderBody(MODEL, { tools: [{ type: "web_fetch_x", name: "web_fetch" }] }) });
    expect(() => runDry(other, { log: () => {} })).toThrow(/prices only web search/);
  });
});

describe("request parity", () => {
  it("accepts a probe body that differs from the shipping body only in the model id", async () => {
    const config = cfg({ draws: 1, shippingBody: () => orderBody("shipping-model") });
    expect(parityDiff(orderBody(), orderBody("shipping-model"))).toEqual([]);
    const { run, calls } = live(config, [ok([text(ORDER_JSON)])]);
    await run;
    expect(calls).toHaveLength(1);
  });

  it("refuses a body that also differs in a second field, before any call, naming it", async () => {
    const config = cfg({ draws: 1, shippingBody: () => orderBody("shipping-model", { max_tokens: 2000 }) });
    expect(() => runDry(config, { log: () => {} })).toThrow(/outside the model id, at max_tokens$/);
    const { run, calls } = live(config, [ok([text(ORDER_JSON)])]);
    await expect(run).rejects.toThrow(/outside the model id/);
    expect(calls).toHaveLength(0);
  });

  it("finds a nested difference and an added field", () => {
    const shipping = orderBody("shipping-model");
    const nested = orderBody(MODEL, { messages: [{ role: "user", content: [{ type: "text", text: "Order o-2" }] }] });
    expect(parityDiff(nested, shipping)).toEqual(["messages[0].content[0].text"]);
    expect(parityDiff(orderBody(MODEL, { temperature: 0 }), shipping)).toEqual(["temperature"]);
  });

  it("refuses a request whose model is not the configured one", () => {
    expect(() => runDry(cfg({ buildRequest: () => orderBody("another-model") }), { log: () => {} })).toThrow(/not CONFIG.model/);
  });
});

describe("the record", () => {
  it("keeps the raw thinking and text blocks, usage, stop reason, latency, model, request hash and classification", async () => {
    const blocks = [thinking("the order o-1 has two lines"), text(ORDER_JSON)];
    const usage = { input_tokens: 120, output_tokens: 80, output_tokens_details: { thinking_tokens: 30 } };
    const config = cfg({ draws: 1 });
    let t = 1_000;
    const { transport } = scripted([ok(blocks, "end_turn", usage)]);
    await runLive(config, { transport, env: { [KEY_ENV]: PLANTED }, log: () => {}, now: () => (t += 250) });
    const [rec] = records(config.outFile);
    expect(rec.content).toEqual(blocks);
    expect(rec.block_types).toEqual(["thinking", "text"]);
    expect(rec.usage).toEqual(usage);
    expect(rec.stop_reason).toBe("end_turn");
    expect(rec.latency_ms).toBe(250);
    expect(rec.model_requested).toBe(MODEL);
    expect(rec.response_model).toBe(MODEL);
    expect(rec.request_sha256).toBe(createHash("sha256").update(JSON.stringify(orderBody())).digest("hex"));
    expect(rec.classification).toEqual({ stop: "complete", parse: "ok", text_chars: null });
    expect(rec.cost_usd).toBeCloseTo((120 * 1 + 80 * 5) / 1e6, 12);
    expect(Object.keys(rec)).not.toContain("headers");
  });

  it("refuses an output file that already exists", async () => {
    const config = cfg();
    writeFileSync(config.outFile, "old run\n");
    const { run, calls } = live(config, [ok([text(ORDER_JSON)])]);
    await expect(run).rejects.toThrow(/already exists/);
    expect(calls).toHaveLength(0);
  });
});

describe("no retries and no continuation", () => {
  it("records a failed draw and a paused draw as data points and sends exactly one request per draw", async () => {
    const config = cfg({ draws: 3 });
    const { run, calls } = live(config, [httpError(529), ok([text("searching")], "pause_turn"), ok([text(ORDER_JSON)])]);
    const s = await run;
    expect(calls).toHaveLength(3);
    expect(s.stopped_by).toBeNull();
    expect(s.by_stop_reason).toEqual({ http_529: 1, pause_turn: 1, end_turn: 1 });
    const recs = records(config.outFile);
    expect(recs[0].cost_basis).toBe("not_billed");
    expect(recs[1].classification?.stop).toBe("paused");
  });

  it("a rejected request stops the run", async () => {
    const config = cfg({ draws: 3 });
    const { run, calls } = live(config, [httpError(400, "max_tokens: too large"), ok([text(ORDER_JSON)])]);
    const s = await run;
    expect(calls).toHaveLength(1);
    expect(s.stopped_by).toMatch(/^a rejected request: HTTP 400 on draw 0/);
    expect(records(config.outFile)[0].error).toContain("max_tokens: too large");
  });
});

describe("the API key", () => {
  it("live mode refuses to start without it, before any call", async () => {
    const { run, calls } = live(cfg(), [ok([text(ORDER_JSON)])], {});
    await expect(run).rejects.toThrow(new RegExp(`environment variable ${KEY_ENV}`));
    expect(calls).toHaveLength(0);
  });

  it("appears in no log line, record, summary or error, though the transport received it", async () => {
    const config = cfg({ draws: 4 });
    const { run, calls, lines } = live(config, [
      ok([thinking(), text(ORDER_JSON)]),
      httpError(529, `echoed ${PLANTED}`),
      new Error(`connect failed with ${PLANTED}`),
      { status: 200, body: `not json ${PLANTED}` },
    ]);
    const s = await run;
    // Positive control: the sentinel really was the key in use.
    expect(calls[0].headers["x-api-key"]).toBe(PLANTED);
    expect(calls[0].url).toBe(MESSAGES_URL);
    const everything = [lines.join("\n"), readFileSync(config.outFile, "utf8"), readFileSync(`${config.outFile}.summary.json`, "utf8"), JSON.stringify(s)];
    for (const out of everything) {
      expect(out).not.toContain(PLANTED);
      expect(out).not.toContain("x-api-key");
    }
    expect(readFileSync(config.outFile, "utf8")).toContain("echoed [redacted]");
  });
});

describe("the summary", () => {
  it("counts draws by block shape, stop reason and parse outcome, and spend against each cap", async () => {
    const config = cfg({ draws: 5 });
    const { run } = live(config, [
      ok([thinking(), text(ORDER_JSON)]),
      ok([thinking(), text(ORDER_JSON)]),
      ok([text(ORDER_JSON)]),
      ok([thinking()], "max_tokens", { input_tokens: 100, output_tokens: 1000 }),
      httpError(529),
    ]);
    const s = await run;
    expect(s.by_block_shape).toEqual({ "[thinking, text]": 2, "[text]": 1, "[thinking]": 1, "(no response)": 1 });
    expect(s.by_stop_reason).toEqual({ end_turn: 3, max_tokens: 1, http_529: 1 });
    expect(s.by_parse_outcome).toEqual({ ok: 3, truncated: 1, "(no response)": 1 });
    expect(s.tokens).toEqual({ input: 400, output: 1150, cache_write: 0, cache_read: 0 });
    expect(s.usd_spent).toBeCloseTo((400 * 1 + 1150 * 5) / 1e6, 12);
    expect(s.requests_sent).toBe(5);
    expect(s.request_cap).toBe(10);
    expect(s.usd_cap).toBe(100);
    const written = JSON.parse(readFileSync(`${config.outFile}.summary.json`, "utf8"));
    expect(written.by_block_shape).toEqual(s.by_block_shape);
  });

  it("prints the shape rates", async () => {
    const config = cfg({ draws: 2 });
    const { run, lines } = live(config, [ok([thinking(), text(ORDER_JSON)]), ok([text(ORDER_JSON)])]);
    await run;
    expect(lines).toContain("  [thinking, text]  1 (50.0%)");
    expect(lines.some((l) => /^Spent: \$0\.\d{6} of a cap of \$100\.000000/.test(l))).toBe(true);
  });
});
