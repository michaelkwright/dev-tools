// Reading a model's reply: the trailing text, the stop reason, a strict JSON parse.
// Seeded from dev-tools @ {{DEV_TOOLS_SHA}}; this file is now the project's own.
//
// Scope: the Anthropic Messages API response shape (a message object with a
// `content` array of typed blocks and a `stop_reason`). Other providers are out
// of scope; their envelopes differ and need their own reader. Imports nothing,
// so it runs unchanged under Node, Deno and a browser bundle.
//
// The answer is the trailing run of text blocks, never a fixed index.
// Why: a thinking-capable model puts a thinking block first, so content[0] has
// no text, the read comes back empty, and the failure is filed as malformed
// output when the answer was sitting one block later.
//
// The stop reason is checked before anything is extracted or parsed, and a
// truncated reply is refused even when its text happens to parse.
// Why: a reply cut off at the token ceiling is a budget failure; parsing it
// files it as a parser or prompt failure and sends the next investigator to
// the wrong place.
//
// Every stop reason is mapped by name, and an unknown one is kept verbatim.
// Why: a new value mapped onto the nearest known name hides exactly the change
// someone needs to see.
//
// Only a pause is retryable, and retrying is the caller's decision.
// Why: continuing a paused turn is a second billed request; a loop here would
// spend a cap nobody approved.
//
// A reply carrying any block other than text and thinking is refused here with
// its own kind; a tool or search reply needs its own reader.
// Why: search turns interleave tool blocks between text blocks, so "the
// trailing run" is the wrong shape for them, and an unknown block type is
// refused rather than guessed at.
//
// The parse is JSON.parse over the whole text (surrounding whitespace is
// fine). One rescue is opt-in: exactly one code fence around the whole reply is
// stripped, and the result says so, so the caller can count it.
// Why: a tolerant extractor turns a reply that stopped obeying the prompt into
// a silent success; a measured, counted exception keeps the failure visible.
//
// No failure ever carries model text, in any field.
// Why: a failure is logged and reported, and an error reporter ships whatever
// it is handed. This includes the JSON parser's own message, which quotes the
// input it rejected.

/** The stop reason, classified. `stopReason` is the raw value, verbatim (non-strings JSON-encoded). */
export type StopKind =
  | "complete"
  | "truncated"
  | "context_exhausted"
  | "stop_sequence"
  | "tool_call"
  | "paused"
  | "refused"
  | "unexpected_stop";

export interface StopClass {
  kind: StopKind;
  stopReason: string | null;
  /** True only for a pause: the turn was interrupted, not answered badly. */
  retryable: boolean;
}

// Every stop_reason the Messages API documents, mapped by name. See
// reference/api-facts.md in the dev-tools llm-call-hygiene skill for the date
// this list was read, and re-read the docs before trusting it.
const STOP_KINDS: Readonly<Record<string, StopKind>> = {
  end_turn: "complete",
  max_tokens: "truncated",
  model_context_window_exceeded: "context_exhausted",
  stop_sequence: "stop_sequence",
  tool_use: "tool_call",
  pause_turn: "paused",
  refusal: "refused",
};

