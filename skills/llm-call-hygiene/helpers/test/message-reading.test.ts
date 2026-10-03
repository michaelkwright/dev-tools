// The response helpers, proven on synthetic Messages API envelopes. No request
// is made to any model API: every envelope here is written by hand.
import { describe, expect, it } from "vitest";
import { classifyStop, parseJsonReply, trailingText, type ParseFailure } from "../message-reading.ts";

// Planted in model text; asserted absent from every serialized failure.
const SENTINEL = "SENTINEL-ORDER-7Q";

const text = (t: string) => ({ type: "text", text: t });
const thinking = (t = `reasoning about the order ${SENTINEL}`) => ({ type: "thinking", thinking: t, signature: "sig" });
const redacted = () => ({ type: "redacted_thinking", data: "opaque" });
const reply = (content: unknown[], stop_reason: unknown = "end_turn") => ({
  id: "msg_synthetic",
  type: "message",
  role: "assistant",
  content,
  stop_reason,
  usage: { input_tokens: 10, output_tokens: 20 },
});

const ORDER = { order_id: "o-1", items: [{ sku: "A1", qty: 2 }] };
const ORDER_JSON = JSON.stringify(ORDER);

// A search reply with blocks interleaved: text, a search call, its result, more
// text, and the JSON last, the shape a web-search turn produces.
const SEARCH_REPLY = reply([
  text("I'll look up the item."),
  { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "item A1" } },
  { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://example.com", title: "A1" }] },
  text("Based on the results, "),
  text(ORDER_JSON),
]);

describe("trailingText reads the trailing run of text blocks, never a fixed index", () => {
  it("[text]: the one block", () => {
    expect(trailingText(reply([text(ORDER_JSON)]))).toBe(ORDER_JSON);
  });

  it("[thinking, text]: the text after the thinking block", () => {
    expect(trailingText(reply([thinking(), text(ORDER_JSON)]))).toBe(ORDER_JSON);
  });

  it("[redacted_thinking, text]: the text after the redacted block", () => {
    expect(trailingText(reply([redacted(), text(ORDER_JSON)]))).toBe(ORDER_JSON);
  });

  it("[thinking] alone at max_tokens: null, there is no answer", () => {
    expect(trailingText(reply([thinking()], "max_tokens"))).toBeNull();
  });

  it("several trailing text blocks: all of them, joined", () => {
    expect(trailingText(reply([thinking(), text('{"order_id":'), text('"o-1"}')]))).toBe('{"order_id":"o-1"}');
  });

  it("text, thinking, text: only the run after the last non-text block", () => {
    expect(trailingText(reply([text("draft"), thinking(), text(ORDER_JSON)]))).toBe(ORDER_JSON);
  });

  it("a search reply: only the text after the last tool block", () => {
    expect(trailingText(SEARCH_REPLY)).toBe(`Based on the results, ${ORDER_JSON}`);
  });

  it("no content, a non-array content, or a null message: null", () => {
    for (const m of [reply([]), { content: "text" }, null, undefined, {}]) expect(trailingText(m)).toBeNull();
  });

  it("a text block whose text is not a string contributes nothing", () => {
    expect(trailingText(reply([{ type: "text", text: 42 }, text(ORDER_JSON)]))).toBe(ORDER_JSON);
  });
});

describe("classifyStop maps every documented stop reason by name", () => {
  const DOCUMENTED: Array<[string, string, boolean]> = [
    ["end_turn", "complete", false],
    ["max_tokens", "truncated", false],
    ["model_context_window_exceeded", "context_exhausted", false],
    ["stop_sequence", "stop_sequence", false],
    ["tool_use", "tool_call", false],
    ["pause_turn", "paused", true],
    ["refusal", "refused", false],
  ];

  it.each(DOCUMENTED)("%s -> %s (retryable: %s)", (reason, kind, retryable) => {
    expect(classifyStop(reason)).toEqual({ kind, stopReason: reason, retryable });
  });

  it("only a pause is retryable", () => {
    expect(DOCUMENTED.filter(([, , r]) => r).map(([reason]) => reason)).toEqual(["pause_turn"]);
  });

  it("an unknown value is unexpected_stop, carried verbatim", () => {
    expect(classifyStop("end_of_order")).toEqual({ kind: "unexpected_stop", stopReason: "end_of_order", retryable: false });
  });

  it("null and missing are unexpected_stop with a null reason; a non-string is kept JSON-encoded", () => {
    expect(classifyStop(null)).toEqual({ kind: "unexpected_stop", stopReason: null, retryable: false });
    expect(classifyStop(undefined)).toEqual({ kind: "unexpected_stop", stopReason: null, retryable: false });
    expect(classifyStop(7)).toEqual({ kind: "unexpected_stop", stopReason: "7", retryable: false });
  });

  it("a name inherited from Object.prototype is not a stop reason", () => {
    expect(classifyStop("toString").kind).toBe("unexpected_stop");
  });
});