function rawStop(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Map a response's stop_reason. A null, missing or unknown value is unexpected_stop, kept verbatim. */
export function classifyStop(stopReason: unknown): StopClass {
  const raw = rawStop(stopReason);
  const kind = typeof stopReason === "string" && Object.hasOwn(STOP_KINDS, stopReason) ? STOP_KINDS[stopReason] : "unexpected_stop";
  return { kind, stopReason: raw, retryable: kind === "paused" };
}

interface Block {
  type?: unknown;
  text?: unknown;
}

function blocksOf(message: unknown): Block[] | null {
  const content = (message as { content?: unknown } | null | undefined)?.content;
  return Array.isArray(content) ? (content as Block[]) : null;
}

/**
 * The text of the trailing run of text blocks: every text block after the last
 * block of any other type, joined. Null when the reply ends in a non-text block
 * (a thinking block cut off at the ceiling, a tool call) or has no content.
 */
export function trailingText(message: unknown): string | null {
  const blocks = blocksOf(message);
  if (!blocks) return null;
  let start = blocks.length;
  while (start > 0 && blocks[start - 1]?.type === "text") start--;
  if (start === blocks.length) return null;
  let text = "";
  for (let i = start; i < blocks.length; i++) {
    const t = blocks[i].text;
    text += typeof t === "string" ? t : "";
  }
  return text;
}

// Block types this reader understands. Anything else is a tool, server-tool or
// unknown block, and refuses the reply.
const TEXT_ONLY_TYPES = new Set(["text", "thinking", "redacted_thinking"]);

export type ParseFailureKind =
  | Exclude<StopKind, "complete">
  | "tool_blocks"
  | "no_text"
  | "not_json";

export interface ParseFailure {
  ok: false;
  kind: ParseFailureKind;
  stopReason: string | null;
  retryable: boolean;
  /** The block types in order. Types only, never their content. */
  blockTypes: string[];
  /** Length of the trailing text when there was one, so a log can tell short from cut off. Never the text. */
  textChars: number | null;
}

export interface ParseSuccess<T = unknown> {
  ok: true;
  value: T;
  stopReason: string;
  /** "fence" when the opt-in fence strip was needed. Count it: a rising count is a prompt drifting. */
  rescue: "fence" | null;
}

export type ParseResult<T = unknown> = ParseSuccess<T> | ParseFailure;

export interface ParseOptions {
  /** Strip exactly one code fence around the whole reply. Off by default. */
  stripOneFence?: boolean;
}

// ``` optionally followed by "json" (any case), then a newline, at the start;
// ``` at the end. Both ends are required.
const FENCE_OPEN = /^```(?:json)?[ \t]*\r?\n/i;
const FENCE_CLOSE = /\r?\n?```$/;

function parseWhole(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    // The parser's message quotes the input; it is deliberately dropped.
    return { ok: false };
  }
}

function blockTypesOf(blocks: Block[] | null): string[] {
  return (blocks ?? []).map((b) => (typeof b?.type === "string" ? b.type : rawStop(b?.type) ?? "null"));
}

/**
 * Parse a reply as one JSON value, strictly. In order: the stop reason (only
 * end_turn proceeds), then the block types (text and thinking only), then the
 * trailing text, then JSON.parse over all of it.
 */
export function parseJsonReply<T = unknown>(message: unknown, options: ParseOptions = {}): ParseResult<T> {
  const stop = classifyStop((message as { stop_reason?: unknown } | null | undefined)?.stop_reason);
  const blocks = blocksOf(message);
  const blockTypes = blockTypesOf(blocks);
  const fail = (kind: ParseFailureKind, textChars: number | null = null): ParseFailure => ({
    ok: false,
    kind,
    stopReason: stop.stopReason,
    retryable: stop.retryable,
    blockTypes,
    textChars,
  });

  if (stop.kind !== "complete") return fail(stop.kind);
  if (blocks?.some((b) => typeof b?.type !== "string" || !TEXT_ONLY_TYPES.has(b.type))) return fail("tool_blocks");

  const text = trailingText(message);
  if (text === null) return fail("no_text");

  const whole = parseWhole(text);
  if (whole.ok) return { ok: true, value: whole.value as T, stopReason: stop.stopReason as string, rescue: null };

  if (options.stripOneFence) {
    const trimmed = text.trim();
    const open = FENCE_OPEN.exec(trimmed);
    if (open && trimmed.length > open[0].length && FENCE_CLOSE.test(trimmed.slice(open[0].length))) {
      const inner = trimmed.slice(open[0].length).replace(FENCE_CLOSE, "");
      const fenced = parseWhole(inner);
      if (fenced.ok) return { ok: true, value: fenced.value as T, stopReason: stop.stopReason as string, rescue: "fence" };
    }
  }
  return fail("not_json", text.length);
}