describe("parseJsonReply: stop reason first, then block types, then a whole-text parse", () => {
  it("[text] parses, with no rescue", () => {
    expect(parseJsonReply(reply([text(ORDER_JSON)]))).toEqual({ ok: true, value: ORDER, stopReason: "end_turn", rescue: null });
  });

  it("[thinking, text] and [redacted_thinking, text] parse the text", () => {
    expect(parseJsonReply(reply([thinking(), text(ORDER_JSON)]))).toMatchObject({ ok: true, value: ORDER });
    expect(parseJsonReply(reply([redacted(), text(ORDER_JSON)]))).toMatchObject({ ok: true, value: ORDER });
  });

  it("whitespace around the JSON is fine", () => {
    expect(parseJsonReply(reply([text(`\n  ${ORDER_JSON}\n\n`)]))).toMatchObject({ ok: true, value: ORDER });
  });

  it("several trailing text blocks are parsed as one string", () => {
    expect(parseJsonReply(reply([text('{"order_id":'), text('"o-1"}')]))).toMatchObject({ ok: true, value: { order_id: "o-1" } });
  });

  it("a truncated reply is refused even though its text would parse", () => {
    const r = parseJsonReply(reply([text(ORDER_JSON)], "max_tokens"));
    expect(r).toEqual({ ok: false, kind: "truncated", stopReason: "max_tokens", retryable: false, blockTypes: ["text"], textChars: null });
  });

  it("[thinking] alone at max_tokens is truncated, not no_text or not_json", () => {
    expect(parseJsonReply(reply([thinking()], "max_tokens"))).toMatchObject({ ok: false, kind: "truncated", blockTypes: ["thinking"] });
  });

  it("every non-complete stop refuses before extraction, with its own kind", () => {
    const cases: Array<[unknown, string]> = [
      ["model_context_window_exceeded", "context_exhausted"],
      ["stop_sequence", "stop_sequence"],
      ["tool_use", "tool_call"],
      ["pause_turn", "paused"],
      ["refusal", "refused"],
      ["end_of_order", "unexpected_stop"],
      [null, "unexpected_stop"],
    ];
    for (const [stop, kind] of cases) {
      expect(parseJsonReply(reply([text(ORDER_JSON)], stop)), String(stop)).toMatchObject({ ok: false, kind });
    }
  });

  it("a pause is the one retryable failure", () => {
    expect(parseJsonReply(reply([text(ORDER_JSON)], "pause_turn"))).toMatchObject({ ok: false, kind: "paused", retryable: true });
    expect(parseJsonReply(reply([text(ORDER_JSON)], "refusal"))).toMatchObject({ retryable: false });
  });

  it("an unknown stop reason is carried verbatim", () => {
    expect(parseJsonReply(reply([text(ORDER_JSON)], "end_of_order"))).toMatchObject({ kind: "unexpected_stop", stopReason: "end_of_order" });
  });

  it("a search reply is refused as tool_blocks, though its trailing text would parse", () => {
    expect(parseJsonReply(SEARCH_REPLY)).toEqual({
      ok: false,
      kind: "tool_blocks",
      stopReason: "end_turn",
      retryable: false,
      blockTypes: ["text", "server_tool_use", "web_search_tool_result", "text", "text"],
      textChars: null,
    });
  });

  it("a client tool_use block or an unknown block type is refused as tool_blocks", () => {
    expect(parseJsonReply(reply([{ type: "tool_use", id: "t", name: "lookup", input: {} }, text(ORDER_JSON)]))).toMatchObject({ kind: "tool_blocks" });
    expect(parseJsonReply(reply([{ type: "order_widget" }, text(ORDER_JSON)]))).toMatchObject({ kind: "tool_blocks" });
    expect(parseJsonReply(reply([{ text: "no type" }, text(ORDER_JSON)]))).toMatchObject({ kind: "tool_blocks", blockTypes: ["null", "text"] });
  });

  it("a reply ending in a thinking block has no text", () => {
    expect(parseJsonReply(reply([text(ORDER_JSON), thinking()]))).toMatchObject({ ok: false, kind: "no_text" });
  });

  it("prose around the JSON is not_json; nothing is brace-scanned out of it", () => {
    for (const t of [`Here is the order: ${ORDER_JSON}`, `${ORDER_JSON}\nLet me know if you need more.`, `${ORDER_JSON}${ORDER_JSON}`]) {
      expect(parseJsonReply(reply([text(t)]), { stripOneFence: true }), t).toMatchObject({ ok: false, kind: "not_json", textChars: t.length });
    }
  });
});

describe("the fence rescue is opt-in, exact and reported", () => {
  const fenced = (lang = "json") => "```" + lang + "\n" + ORDER_JSON + "\n```";

  it("off by default: a fenced reply is not_json", () => {
    expect(parseJsonReply(reply([text(fenced())]))).toMatchObject({ ok: false, kind: "not_json" });
  });

  it("on: exactly one fence is stripped, and the result says so", () => {
    for (const f of [fenced(), fenced(""), fenced("JSON"), `  ${fenced()}  \n`]) {
      expect(parseJsonReply(reply([thinking(), text(f)]), { stripOneFence: true }), f).toEqual({
        ok: true,
        value: ORDER,
        stopReason: "end_turn",
        rescue: "fence",
      });
    }
  });

  it("on: an unfenced reply still reports no rescue", () => {
    expect(parseJsonReply(reply([text(ORDER_JSON)]), { stripOneFence: true })).toMatchObject({ ok: true, rescue: null });
  });

  it("on: everything but one whole-reply fence around one JSON value stays refused", () => {
    const refused = [
      `Here you go:\n${fenced()}`,
      `${fenced()}\nThat is the order.`,
      "```json\n" + ORDER_JSON,
      `${fenced()}\n${fenced()}`,
      "```json\nnot an order\n```",
      "```python\n" + ORDER_JSON + "\n```",
    ];
    for (const t of refused) {
      expect(parseJsonReply(reply([text(t)]), { stripOneFence: true }), t).toMatchObject({ ok: false, kind: "not_json" });
    }
  });

  it("on: a fenced reply cut off at the ceiling is truncated, never rescued", () => {
    expect(parseJsonReply(reply([text(fenced())], "max_tokens"), { stripOneFence: true })).toMatchObject({ ok: false, kind: "truncated" });
  });
});

describe("no failure carries model text", () => {
  const withSentinel = `${SENTINEL} {"order_id": "o-1"`;
  const failing: Array<[string, unknown, boolean]> = [
    ["not_json, sentinel in text", reply([text(withSentinel)]), false],
    ["not_json with the fence opt-in", reply([text("```json\n" + withSentinel + "\n```")]), true],
    ["truncated", reply([thinking(), text(withSentinel)], "max_tokens"), false],
    ["no_text, sentinel in thinking", reply([text(withSentinel), thinking()]), false],
    ["tool_blocks, sentinel everywhere", reply([text(withSentinel), { type: "server_tool_use", id: "s", name: "web_search", input: { query: SENTINEL } }, text(withSentinel)]), false],
    ["unexpected_stop", reply([text(withSentinel)], "end_of_order"), false],
    ["refused", reply([text(withSentinel)], "refusal"), false],
  ];

  it.each(failing)("%s", (_name, msg, strip) => {
    const r = parseJsonReply(msg, { stripOneFence: strip });
    expect(r.ok).toBe(false);
    expect(Object.keys(r).sort()).toEqual(["blockTypes", "kind", "ok", "retryable", "stopReason", "textChars"]);
    expect(JSON.stringify(r)).not.toContain(SENTINEL);
    expect(JSON.stringify(r)).not.toContain("order_id");
  });

  it("control: the sentinel is in the model text, so the check can fire", () => {
    for (const [, msg] of failing) expect(JSON.stringify(msg)).toContain(SENTINEL);
  });

  it("a failure's shape is the declared one, field for field", () => {
    const r = parseJsonReply(reply([text(withSentinel)])) as ParseFailure;
    expect(r).toEqual({ ok: false, kind: "not_json", stopReason: "end_turn", retryable: false, blockTypes: ["text"], textChars: withSentinel.length });
  });
});
